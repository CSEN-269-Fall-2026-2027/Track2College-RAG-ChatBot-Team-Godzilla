import { describe, expect, it } from "vitest";
import { ACTIVITY_QUESTIONS, emptyJourney, PIQ_PROMPTS, togglePiq } from "../journey/logic";
import { activitiesSummary, canGeneratePiq, PERSONAL_ANSWER, PERSONAL_PIQS, piqRequest, piqsToAutoDraft, setPiqAnswer } from "../journey/piqs";
import type { Profile } from "../types";
import { blankProfile } from "./fixtures";

function withPiqs(p: Profile, ids: string[]): Profile {
  let j = emptyJourney();
  for (const id of ids) j = togglePiq(j, id);
  return { ...p, ucJourney: { ...p.ucJourney, ...j, activitySurvey: p.ucJourney?.activitySurvey } };
}

const allNo = (p: Profile): Profile => ({
  ...p,
  ucJourney: {
    ...emptyJourney(),
    ...p.ucJourney,
    activitySurvey: Object.fromEntries(ACTIVITY_QUESTIONS.map((q) => [q.id, { count: 0 }])),
  },
});

describe("PIQ drafting from activities", () => {
  it("only asks for personal information on personal-life PIQs", () => {
    expect(Object.keys(PERSONAL_PIQS).sort()).toEqual(["challenge", "opportunity", "standout"]);
    for (const id of Object.keys(PERSONAL_PIQS)) expect(PIQ_PROMPTS.some((q) => q.id === id)).toBe(true);
    const p = withPiqs(blankProfile(), ["leadership", "challenge"]);
    expect(canGeneratePiq(p, "leadership")).toBe(true);
    expect(canGeneratePiq(p, "challenge")).toBe(false);
    // An empty answer still unlocks the draft (it just stays general).
    expect(canGeneratePiq(setPiqAnswer(p, "challenge", PERSONAL_ANSWER, ""), "challenge")).toBe(true);
  });

  it("auto-drafts only after the activities step is done", () => {
    const p = withPiqs(blankProfile(), ["leadership", "creativity", "talent", "challenge"]);
    expect(piqsToAutoDraft(p)).toEqual([]);
    const done = allNo(p);
    expect(piqsToAutoDraft(done)).toEqual(["leadership", "creativity", "talent"]);
    expect(piqsToAutoDraft(setPiqAnswer(done, "challenge", PERSONAL_ANSWER, "My dad lost his job"))).toEqual([
      "leadership",
      "creativity",
      "talent",
      "challenge",
    ]);
  });

  it("counts skipping activities on the Profile page as done", () => {
    const p = withPiqs(blankProfile(), ["leadership"]);
    expect(piqsToAutoDraft({ ...p, ucJourney: { ...p.ucJourney!, activitiesReviewed: true } })).toEqual(["leadership"]);
  });

  it("sends the personal answer and full activity details to the model", () => {
    let p = withPiqs(
      blankProfile({
        activities: [{ id: "a", name: "Robotics", role: "Captain", hoursPerWeek: "6", weeksPerYear: "", years: "", description: "Led 12 people.", category: "extracurricular" }],
      }),
      ["leadership", "standout"],
    );
    p = setPiqAnswer(p, "standout", PERSONAL_ANSWER, "I translate for my parents");
    expect(piqRequest(p)).toEqual([
      { id: "leadership", answers: [] },
      { id: "standout", answers: [{ question: PERSONAL_PIQS.standout, answer: "I translate for my parents" }] },
    ]);
    expect(activitiesSummary(p)).toContain("details: Led 12 people.");
  });
});
