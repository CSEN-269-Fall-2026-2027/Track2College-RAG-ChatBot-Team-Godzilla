import { COLLEGES } from "../colleges";
import type { GradeLevel, HighSchoolGrade, Profile, Transcript, TranscriptCourse } from "../types";
import { newId } from "../storage";

export const CHECKPOINT_COUNT = 3;

export interface CheckpointDef {
  id: string;
  title: string;
  /** Short label under the path (desktop). */
  label: string;
}

/** Path marks: transcript → Google → confirm what we know. */
export const CHECKPOINTS: CheckpointDef[] = [
  { id: "transcript", title: "Your transcript", label: "Transcript" },
  { id: "google", title: "Connect Google", label: "Google" },
  { id: "you", title: "Confirm details", label: "Confirm" },
];

/** Question-checkpoint index for the confirm step (Google is a path mark / phase, not a question). */
export const ABOUT_YOU_CHECKPOINT = 2;

export interface QuestionDef {
  id: string;
  checkpoint: number;
  prompt: string;
  hint?: string;
  /** Must answer before Continue (Skip disabled). */
  required?: boolean;
  /** Hide when already filled (e.g. from transcript). */
  skipIfFilled?: (profile: Profile) => boolean;
}

/**
 * Transcript is step 1 (required). Google connect is step 2.
 * Step 3 is one confirm screen of everything we already have (editable).
 */
export const QUESTIONS: QuestionDef[] = [
  {
    id: "transcript",
    checkpoint: 0,
    prompt: "Upload your transcript",
    required: true,
  },
  {
    id: "confirm",
    checkpoint: ABOUT_YOU_CHECKPOINT,
    prompt: "Does this look right?",
    required: true,
  },
];

export function questionsForCheckpoint(checkpoint: number, profile?: Profile): QuestionDef[] {
  return QUESTIONS.filter((q) => {
    if (q.checkpoint !== checkpoint) return false;
    if (profile && q.skipIfFilled?.(profile)) return false;
    return true;
  });
}

const HS_GRADES: HighSchoolGrade[] = ["9", "10", "11", "12"];

/**
 * Current grade from transcript years: courses through N mean the student is in N+1
 * (capped at 12). e.g. grades through 11 → 12th grader.
 */
export function inferGradeFromCourses(courses: TranscriptCourse[]): GradeLevel | "" {
  let best = 0;
  for (const course of courses) {
    if (!HS_GRADES.includes(course.gradeLevel as HighSchoolGrade)) continue;
    const n = Number(course.gradeLevel);
    if (n > best) best = n;
  }
  if (!best) return "";
  return String(Math.min(best + 1, 12)) as GradeLevel;
}

/** Spring year that ends the current school year (July–June). */
export function schoolYearEndYear(now = new Date()): number {
  const year = now.getFullYear();
  return now.getMonth() >= 6 ? year + 1 : year;
}

/** Expected HS graduation year from current grade (12 → this school year, 11 → +1, …). */
export function inferGraduationYear(grade: GradeLevel | "", now = new Date()): string {
  if (!grade || !HS_GRADES.includes(grade as HighSchoolGrade)) return "";
  const yearsLeft = 12 - Number(grade);
  return String(schoolYearEndYear(now) + yearsLeft);
}

/**
 * First and last name from a transcript's student name, as schools print it:
 * "Lindsay Rotter", "Lindsay Ann Rotter", or "Rotter, Lindsay Ann".
 */
export function splitStudentName(full: string): { first: string; last: string } {
  const name = full.trim().replace(/\s+/g, " ");
  if (!name) return { first: "", last: "" };
  if (name.includes(",")) {
    const [last, rest = ""] = name.split(",", 2).map((part) => part.trim());
    return { first: rest.split(" ")[0] ?? "", last };
  }
  const words = name.split(" ");
  return { first: words[0], last: words.length > 1 ? words[words.length - 1] : "" };
}

/** Prefill profile basics/GPA from a transcript without overwriting edits the student already made. */
export function applyTranscriptBasics(profile: Profile, transcript: Transcript): Profile {
  // The last name matters: it's how we match the student to their counselor's last-name range.
  const { first, last } = splitStudentName(transcript.studentName);
  const grade = inferGradeFromCourses(transcript.courses);
  const year = inferGraduationYear(grade);
  const state = (transcript.state || "").trim().toUpperCase();
  const knownState = state && US_STATES.includes(state) ? state : "";
  return {
    ...profile,
    basics: {
      ...profile.basics,
      firstName: profile.basics.firstName || first,
      lastName: profile.basics.lastName || last,
      highSchool: profile.basics.highSchool || transcript.school,
      state: profile.basics.state || knownState,
      gradeLevel: profile.basics.gradeLevel || grade || profile.basics.gradeLevel,
      graduationYear: profile.basics.graduationYear || year,
    },
    academics: {
      ...profile.academics,
      gpaUnweighted: profile.academics.gpaUnweighted || transcript.reportedGpa.unweighted,
      gpaWeighted: profile.academics.gpaWeighted || transcript.reportedGpa.weighted,
    },
  };
}

