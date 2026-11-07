import { describe, expect, it } from "vitest";
import { emptyJourney, togglePiq } from "../journey/logic";
import { activitiesSummary, applyDrafts, canGeneratePiq, chosenPiqs, countWords, currentEssay, deleteDraft, editDraft, essayHasText, essayHelpRequest, essaysReadyCount, essayNotesFrom, limitWords, PERSONAL_ANSWER, piqAboutAsk, resetEssays, piqRequest, setPiqAnswer, suggestEssaysPrompt, suggestedPiqTitles, usedActivities } from "../journey/piqs";
import type { Profile } from "../types";
import { blankProfile } from "./fixtures";

function withPiqs(p: Profile, ids: string[]): Profile {
  let j = emptyJourney();
  for (const id of ids) j = togglePiq(j, id);
  return { ...p, ucJourney: { ...p.ucJourney, ...j, activitySurvey: p.ucJourney?.activitySurvey } };
}

describe("UC's word limit", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

  it("cuts anything past 350 words, keeping the essay's own spacing", () => {
    expect(countWords(limitWords(words(500)))).toBe(350);
    expect(limitWords(words(350))).toBe(words(350));
    expect(limitWords("one  two\n\nthree ", 2)).toBe("one  two");
    expect(limitWords("still typing ", 3)).toBe("still typing ");
  });

  it("holds when a student pastes past it while editing", () => {
    let p = applyDrafts(blankProfile(), [{ id: "leadership", question: "", essay: words(10), wordCount: 10 }]);
    p = editDraft(p, "leadership", words(900));
    expect(p.piqWork?.leadership.draft).toMatchObject({ text: words(350), words: 350 });
  });

  it("holds on generated drafts", () => {
    const p = applyDrafts(blankProfile(), [{ id: "leadership", question: "", essay: words(400), wordCount: 400 }]);
    expect(p.piqWork?.leadership.draft?.words).toBe(350);
  });
});

describe("how many essays an activity can carry", () => {
  const act = (id: string, name: string) => ({ id, name, role: "", hoursPerWeek: "", weeksPerYear: "", years: "", description: "", category: "extracurricular" as const });
  const withActs = (...names: string[]) => withPiqs(blankProfile({ activities: names.map((n, i) => act(String(i), n)) }), ["leadership", "creativity", "talent", "community"]);
  const write = (p: ReturnType<typeof withActs>, id: string, essay: string) => applyDrafts(p, [{ id, question: "", essay, wordCount: 0 }]);

  it("lets a student's only activity go in two essays, then stops", () => {
    let p = withActs("Soccer Team");
    expect(usedActivities(p, "creativity")).toEqual([]);
    p = write(p, "leadership", "As soccer captain I learned to lead.");
    expect(usedActivities(p, "creativity")).toEqual([]);
    p = write(p, "creativity", "On the soccer field I invented a new drill.");
    expect(usedActivities(p, "talent")).toEqual(["soccer"]);
    expect(piqRequest(p, ["talent"])[0].used_activities).toEqual(["soccer"]);
  });

  it("gives every activity a first essay before any gets a second", () => {
    let p = withActs("Soccer Team", "Robotics Club");
    p = write(p, "leadership", "As soccer captain I learned to lead.");
    expect(usedActivities(p, "creativity")).toEqual(["soccer"]);
    p = write(p, "creativity", "In robotics I built an arm.");
    expect(usedActivities(p, "talent")).toEqual([]);
  });

  it("doesn't count an essay against itself, so rewriting it can keep the same activity", () => {
    let p = withActs("Soccer Team");
    p = write(write(p, "leadership", "Soccer one."), "creativity", "Soccer two.");
    expect(usedActivities(p, "leadership")).toEqual([]);
  });

  it("doesn't count major or general essays, or a chance word match", () => {
    const p = write(withActs("Key Club", "Soccer"), "leadership", "I love computer science. The key is practice.");
    expect(usedActivities(p, "creativity")).toEqual([]);
  });

  it("counts what the student told Quill, but not Quill's own words", () => {
    const told = setPiqAnswer(withActs("Soccer", "Robotics"), "talent", PERSONAL_ANSWER, "Quill: Could robotics work?\nStudent: I want to write about soccer.");
    expect(usedActivities(told, "creativity")).toEqual(["soccer"]);
  });

  it("ignores old drafts the app wrote on its own", () => {
    const p = { ...withActs("Soccer", "Robotics"), piqWork: { leadership: { answers: {}, draft: { text: "Soccer taught me.", words: 3, generatedAt: 1 } } } };
    expect(usedActivities(p, "creativity")).toEqual([]);
  });

  it("spells out the limit in the suggestion request, or asks for general essays with no activities", () => {
    expect(suggestEssaysPrompt(withActs("Soccer"))).toContain("My activities: Soccer.");
    expect(suggestEssaysPrompt(withActs())).toContain("no activities");
    expect(suggestEssaysPrompt(withActs("Soccer"))).toContain("The Backup can be anything");
  });

  it("reads Top 4 and Backup titles from Quill's suggestion reply in order", () => {
    const reply = `**Top 4**
1. Leadership (Prompt #1) — your soccer captain story
2. Community (Prompt #7) — robotics outreach
3. Talent or skill (Prompt #3) — piano
4. Academic subject (Prompt #6) — CS interest

**Backup**
5. Creativity (Prompt #2) — if one of those doesn't fit`;
    expect(suggestedPiqTitles(reply)).toEqual([
      "Leadership",
      "Community",
      "Talent or skill",
      "Academic subject",
      "Creativity",
    ]);
    expect(piqAboutAsk("Leadership")).toMatchObject({
      display: "Tell me about the Leadership question.",
      prompt: expect.stringContaining("positively influenced others"),
    });
    expect(piqAboutAsk("not a real essay")).toBeNull();
  });
});

