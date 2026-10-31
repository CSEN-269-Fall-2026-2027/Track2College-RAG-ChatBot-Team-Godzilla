import { emptyOnboarding, emptyProfile } from "../profile";
import type { Profile } from "../types";

/** Minimal blank profile for tests (avoids importing ProfileProvider / Supabase). */
export function blankProfile(overrides: Partial<Profile> = {}): Profile {
  const base = emptyProfile("Test", "Student");
  return {
    ...base,
    ...overrides,
    basics: {
      ...base.basics,
      firstName: "Test",
      lastName: "Student",
      gradeLevel: "11",
      graduationYear: "2027",
      highSchool: "Lincoln High",
      state: "CA",
      ...overrides.basics,
    },
    onboarding: {
      ...emptyOnboarding(),
      completed: true,
      checkpoint: 7,
      completedAt: 1,
      ...overrides.onboarding,
    },
    updatedAt: overrides.updatedAt ?? 1,
  };
}
