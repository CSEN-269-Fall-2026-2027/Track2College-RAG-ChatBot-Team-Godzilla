import { describe, expect, it } from "vitest";
import { MENTORS } from "../game/characters";
import { STAGE_GUIDE, stageFor } from "../journey/guides";

describe("stage guides", () => {
  it("gives every guide at least one planet", () => {
    const owners = new Set(Object.values(STAGE_GUIDE));
    for (const m of MENTORS) expect(owners.has(m.id)).toBe(true);
  });

  it("keeps the current chapter when its guide is the one asked", () => {
    expect(stageFor("sage", "review")).toBeNull();
    expect(stageFor("quill", "essays")).toBeNull();
  });

  it("selects the planet a different guide owns", () => {
    expect(stageFor("penny", "review")).toBe("ucs");
    expect(stageFor("milo", "profile")).toBe("activities");
    expect(stageFor("quill", "ucs")).toBe("essays");
    expect(stageFor("sage", "essays")).toBe("profile");
  });
});