describe("PIQ drafting from activities", () => {
  it("can write any chosen PIQ, and nothing unchosen", () => {
    const p = withPiqs(blankProfile(), ["leadership", "challenge"]);
    expect(canGeneratePiq(p, "challenge")).toBe(true);
    expect(canGeneratePiq(p, "community")).toBe(false);
  });

  it("works through the essays in order, past finished and skipped ones", () => {
    const p = withPiqs(blankProfile(), ["leadership", "creativity", "talent", "challenge"]);
    expect(currentEssay(p)).toBe("leadership");
    const ready = { ...p, ucJourney: { ...p.ucJourney!, piqs: { ...p.ucJourney!.piqs, leadership: "ready" as const } } };
    expect(currentEssay(ready)).toBe("creativity");
    const skipped = { ...ready, ucJourney: { ...ready.ucJourney!, skippedPiqs: ["creativity"] } };
    expect(currentEssay(skipped)).toBe("talent");
    const allSkipped = { ...ready, ucJourney: { ...ready.ucJourney!, skippedPiqs: ["creativity", "talent", "challenge"] } };
    expect(currentEssay(allSkipped)).toBe("creativity");
    expect(currentEssay(withPiqs(blankProfile(), ["leadership"]))).toBeNull();
  });

  it("brings a skipped essay back once it's written", () => {
    const p = withPiqs(blankProfile(), ["leadership"]);
    const skipped = { ...p, ucJourney: { ...p.ucJourney!, skippedPiqs: ["leadership"] } };
    expect(applyDrafts(skipped, [{ id: "leadership", question: "", essay: "An essay.", wordCount: 2 }]).ucJourney?.skippedPiqs).toEqual([]);
  });

  it("saves what the student typed to Quill, not the button messages or Quill's closing line", () => {
    const say = (role: "user" | "assistant", content: string, n: number, preset = false) => ({ id: String(n), role, content, createdAt: n, preset });
    expect(
      essayNotesFrom([
        say("user", "Analyze my readiness", 0, true),
        say("assistant", "Tell me about a barrier you faced.", 1),
        say("user", "My school had no AP classes.", 2),
        say("assistant", "You're ready.", 3),
        say("user", "How can I write it well?", 4, true),
        say("assistant", "Lead with the barrier.", 5),
      ]),
    ).toBe("Quill: Tell me about a barrier you faced.\nStudent: My school had no AP classes.");
  });

  it("sends what the student told Quill and full activity details to the model", () => {
    let p = withPiqs(
      blankProfile({
        activities: [{ id: "a", name: "Robotics", role: "Captain", hoursPerWeek: "6", weeksPerYear: "", years: "", description: "Led 12 people.", category: "extracurricular" }],
      }),
      ["leadership", "standout"],
    );
    p = setPiqAnswer(p, "standout", PERSONAL_ANSWER, "I translate for my parents");
    expect(piqRequest(p)).toEqual([
      { id: "leadership", answers: [], used_activities: [] },
      { id: "standout", answers: [{ question: "What the student told Quill about this essay", answer: "I translate for my parents" }], used_activities: [] },
    ]);
    expect(activitiesSummary(p)).toContain("details: Led 12 people.");
  });

  describe("essays page", () => {
    const chosen = () =>
      blankProfile({ ucJourney: { piqs: { leadership: "not-started", creativity: "not-started", talent: "not-started", community: "not-started" }, checks: {}, submittedAt: null, followUps: {} } });

    it("counts an essay as ready as soon as it has text, and not after it's deleted", () => {
      let p = chosen();
      expect(essaysReadyCount(p)).toBe(0);
      p = editDraft(p, "leadership", "   ");
      expect(essayHasText(p, "leadership")).toBe(false);
      p = editDraft(p, "leadership", "I led the team.");
      p = editDraft(p, "talent", "I play piano.");
      expect(essaysReadyCount(p)).toBe(2);
      expect(essaysReadyCount(deleteDraft(p, "talent"))).toBe(1);
    });

    it("shows a short line to the student and sends the real essay to Quill", () => {
      const p = editDraft(chosen(), "leadership", "I led the team through a 5-0 loss.");
      const help = essayHelpRequest(p, "leadership");
      expect(help.display).toBe("I need help with my essay on Leadership.");
      expect(help.display).not.toContain("5-0");
      expect(help.query).toContain("I led the team through a 5-0 loss.");
      expect(help.query).toContain("Describe an example of your leadership experience");
    });

    it("Reset removes the four questions and their essays, and nothing else", () => {
      let p = editDraft(chosen(), "leadership", "I led the team.");
      p = setPiqAnswer(p, "talent", PERSONAL_ANSWER, "Piano");
      p = { ...p, activities: [{ id: "a", name: "Soccer", role: "", hoursPerWeek: "", weeksPerYear: "", years: "", description: "", category: "extracurricular" }] };
      p = { ...p, ucJourney: { ...p.ucJourney!, skippedPiqs: ["community"], checks: { fees: true } } };
      p = editDraft(p, "standout", "An essay from a question they switched away from.");

      const reset = resetEssays(p);
      expect(chosenPiqs(reset)).toEqual([]);
      expect(essaysReadyCount(reset)).toBe(0);
      expect(reset.piqWork?.leadership).toBeUndefined();
      expect(reset.piqWork?.talent).toBeUndefined();
      expect(reset.piqWork?.standout?.draft?.text).toContain("switched away");
      expect(reset.ucJourney?.skippedPiqs).toBeUndefined();
      expect(reset.ucJourney?.checks).toEqual({ fees: true });
      expect(reset.activities).toHaveLength(1);
    });

    it("tells Quill when nothing is written yet", () => {
      expect(essayHelpRequest(chosen(), "talent").query).toContain("I haven't written anything for it yet.");
    });
  });
});
