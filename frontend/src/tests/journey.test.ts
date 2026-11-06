/** UC Journey Map progress rules (pure logic; no React or Supabase). */
import { describe, expect, it } from "vitest";
import { computeJourney, emptyJourney, setPiqStatus, toggleCampus, togglePiq } from "../journey/logic";
import { STAGE_GUIDE } from "../journey/guides";
import { GRID, mapLayout, planetPixels, routeLegs } from "../journey/planets";
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
  p = toggleCampus(p, "UC Davis", id);
  p = { ...p, goals: { ...p.goals, intendedMajor: "Biology" } };
  let j = emptyJourney();
  for (const q of ["leadership", "creativity", "talent", "community"]) j = setPiqStatus(togglePiq(j, q), q, "ready");
  return { ...p, ucJourney: j };
}

describe("UC journey progress", () => {
  it("starts at checkpoint 1 with nothing complete for a blank student", () => {
    const j = computeJourney(blankProfile(), none, false);
    expect(j.checkpoints.map((c) => c.title)).toEqual(["Basic Info", "Choose UCs", "Work on Activities List", "Four Essays", "Review & Apply", "Financial Aid"]);
    expect(j.completeCount).toBe(0);
    expect(j.current).toBe(0);
  });

  it("derives profile completion from basics + academic start (not goals)", () => {
    expect(computeJourney(blankProfile(), fullBasics, true).checkpoints[0].complete).toBe(true);
    expect(computeJourney(blankProfile(), fullBasics, false).checkpoints[0].complete).toBe(false);
    expect(computeJourney(blankProfile(), { ...fullBasics, basics: 0 }, true).checkpoints[0].complete).toBe(false);
  });

  it("needs one intended major for all saved UCs", () => {
    let p = toggleCampus(blankProfile(), "UCLA", id);
    p = toggleCampus(p, "UC Irvine", id);
    const ucs = computeJourney(p, fullBasics, true).checkpoints[1];
    expect(ucs.complete).toBe(false);
    expect(ucs.tasks[1].detail).toBe("One major for all your UC campuses");
    const chosen = { ...p, goals: { ...p.goals, intendedMajor: "Mathematics" } };
    expect(computeJourney(chosen, fullBasics, true).checkpoints[1].complete).toBe(true);
    expect(computeJourney(chosen, fullBasics, true).checkpoints[1].tasks[1].detail).toBe("Mathematics at every campus");
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
    // Financial Aid is still open after submitting.
    expect(after.finished).toBe(false);
    expect(after.checkpoints[after.current].id).toBe("aid");
  });

  it("finishes Financial Aid once the student answers the aid question and files", () => {
    const p = readyProfile();
    p.ucJourney = { ...p.ucJourney!, submittedAt: Date.now() };
    p.preferences = { ...p.preferences, needsAid: "yes", fafsa: "in-progress" };
    const aid = (q: typeof p) => computeJourney(q, fullBasics, true).checkpoints.find((c) => c.id === "aid")!;
    expect(aid(p).complete).toBe(false);
    p.preferences = { ...p.preferences, fafsa: "done" };
    expect(aid(p).complete).toBe(true);
    expect(computeJourney(p, fullBasics, true).finished).toBe(true);
  });

  it("doesn't require filing aid forms from students who say they won't need aid", () => {
    const p = readyProfile();
    p.preferences = { ...p.preferences, needsAid: "no", fafsa: "" };
    const aid = computeJourney(p, fullBasics, true).checkpoints.find((c) => c.id === "aid")!;
    expect(aid.complete).toBe(true);
  });

  it("lets students work ahead (current = first incomplete)", () => {
    const p = readyProfile();
    const j = computeJourney(p, none, true);
    expect(j.current).toBe(0);
    expect(j.checkpoints[1].complete).toBe(true);
    expect(j.completeCount).toBe(3);
  });
});

describe("journey planet map", () => {
  const ids = ["profile", "ucs", "activities", "essays", "review", "aid"] as const;

  it("draws every planet on the same grid, with the same outline and comparable weight", () => {
    const sizes = ids.map((id) => {
      const runs = planetPixels(id);
      for (const r of runs) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(GRID);
        expect(r.y).toBeLessThan(GRID);
        // Every sprite character maps to a palette colour.
        expect(r.fill).toMatch(/^#[0-9a-f]{6}$/i);
      }
      expect(runs.some((r) => r.fill === "#232a3a")).toBe(true);
      return runs.reduce((n, r) => n + r.w, 0);
    });
    // Same body for all; the ring and flag add a little, never enough to unbalance the row.
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeLessThan(1.35);
  });

  it("gives each chapter its own art", () => {
    const art = new Set(ids.map((id) => JSON.stringify(planetPixels(id))));
    expect(art.size).toBe(6);
  });

  it("joins the start pad and five planets in a row with one straight leg each", () => {
    const pts = [{ x: 10, y: 80 }, ...[0, 1, 2, 3, 4].map((i) => ({ x: 60 + i * 110, y: 80 }))];
    const legs = routeLegs(pts);
    expect(legs).toHaveLength(5);
    // Every control point stays on the row, so the route is a straight line.
    for (const d of legs) expect(d.match(/[\d.]+ ([\d.]+)/g)!.every((xy) => xy.endsWith(" 80"))).toBe(true);
  });

  it("switches to a list when there isn't room for five labelled planets in a row", () => {
    expect(mapLayout(390)).toBe("tall");
    expect(mapLayout(399)).toBe("tall");
    expect(mapLayout(400)).toBe("wide");
  });
});

describe("guides on the journey", () => {
  it("gives every stop a person to talk to: Sage first and at Review & Apply, Theo for campuses, Penny for aid at the end", () => {
    expect(STAGE_GUIDE).toEqual({ profile: "sage", ucs: "theo", activities: "milo", essays: "quill", review: "sage", aid: "penny" });
  });
});
