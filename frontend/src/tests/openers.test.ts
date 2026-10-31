import { describe, expect, it } from "vitest";
import { mentorById } from "../game/characters";
import { financesUnknown, openerFor } from "../game/openers";
import { blankProfile } from "./fixtures";

describe("guide openers", () => {
  it("Quill asks you to pick a PIQ when none are chosen", () => {
    const opener = openerFor(mentorById("quill"), blankProfile(), "Maya");
    expect(opener.text).toMatch(/pick a Personal Insight Question/);
    expect(opener.actions).toHaveLength(8);
    expect(opener.actions.every((a) => a.kind === "pickPiq")).toBe(true);
  });

  it("Quill offers to write the PIQs you already chose", () => {
    const profile = blankProfile({
      ucJourney: { piqs: { leadership: "not-started", challenge: "drafting" }, checks: {}, submittedAt: null, followUps: {} },
    });
    const opener = openerFor(mentorById("quill"), profile, "");
    expect(opener.text).toContain("Leadership and Significant challenge");
    expect(opener.actions.map((a) => a.label)).toEqual(["Write: Leadership", "Write: Significant challenge"]);
    expect(opener.actions.every((a) => a.kind === "ask")).toBe(true);
  });

  it("Penny prompts a finance walkthrough only when the profile shows nothing", () => {
    const blank = blankProfile();
    expect(financesUnknown(blank)).toBe(true);
    expect(openerFor(mentorById("penny"), blank, "").actions).toHaveLength(1);

    const known = blankProfile({ preferences: { ...blank.preferences, needsAid: "yes", fafsa: "in-progress" } });
    expect(financesUnknown(known)).toBe(false);
    expect(openerFor(mentorById("penny"), known, "").actions).toHaveLength(0);
  });

  it("Sage just greets, with no topic options", () => {
    expect(openerFor(mentorById("sage"), blankProfile(), "Sam").actions).toEqual([]);
  });
});
