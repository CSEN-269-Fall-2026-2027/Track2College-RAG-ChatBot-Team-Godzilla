import type { Profile } from "../types";

/** Minimal blank profile for tests (avoids importing ProfileProvider / Supabase). */
export function blankProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    basics: {
      firstName: "Test",
      lastName: "Student",
      gradeLevel: "11",
      graduationYear: "2027",
      highSchool: "Lincoln High",
      city: "",
      state: "CA",
      firstGen: "",
    },
    academics: {
      gpaUnweighted: "",
      gpaWeighted: "",
      classRank: "",
      apIbCourses: "",
      sat: "",
      act: "",
      testPlan: "",
      coursework: "",
    },
    goals: { majors: [], careers: "", whyCollege: "" },
    activities: [],
    awards: [],
    colleges: [],
    preferences: {
      regions: "",
      campusSize: "",
      setting: "",
      maxAnnualCost: "",
      needsAid: "",
      incomeRange: "",
      fafsa: "",
      essays: "",
      recommendations: "",
    },
    checklistDone: {},
    updatedAt: 1,
    ...overrides,
  };
}
