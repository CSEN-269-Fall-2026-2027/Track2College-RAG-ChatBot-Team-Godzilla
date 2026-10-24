/**
 * Integration testing — connected parts pass data correctly.
 *
 * Feature: Explore "Add to list" → profile.colleges → readiness checklist.
 * Parts under test: collegeList.toggleCollegeOnProfile ↔ checklist.planningChecklist
 * (same modules the UI uses; no browser, no Supabase, no API).
 */
import { describe, expect, it } from "vitest";
import { collegesOnList, toggleCollegeOnProfile } from "../collegeList";
import { planningChecklist } from "../checklist";
import { blankProfile } from "./fixtures";

describe("integration: college list ↔ readiness checklist", () => {
  it("passes added colleges from the list helper into checklist auto-done state", () => {
    let profile = blankProfile();

    // Explore-equivalent adds (connected write path).
    profile = toggleCollegeOnProfile(profile, "UC Davis", () => "id-1");
    profile = toggleCollegeOnProfile(profile, "Santa Clara University", () => "id-2");
    profile = toggleCollegeOnProfile(profile, "UCLA", () => "id-3");
    profile = toggleCollegeOnProfile(profile, "Cal Poly", () => "id-4");

    expect(collegesOnList(profile)).toEqual([
      "UC Davis",
      "Santa Clara University",
      "UCLA",
      "Cal Poly",
    ]);

    // Checklist reads the same profile.colleges field Insights uses.
    const checklist = planningChecklist(profile, "11");
    const listBuild = checklist.find((item) => item.id === "list-build");

    expect(listBuild).toBeDefined();
    expect(listBuild?.done).toBe(true);
  });

  it("does not mark list-build done until four colleges are on the profile", () => {
    let profile = blankProfile();
    profile = toggleCollegeOnProfile(profile, "UC Davis", () => "id-1");
    profile = toggleCollegeOnProfile(profile, "UCLA", () => "id-2");
    profile = toggleCollegeOnProfile(profile, "Cal Poly", () => "id-3");

    const listBuild = planningChecklist(profile, "11").find((item) => item.id === "list-build");
    expect(listBuild?.done).toBe(false);
  });

  it("propagates removals: toggling a college off updates checklist completion", () => {
    let profile = blankProfile();
    for (const [name, id] of [
      ["UC Davis", "1"],
      ["UCLA", "2"],
      ["Cal Poly", "3"],
      ["SCU", "4"],
    ] as const) {
      profile = toggleCollegeOnProfile(profile, name, () => id);
    }
    expect(planningChecklist(profile, "11").find((i) => i.id === "list-build")?.done).toBe(true);

    profile = toggleCollegeOnProfile(profile, "UCLA", () => "unused");
    expect(collegesOnList(profile)).not.toContain("UCLA");
    expect(planningChecklist(profile, "11").find((i) => i.id === "list-build")?.done).toBe(false);
  });
});