export function questionErrors(profile: Profile, questionId: string, opts?: { hasTranscript?: boolean }): string[] {
  switch (questionId) {
    case "transcript":
      return opts?.hasTranscript ? [] : ["Upload your transcript to continue."];
    case "confirm":
      return checkpointErrors(profile);
    case "name":
      return profile.basics.firstName.trim() ? [] : ["Add the name you’d like us to use."];
    case "lastName":
      return profile.basics.lastName.trim() ? [] : ["Add your last name (we use it to find your school counselor)."];
    case "grade":
      if (profile.basics.gradeLevel === "transfer") {
        return ["This tool supports first-year UC applicants. Transfer applicants use a different UC process."];
      }
      return profile.basics.gradeLevel ? [] : ["Pick your current grade."];
    case "year":
      return profile.basics.graduationYear.trim() ? [] : ["Add your expected graduation year."];
    case "school":
      return profile.basics.highSchool.trim() ? [] : ["Add your high school name."];
    case "state":
      return profile.basics.state.trim() ? [] : ["Select your state or “Outside the U.S.”"];
    case "gpa":
      return profile.academics.gpaUnweighted.trim() ? [] : ["Add your unweighted GPA."];
    case "major":
      return profile.goals.intendedMajor.trim() || profile.onboarding.exploringMajors ? [] : ["Pick your intended major or Still exploring."];
    default:
      return [];
  }
}

/** Every field on the confirm screen (weighted GPA aside) must be filled before “Start my plan”. */
export function checkpointErrors(profile: Profile, _checkpoint = ABOUT_YOU_CHECKPOINT): string[] {
  return ["name", "lastName", "grade", "year", "school", "state", "gpa", "major"].flatMap((id) => questionErrors(profile, id));
}

export function isOnboardingComplete(profile: Profile): boolean {
  // Explicit finish from "Start my plan" only — filling step-1 basics must not exit onboarding.
  if (profile.onboarding?.completed) return true;
  // Pre-onboarding accounts that already used the app (not merely a saved school name).
  return (
    profile.colleges.length > 0 ||
    profile.activities.length > 0 ||
    Object.keys(profile.checklistDone ?? {}).length > 0
  );
}

export function resumeCheckpoint(profile: Profile): number {
  if (profile.onboarding?.completed) return CHECKPOINT_COUNT;
  const saved = profile.onboarding?.checkpoint ?? 0;
  return Math.max(0, Math.min(saved, CHECKPOINT_COUNT - 1));
}

export function clampCheckpoint(n: number): number {
  return Math.max(0, Math.min(CHECKPOINT_COUNT, n));
}

/** Prefill every UC campus (student can unselect later in Profile). */
export function withAllUcs(profile: Profile): Profile {
  const hasUc = profile.colleges.some((c) => COLLEGES.some((u) => u.name.toLowerCase() === c.name.toLowerCase()));
  if (hasUc) return profile;
  return {
    ...profile,
    colleges: COLLEGES.map((c) => ({
      id: newId(),
      name: c.name,
      status: "researching" as const,
      plan: "UC" as const,
      deadline: "",
      notes: "",
      major: "",
    })),
  };
}

export function markComplete(profile: Profile): Profile {
  const withUcs = withAllUcs(profile);
  return {
    ...withUcs,
    onboarding: {
      ...withUcs.onboarding,
      completed: true,
      checkpoint: CHECKPOINT_COUNT,
      completedAt: Date.now(),
    },
  };
}

export function setCheckpoint(profile: Profile, checkpoint: number): Profile {
  return {
    ...profile,
    onboarding: {
      ...profile.onboarding,
      checkpoint: clampCheckpoint(checkpoint),
    },
  };
}

export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA",
  "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
  "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
];

export const GRADE_OPTIONS: { id: GradeLevel; label: string }[] = [
  { id: "9", label: "9th" },
  { id: "10", label: "10th" },
  { id: "11", label: "11th" },
  { id: "12", label: "12th" },
];
