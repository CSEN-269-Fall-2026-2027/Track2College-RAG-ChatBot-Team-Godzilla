import type { GradeLevel, Profile } from "../types";

export const CHECKPOINT_COUNT = 3;

export interface CheckpointDef {
  id: string;
  title: string;
  /** Short label under the path (desktop). */
  label: string;
}

export const CHECKPOINTS: CheckpointDef[] = [
  { id: "guide", title: "About you", label: "Info" },
  { id: "school", title: "Your academic history", label: "History" },
  { id: "interests", title: "Your interests", label: "Interests" },
];

export interface QuestionDef {
  id: string;
  checkpoint: number;
  prompt: string;
  hint?: string;
  /** Must answer before Continue (Skip disabled). */
  required?: boolean;
}

/**
 * Three checkpoints to start. About you is required; history and interests
 * questions can be skipped one-by-one, but every checkpoint must be visited
 * before "Start my plan". Activities, UC picks, essays, and aid come later.
 */
export const QUESTIONS: QuestionDef[] = [
  { id: "name", checkpoint: 0, prompt: "What should we call you?", hint: "A first name or nickname is perfect.", required: true },
  { id: "grade", checkpoint: 0, prompt: "What grade are you in?", required: true },
  { id: "year", checkpoint: 0, prompt: "When do you expect to graduate high school?", required: true },
  { id: "school", checkpoint: 0, prompt: "What’s the name of your high school?", required: true },
  { id: "state", checkpoint: 0, prompt: "Where do you go to school?", hint: "State or outside the U.S. — not a residency determination.", required: true },
  {
    id: "transcript",
    checkpoint: 1,
    prompt: "Have a transcript handy?",
    hint: "Optional — upload if you want, or enter courses later. An unofficial copy from your school portal works.",
  },
  { id: "gpa", checkpoint: 1, prompt: "What’s your school-reported GPA, if you know it?", hint: "Optional — distinct from any calculated UC GPA estimate." },
  { id: "subjects", checkpoint: 2, prompt: "What subjects do you enjoy?" },
  { id: "majors", checkpoint: 2, prompt: "Any majors you’re curious about?", hint: "“I’m still exploring” is a great answer." },
];

export function questionsForCheckpoint(checkpoint: number): QuestionDef[] {
  return QUESTIONS.filter((q) => q.checkpoint === checkpoint);
}

export function questionErrors(profile: Profile, questionId: string): string[] {
  switch (questionId) {
    case "name":
      return profile.basics.firstName.trim() ? [] : ["Add the name you’d like us to use."];
    case "grade":
      if (profile.basics.gradeLevel === "transfer") {
        return ["This tool supports first-year UC applicants (including gap year). Transfer applicants use a different UC process."];
      }
      return profile.basics.gradeLevel ? [] : ["Pick your current grade."];
    case "year":
      return profile.basics.graduationYear.trim() ? [] : ["Add your expected graduation year."];
    case "school":
      return profile.basics.highSchool.trim() ? [] : ["Add your high school name."];
    case "state":
      return profile.basics.state.trim() ? [] : ["Select your state or “Outside the U.S.”"];
    default:
      return [];
  }
}

/** Required fields across the whole journey (used before “Start my plan”). */
export function checkpointErrors(profile: Profile, checkpoint: number): string[] {
  const errors: string[] = [];
  if (checkpoint === 0) {
    errors.push(...questionErrors(profile, "name"));
    errors.push(...questionErrors(profile, "grade"));
    errors.push(...questionErrors(profile, "year"));
    errors.push(...questionErrors(profile, "school"));
    errors.push(...questionErrors(profile, "state"));
  }
  return errors;
}

export function requiredComplete(profile: Profile): boolean {
  const { firstName, gradeLevel, graduationYear, highSchool, state } = profile.basics;
  if (gradeLevel === "transfer") return false;
  return !!(firstName.trim() && gradeLevel && graduationYear.trim() && highSchool.trim() && state.trim());
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

export function toggleList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

export function markComplete(profile: Profile): Profile {
  return {
    ...profile,
    onboarding: {
      ...profile.onboarding,
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
  { id: "11", label: "11th (junior)" },
  { id: "12", label: "12th (senior)" },
  { id: "gap", label: "Gap year" },
];

export const SUBJECT_CHIPS = ["English", "Math", "Science", "History", "Art", "Music", "CS / coding", "Languages", "Business", "Other"];
export const MAJOR_CHIPS = ["Computer Science", "Biology", "Business", "Engineering", "Psychology", "Nursing", "Undecided", "Other"];
export const CAREER_CHIPS = ["Healthcare", "Tech", "Education", "Arts", "Law / government", "Trades", "Still exploring"];
export const ACTIVITY_CHIPS = ["Clubs", "Sports", "Job / paid work", "Volunteering", "Personal projects", "Family responsibilities", "Other"];
export const REGION_CHIPS = ["Stay in-state", "Nearby states", "Anywhere in the U.S.", "Open to other countries", "Not sure yet"];
export const DISTANCE_CHIPS = ["Commuting distance", "Within a few hours", "Across the country", "No preference"];
export const SIZE_CHIPS: { id: Profile["preferences"]["campusSize"]; label: string }[] = [
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
  { id: "any", label: "No preference" },
];
export const PRIORITY_CHIPS = ["Strong programs", "Affordability", "Community / vibe", "Other interests"];
export const HELP_CHIPS = ["Understanding UC requirements", "Financial aid", "Essays / PIQs", "Course planning", "Choosing a UC campus", "Not sure yet"];
