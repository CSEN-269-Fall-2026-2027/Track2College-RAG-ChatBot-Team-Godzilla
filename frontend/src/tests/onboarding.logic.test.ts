import { describe, expect, it } from "vitest";
import { emptyOnboarding, emptyProfile } from "../profile";
import {
  checkpointErrors,
  isOnboardingComplete,
  markComplete,
  questionErrors,
  questionsForCheckpoint,
  requiredComplete,
  resumeCheckpoint,
} from "../onboarding/logic";

describe("onboarding logic", () => {
  it("requires name, grade, year, school, and state — not optional fields", () => {
    let p = emptyProfile();
    expect(requiredComplete(p)).toBe(false);
    expect(checkpointErrors(p, 0).length).toBeGreaterThan(0);
    expect(questionErrors(p, "name").length).toBe(1);
    expect(questionErrors(p, "gpa")).toEqual([]);

    p = {
      ...p,
      basics: { ...p.basics, firstName: "Maya", gradeLevel: "11", graduationYear: "2027", highSchool: "Lincoln" },
    };
    expect(checkpointErrors(p, 0).some((e) => e.toLowerCase().includes("state"))).toBe(true);
    expect(checkpointErrors(p, 1)).toEqual([]);

    p = { ...p, basics: { ...p.basics, state: "CA" } };
    expect(requiredComplete(p)).toBe(true);
    expect(checkpointErrors(p, 0)).toEqual([]);
  });

  it("keeps conversational questions grouped under three checkpoints", () => {
    expect(questionsForCheckpoint(0).map((q) => q.id)).toEqual(["name", "grade", "year", "school", "state"]);
    expect(questionsForCheckpoint(1).every((q) => !q.required)).toBe(true);
    expect(questionsForCheckpoint(0).every((q) => q.required)).toBe(true);
    expect(questionsForCheckpoint(2).some((q) => q.id === "subjects")).toBe(true);
    expect(questionsForCheckpoint(2).some((q) => q.id === "careers")).toBe(false);
    expect(questionsForCheckpoint(1).some((q) => q.id === "classes")).toBe(false);
  });

  it("gates the app until onboarding.completed (or real legacy app use)", () => {
    const fresh = emptyProfile("Sam", "");
    expect(isOnboardingComplete(fresh)).toBe(false);

    // Finishing step 1 (basics + school) must NOT kick the student out of onboarding.
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

  it("resumes from saved checkpoint without inventing answers", () => {
    const p = {
      ...emptyProfile("A", "B"),
      onboarding: { ...emptyOnboarding(), checkpoint: 1 },
    };
    expect(resumeCheckpoint(p)).toBe(1);
    // Saved progress from the old, longer flow lands on the last step.
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

  it("does not treat transfer as a supported first-year flow", () => {
    const p = emptyProfile("Alex", "");
    p.basics.gradeLevel = "transfer";
    p.basics.graduationYear = "2026";
    p.basics.highSchool = "City College";
    p.basics.state = "CA";
    expect(requiredComplete(p)).toBe(false);
    expect(questionErrors(p, "grade")[0].toLowerCase()).toContain("first-year");
  });
});
