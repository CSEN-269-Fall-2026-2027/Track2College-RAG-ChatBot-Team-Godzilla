/** UC Journey Map progress rules (pure logic; no React or Supabase). */
import { describe, expect, it } from "vitest";
import { computeJourney, emptyJourney, setCampusMajor, setPiqStatus, toggleCampus, togglePiq } from "../journey/logic";
import { routePoints, LAYOUTS } from "../journey/MapScene";
import type { Profile } from "../types";
import { blankProfile } from "./fixtures";

const fullBasics = { basics: 1, academics: 0, campuses: 0, finances: 0 };
const none = { basics: 0, academics: 0, campuses: 0, finances: 0 };
let n = 0;
const id = () => `id-${n++}`;

function readyProfile(): Profile {
  let p = blankProfile({
    activities: [
      {
        id: "a",
        name: "Robotics",
        role: "Captain",
        hoursPerWeek: "6",
        weeksPerYear: "36",
        years: "3",
        description: "Led a 12-person team to regionals.",
        category: "extracurricular",
      },
    ],
    academics: {
      ...blankProfile().academics,
      gpaUnweighted: "3.8",
    },
  });
  p = setCampusMajor(toggleCampus(p, "UC Davis", id), "UC Davis", "Biology");
  let j = emptyJourney();
  for (const q of ["leadership", "creativity", "talent", "community"]) j = setPiqStatus(togglePiq(j, q), q, "ready");
  return { ...p, ucJourney: j };
}

describe("UC journey progress", () => {
  it("starts at checkpoint 1 with nothing complete for a blank student", () => {
    const j = computeJourney(blankProfile(), none, false);
    expect(j.checkpoints.map((c) => c.title)).toEqual(["Build Your Profile", "Choose UCs", "Work on Activities List", "Four Essays", "Review & Apply"]);
    expect(j.completeCount).toBe(0);
    expect(j.current).toBe(0);
  });

  it("derives profile completion from basics + academic start (not goals)", () => {
    expect(computeJourney(blankProfile(), fullBasics, true).checkpoints[0].complete).toBe(true);
    expect(computeJourney(blankProfile(), fullBasics, false).checkpoints[0].complete).toBe(false);
    expect(computeJourney(blankProfile(), { ...fullBasics, basics: 0 }, true).checkpoints[0].complete).toBe(false);
  });

  it("needs a major for every saved UC", () => {
    let p = toggleCampus(blankProfile(), "UCLA", id);
    p = toggleCampus(p, "UC Irvine", id);
    p = setCampusMajor(p, "UCLA", "History");
    const ucs = computeJourney(p, fullBasics, true).checkpoints[1];
    expect(ucs.complete).toBe(false);
    expect(ucs.tasks[1].detail).toBe("1 of 2 campuses have a major");
    expect(computeJourney(setCampusMajor(p, "UC Irvine", "Math"), fullBasics, true).checkpoints[1].complete).toBe(true);
  });

  it("flags activity descriptions over the 350-character limit", () => {
    const p = readyProfile();
    p.activities[0].description = "x".repeat(351);
    expect(computeJourney(p, fullBasics, true).checkpoints[2].complete).toBe(false);
  });

  it("allows only four PIQs and reports ready count", () => {
    let j = emptyJourney();
    for (const q of ["leadership", "creativity", "talent", "community", "subject"]) j = togglePiq(j, q);
    expect(Object.keys(j.piqs)).toHaveLength(4);
    j = setPiqStatus(setPiqStatus(j, "leadership", "ready"), "talent", "ready");
    const essays = computeJourney({ ...blankProfile(), ucJourney: j }, fullBasics, true).checkpoints[3];
    expect(essays.summary).toBe("2 of 4 ready");
    expect(essays.complete).toBe(false);
  });

  it("never marks Review & Apply complete from the checklist alone", () => {
    const p = readyProfile();
    p.ucJourney = { ...p.ucJourney!, checks: { supplements: true, fees: true } };
    const before = computeJourney(p, fullBasics, true);
    expect(before.completeCount).toBe(4);
    expect(before.current).toBe(4);
    expect(before.checkpoints[4].complete).toBe(false);

    p.ucJourney = { ...p.ucJourney, submittedAt: Date.now() };
    const after = computeJourney(p, fullBasics, true);
    expect(after.completeCount).toBe(5);
    expect(after.finished).toBe(true);
  });

  it("lets students work ahead (current = first incomplete)", () => {
    const p = readyProfile();
    const j = computeJourney(p, none, true);
    expect(j.current).toBe(0);
    expect(j.checkpoints[1].complete).toBe(true);
    expect(j.completeCount).toBe(3);
  });
});

describe("map route", () => {
  it("is an orthogonal path through all five stops plus start and finish", () => {
    for (const layout of ["wide", "tall"] as const) {
      const pts = routePoints(layout);
      for (let i = 1; i < pts.length; i++) expect(pts[i][0] === pts[i - 1][0] || pts[i][1] === pts[i - 1][1]).toBe(true);
      expect(pts.at(-1)).toEqual(LAYOUTS[layout].finish);
      expect(LAYOUTS[layout].nodes).toHaveLength(5);
    }
  });
});
