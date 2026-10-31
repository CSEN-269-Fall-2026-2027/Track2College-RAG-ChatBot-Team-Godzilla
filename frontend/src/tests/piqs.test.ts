import { describe, expect, it } from "vitest";
import { PIQ_PROMPTS } from "../journey/logic";
import { detailsComplete, nextDetailQuestion, PIQ_DETAIL_QUESTIONS, setPiqAnswer } from "../journey/piqs";
import { blankProfile } from "./fixtures";

describe("PIQ follow-up questions", () => {
  it("every UC PIQ has its own follow-ups, with at least two required", () => {
    for (const q of PIQ_PROMPTS) {
      const set = PIQ_DETAIL_QUESTIONS[q.id];
      expect(set, q.id).toBeDefined();
      expect(set.filter((d) => !d.optional).length, q.id).toBeGreaterThanOrEqual(2);
      expect(new Set(set.map((d) => d.id)).size).toBe(set.length);
    }
    expect(Object.keys(PIQ_DETAIL_QUESTIONS).sort()).toEqual(PIQ_PROMPTS.map((q) => q.id).sort());
  });

  it("asks what each official question requires", () => {
    const text = (id: string) => PIQ_DETAIL_QUESTIONS[id].filter((d) => !d.optional).map((d) => d.question).join(" ").toLowerCase();
    expect(text("leadership")).toMatch(/dispute/);
    expect(text("talent")).toMatch(/developed/);
    expect(text("talent")).toMatch(/demonstrated/);
    expect(text("challenge")).toMatch(/academic achievement/);
    expect(text("opportunity")).toMatch(/barrier/);
    expect(text("subject")).toMatch(/furthered/);
    expect(text("community")).toMatch(/role/);
    expect(text("standout")).toMatch(/strong candidate/);
  });

  it("re-asks a required question that was skipped and only then counts the PIQ complete", () => {
    let p = blankProfile();
    p = setPiqAnswer(p, "talent", "skill", "Piano");
    p = setPiqAnswer(p, "talent", "development", "Practiced daily");
    p = setPiqAnswer(p, "talent", "showcase", "");
    expect(detailsComplete(p, "talent")).toBe(false);
    expect(nextDetailQuestion(p, "talent")?.id).toBe("showcase");
    p = setPiqAnswer(p, "talent", "showcase", "Recitals and teaching kids");
    expect(detailsComplete(p, "talent")).toBe(true);
    expect(nextDetailQuestion(p, "talent")).toBeNull();
  });
});
