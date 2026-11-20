import { describe, expect, it } from "vitest";
import { MENTORS } from "../game/characters";
import { STAGE_GUIDE } from "../journey/guides";
import { stepGuide, SWITCHER_GUIDES } from "../components/story/MentorSwitcher";

describe("stage guides", () => {
  it("gives every guide but Penny a stop (the journey ends at Apply; Penny is chat-only after that)", () => {
    const owners = new Set(Object.values(STAGE_GUIDE));
    for (const m of MENTORS) expect(owners.has(m.id)).toBe(m.id !== "penny");
  });
});

describe("after the journey: switching guides with the arrows", () => {
  it("steps through every guide one at a time and wraps around both ends", () => {
    expect(SWITCHER_GUIDES.map((g) => g.id)).toEqual([...MENTORS.map((m) => m.id), "counselor", "assistant"]);
    const first = SWITCHER_GUIDES[0].id;
    const last = SWITCHER_GUIDES[SWITCHER_GUIDES.length - 1].id;
    expect(stepGuide(first, 1)).toBe(SWITCHER_GUIDES[1].id);
    expect(stepGuide(first, -1)).toBe(last);
    expect(stepGuide(last, 1)).toBe(first);
  });

  it("includes Penny, and every guide has a standard greeting to open with", () => {
    expect(SWITCHER_GUIDES.some((g) => g.id === "penny")).toBe(true);
    for (const g of SWITCHER_GUIDES) expect(g.greeting("Maya")).toMatch(/Maya/);
  });
});
