import type { Profile, TargetCollege } from "./types";

/** Same shape Explore uses when adding a school to the student's list. */
export function collegeEntry(name: string, id: string): TargetCollege {
  return { id, name, status: "researching", plan: "", deadline: "", notes: "" };
}

/**
 * Add/remove a college on the profile list — the data path Explore → Insights checklist uses.
 * Matching is case-insensitive on the college name.
 */
export function toggleCollegeOnProfile(profile: Profile, collegeName: string, idFactory: () => string): Profile {
  const key = collegeName.toLowerCase();
  const onList = profile.colleges.some((c) => c.name.toLowerCase() === key);
  return {
    ...profile,
    updatedAt: Date.now(),
    colleges: onList
      ? profile.colleges.filter((c) => c.name.toLowerCase() !== key)
      : [...profile.colleges, collegeEntry(collegeName, idFactory())],
  };
}

export function collegesOnList(profile: Profile): string[] {
  return profile.colleges.map((c) => c.name);
}
