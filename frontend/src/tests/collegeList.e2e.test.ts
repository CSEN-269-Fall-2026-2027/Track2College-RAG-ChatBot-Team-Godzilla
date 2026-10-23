/**
 * End-to-end testing — complete user journey, first action → final result.
 *
 * Journey (same data path as the running app):
 *   1. Student starts with an empty college list (Overview would show list-build as a next step).
 *   2. Student adds schools via Explore's toggle helper.
 *   3. Insights checklist marks "Build a balanced college list" done.
 *   4. Overview nextSteps no longer prioritizes that incomplete item.
 *
 * Limitations: does not drive a real browser or Supabase; it exercises the
 * application data path end-to-end without UI rendering or network I/O.
 */
import { describe, expect, it } from "vitest";
import { collegesOnList, toggleCollegeOnProfile } from "../collegeList";
import { nextSteps, planningChecklist } from "../checklist";
import { blankProfile } from "./fixtures";

const SCHOOLS = ["UC Davis", "UCLA", "Cal Poly San Luis Obispo", "Santa Clara University"] as const;

describe("e2e: build college list journey", () => {
  it("goes from empty list → four adds → checklist complete → next steps update", () => {
    // --- First action: open the app with no colleges ---
    const base = blankProfile();
    let profile = blankProfile({
      basics: { ...base.basics, gradeLevel: "12" },
    });

    expect(collegesOnList(profile)).toEqual([]);
    expect(planningChecklist(profile, "12").find((i) => i.id === "list-build")?.done).toBe(false);
    // Overview surfaces incomplete grade-relevant items; list-build is among them for seniors.
    expect(nextSteps(profile, 10).some((s) => s.id === "list-build")).toBe(true);

    // --- Middle actions: Explore "Add to list" for each school ---
    let id = 0;
    for (const school of SCHOOLS) {
      profile = toggleCollegeOnProfile(profile, school, () => `college-${++id}`);
    }

    // --- Final result: list populated, readiness item done, next steps moved on ---
    expect(collegesOnList(profile)).toHaveLength(4);
    expect(collegesOnList(profile)).toEqual([...SCHOOLS]);

    const listBuild = planningChecklist(profile, "12").find((i) => i.id === "list-build");
    expect(listBuild?.done).toBe(true);
    expect(listBuild?.relevant).toBe(true);

    expect(nextSteps(profile, 10).some((s) => s.id === "list-build")).toBe(false);
  });
});

