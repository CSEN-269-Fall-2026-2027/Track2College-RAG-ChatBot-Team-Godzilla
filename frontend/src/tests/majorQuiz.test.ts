import { describe, expect, it } from "vitest";
import { AREAS, QUIZ, miloPrompt, quizComplete, scoreQuiz, topAreas, type QuizAnswers } from "../journey/majorQuiz";

const all = (pick: (q: (typeof QUIZ)[number]) => string): QuizAnswers => Object.fromEntries(QUIZ.map((q) => [q.id, pick(q)]));

describe("major match survey", () => {
  it("every option points at real areas and every area can be reached", () => {
    const reached = new Set<string>();
    for (const q of QUIZ) for (const o of q.options) o.areas.forEach((a) => (expect(AREAS[a]).toBeDefined(), reached.add(a)));
    expect([...reached].sort()).toEqual(Object.keys(AREAS).sort());
  });

  it("is complete only when every question has a valid answer", () => {
    expect(quizComplete({})).toBe(false);
    expect(quizComplete(all((q) => q.options[0].id))).toBe(true);
    expect(quizComplete({ ...all((q) => q.options[0].id), class: "nope" })).toBe(false);
  });

  it("ranks the area a student keeps choosing first", () => {
    const arty = all((q) => q.options.find((o) => o.areas[0] === "arts")!.id);
    expect(topAreas(arty)[0].id).toBe("arts");
    expect(scoreQuiz(arty)[0].score).toBe(QUIZ.length * 2);
  });

  it("returns at most three areas, only ones with points", () => {
    expect(topAreas({})).toEqual([]);
    const one = { class: "art" };
    expect(topAreas(one).map((a) => a.id)).toEqual(["arts"]);
    expect(topAreas(all((q) => q.options[0].id)).length).toBe(3);
  });

  it("asks Milo about the actual results", () => {
    const prompt = miloPrompt([AREAS.tech, AREAS.health]);
    expect(prompt).toContain("Computing & data");
    expect(prompt).toContain("Public Health");
    expect(prompt.toLowerCase()).toContain("major");
  });
});
