import { describe, expect, it } from "vitest";
import { COLLEGES } from "../colleges";
import { emptyOnboarding, emptyProfile } from "../profile";
import { applyTranscriptBasics, inferGradeFromCourses, inferGraduationYear, isOnboardingComplete, markComplete, splitStudentName, questionErrors, questionsForCheckpoint, resumeCheckpoint, schoolYearEndYear, withAllUcs } from "../onboarding/logic";
import type { Transcript, TranscriptCourse } from "../types";

function course(gradeLevel: TranscriptCourse["gradeLevel"]): TranscriptCourse {
  return {
    id: "c1",
    name: "English",
    gradeLevel,
    term: "Fall",
    grade: "A",
    level: "regular",
    area: "b",
    semesters: 1,
  };
}

describe("onboarding logic", () => {

  it("uses transcript then a single confirm step", () => {
    expect(questionsForCheckpoint(0).map((q) => q.id)).toEqual(["transcript"]);
    expect(questionsForCheckpoint(0)[0].required).toBe(true);
    expect(questionsForCheckpoint(2, emptyProfile()).map((q) => q.id)).toEqual(["confirm"]);
    expect(questionErrors(emptyProfile(), "confirm").length).toBeGreaterThan(0);
  });

  it("requires a transcript upload before continuing", () => {
    expect(questionErrors(emptyProfile(), "transcript")).toEqual(["Upload your transcript to continue."]);
    expect(questionErrors(emptyProfile(), "transcript", { hasTranscript: true })).toEqual([]);
  });

  it("infers grade and graduation year from transcript courses", () => {
    // Courses through 11 → currently a 12th grader; through 10 → 11th; already 12 → still 12.
    expect(inferGradeFromCourses([course("9"), course("10"), course("11")])).toBe("12");
    expect(inferGradeFromCourses([course("9"), course("10")])).toBe("11");
    expect(inferGradeFromCourses([course("12")])).toBe("12");
    expect(inferGradeFromCourses([course("other")])).toBe("");
    const end = schoolYearEndYear(new Date("2026-11-18T12:00:00"));
    expect(end).toBe(2027);
    expect(inferGraduationYear("12", new Date("2026-11-18T12:00:00"))).toBe("2027");
    expect(inferGraduationYear("11", new Date("2026-11-18T12:00:00"))).toBe("2028");
  });

  it("prefills blank basics from a transcript without overwriting edits", () => {
    const transcript: Transcript = {
      id: "t1",
      fileName: "t.pdf",
      uploadedAt: 1,
      storagePath: null,
      studentName: "Maya Chen",
      school: "Lincoln High",
      state: "CA",
      reportedGpa: { unweighted: "3.8", weighted: "4.2" },
      courses: [course("11"), course("11")],
      summary: "",
      strengths: [],
      concerns: [],
    };
    const filled = applyTranscriptBasics(emptyProfile(), transcript);
    expect(filled.basics.firstName).toBe("Maya");
    expect(filled.basics.lastName).toBe("Chen");
    expect(filled.basics.highSchool).toBe("Lincoln High");
    expect(filled.basics.state).toBe("CA");
    expect(filled.basics.gradeLevel).toBe("12");
    expect(filled.basics.graduationYear).toBe(inferGraduationYear("12"));
    expect(filled.academics.gpaUnweighted).toBe("3.8");

    const kept = applyTranscriptBasics(
      {
        ...emptyProfile(),
        basics: { ...emptyProfile().basics, firstName: "Sam", gradeLevel: "10", graduationYear: "2029", highSchool: "Mine", state: "NY" },
        academics: { ...emptyProfile().academics, gpaUnweighted: "3.1" },
      },
      transcript,
    );
    expect(kept.basics.firstName).toBe("Sam");
    // Last name was blank, so it still comes from the transcript.
    expect(kept.basics.lastName).toBe("Chen");
    expect(kept.basics.gradeLevel).toBe("10");
    expect(kept.basics.graduationYear).toBe("2029");
    expect(kept.basics.highSchool).toBe("Mine");
    expect(kept.basics.state).toBe("NY");
    expect(kept.academics.gpaUnweighted).toBe("3.1");
  });

  it("gates the app until onboarding.completed (or real legacy app use)", () => {
    const fresh = emptyProfile("Sam", "");
    expect(isOnboardingComplete(fresh)).toBe(false);

    const afterStepOne = {
      ...fresh,
      basics: { ...fresh.basics, firstName: "Sam", gradeLevel: "11" as const, graduationYear: "2027", state: "CA", highSchool: "Lincoln" },
      onboarding: emptyOnboarding(),
      updatedAt: Date.now(),
    };
    expect(isOnboardingComplete(afterStepOne)).toBe(false);

    expect(isOnboardingComplete(markComplete(afterStepOne))).toBe(true);

    const legacy = {
      ...afterStepOne,
      colleges: [{ id: "1", name: "UCLA", status: "researching" as const, plan: "" as const, deadline: "", notes: "" }],
    };
    expect(isOnboardingComplete(legacy)).toBe(true);
  });

  it("prefills all nine UCs when finishing onboarding", () => {
    const p = markComplete({
      ...emptyProfile("Maya", ""),
      basics: {
        firstName: "Maya",
        lastName: "",
        gradeLevel: "11",
        graduationYear: "2027",
        highSchool: "Lincoln",
        city: "",
        state: "CA",
        firstGen: "",
      },
    });
    expect(p.colleges).toHaveLength(COLLEGES.length);
    expect(withAllUcs(p).colleges).toHaveLength(COLLEGES.length);
  });

  it("resumes from saved checkpoint without inventing answers", () => {
    const p = {
      ...emptyProfile("A", "B"),
      onboarding: { ...emptyOnboarding(), checkpoint: 1 },
    };
    expect(resumeCheckpoint(p)).toBe(1);
    expect(resumeCheckpoint({ ...p, onboarding: { ...p.onboarding, checkpoint: 6 } })).toBe(2);
  });

  it("leaves skipped optional fields empty after continue", () => {
    const p = markComplete({
      ...emptyProfile("Maya", ""),
      basics: {
        firstName: "Maya",
        lastName: "",
        gradeLevel: "11",
        graduationYear: "2027",
        highSchool: "Lincoln",
        city: "",
        state: "CA",
        firstGen: "",
      },
      academics: {
        gpaUnweighted: "",
        gpaWeighted: "",
        exams: "",
        classRank: "",
        apIbCourses: "",
        sat: "",
        act: "",
        testPlan: "",
        coursework: "",
      },
      goals: { majors: [], intendedMajor: "", careers: "", whyCollege: "" },
    });
    expect(p.academics.gpaUnweighted).toBe("");
    expect(p.goals.majors).toEqual([]);
    expect(p.onboarding.completed).toBe(true);
  });

  it("keeps the last name from the transcript, in either printed order", () => {
    expect(splitStudentName("Maya Rivera")).toEqual({ first: "Maya", last: "Rivera" });
    expect(splitStudentName("Maya Ann  Rivera")).toEqual({ first: "Maya", last: "Rivera" });
    expect(splitStudentName("Rivera, Maya Ann")).toEqual({ first: "Maya", last: "Rivera" });
    expect(splitStudentName("Maya")).toEqual({ first: "Maya", last: "" });
    expect(splitStudentName("")).toEqual({ first: "", last: "" });
  });
});
