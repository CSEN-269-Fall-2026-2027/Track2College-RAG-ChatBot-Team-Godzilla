/** The retired Apply page's data, now carried by the chatbot and story mode. */
import { describe, expect, it } from "vitest";
import { agentTasks, applyProgressSummary, fafsaSubmitted, setAgent } from "../agent/logic";
import { applyGuidedEffect, savedLabel } from "../journey/guided";
import { hydrate } from "../profile";
import { blankProfile } from "./fixtures";

const oct30 = new Date("2026-10-30T12:00:00Z");

describe("application progress for the chatbot", () => {
  it("says what the tools did, without the UC password or birth details", () => {
    const p = setAgent(blankProfile({ basics: { ...blankProfile().basics, graduationYear: "2027" } }), (a) => ({
      ...a,
      counselor: { name: "Ms. Rivera", email: "rivera@lincoln.edu", title: "Counselor", serves: "A–L", sourceUrl: "", confirmedAt: oct30.getTime() },
      counselorEmail: { subject: "UC application", body: "Hi", sentAt: oct30.getTime() },
      ucAccount: { email: "maya@example.com", password: "S3cret!Pass#word", generatedAt: 1, createdAt: 2, verifiedAt: 3, aboutAt: 4 },
    }));
    const text = applyProgressSummary(p, { birthDate: "2008-04-02", birthCity: "Fresno", birthCountry: "United States" }, oct30);

    expect(text).toMatch(/^APPLICATION PROGRESS/);
    expect(text).toContain("Ms. Rivera");
    expect(text).toContain("rivera@lincoln.edu");
    expect(text).toMatch(/Email to school counselor: sent Oct 30, 2026/);
    expect(text).toContain("account created; verified / signed in; \"About you\" filled in");
    expect(text).toContain("Birthday on file for the UC form: yes; birthplace on file: yes");
    expect(text).toContain("UC Statement of Intent to Register: not yet (due May 1, 2027)");
    expect(text).toMatch(/Upcoming dates: .*UC application deadline/);

    expect(text).not.toContain("S3cret!Pass#word");
    expect(text).not.toContain("2008-04-02");
    expect(text).not.toContain("Fresno");
  });

  it("reports an untouched student plainly", () => {
    const text = applyProgressSummary(blankProfile(), null, oct30);
    expect(text).toContain("School counselor: not looked up yet");
    expect(text).toContain("UC application account: not started");
    expect(text).toContain("UC application submitted: not yet");
    expect(text).not.toContain("Birthday on file");
  });
});

describe("one FAFSA flag", () => {
  it("folds the old Apply page's FAFSA flag into the Financial Aid answer on load", () => {
    const old = setAgent(blankProfile(), (a) => ({ ...a, fafsaDoneAt: 5 }));
    expect(old.preferences.fafsa).toBe("");
    const loaded = hydrate(old, blankProfile());
    expect(loaded.preferences.fafsa).toBe("done");
    // The old flag is dropped once folded in, so a later "in progress" answer survives a reload.
    expect(loaded.ucJourney?.agent?.fafsaDoneAt).toBeUndefined();
    const changed = { ...loaded, preferences: { ...loaded.preferences, fafsa: "in-progress" as const } };
    expect(hydrate(JSON.parse(JSON.stringify(changed)), blankProfile()).preferences.fafsa).toBe("in-progress");
    expect(hydrate(blankProfile(), blankProfile()).preferences.fafsa).toBe("");
  });

  it("counts the FAFSA done from either place", () => {
    const viaStory = blankProfile({ preferences: { ...blankProfile().preferences, fafsa: "done" } });
    expect(fafsaSubmitted(viaStory)).toBe(true);
    expect(agentTasks(viaStory).find((t) => t.id === "fafsa")!.done).toBe(true);
    expect(fafsaSubmitted(blankProfile())).toBe(false);
  });
});

describe("Intent to Register in story mode", () => {
  it("records and undoes the Statement of Intent to Register", () => {
    const done = applyGuidedEffect(blankProfile(), { type: "setSirDone", done: true }, () => "x");
    expect(agentTasks(done).find((t) => t.id === "sir")!.done).toBe(true);
    expect(savedLabel({ type: "setSirDone", done: true })).toBe("Recorded your Intent to Register");
    const undone = applyGuidedEffect(done, { type: "setSirDone", done: false }, () => "x");
    expect(agentTasks(undone).find((t) => t.id === "sir")!.done).toBe(false);
  });
});
