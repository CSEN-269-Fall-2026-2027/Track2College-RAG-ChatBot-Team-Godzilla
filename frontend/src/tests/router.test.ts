/** Hash routing, including old Materials links that now live in Profile. */
import { describe, expect, it } from "vitest";
import { parseLocation } from "../router";

describe("router", () => {
  it("sends old Materials links to the matching Profile section", () => {
    expect(parseLocation("#/materials/essays")).toEqual({ route: "profile", param: "essays" });
    expect(parseLocation("#/materials/transcript")).toEqual({ route: "profile", param: "academics" });
    expect(parseLocation("#/materials/plan")).toEqual({ route: "profile", param: "academics" });
    expect(parseLocation("#/materials")).toEqual({ route: "profile", param: "essays" });
    expect(parseLocation("#/insights/plan")).toEqual({ route: "profile", param: "academics" });
  });

  it("keeps current routes and sends unknown ones to Advisor", () => {
    expect(parseLocation("#/profile/academics")).toEqual({ route: "profile", param: "academics" });
    expect(parseLocation("#/agent")).toEqual({ route: "agent", param: null });
    expect(parseLocation("")).toEqual({ route: "advisor", param: null });
    expect(parseLocation("#/nope")).toEqual({ route: "advisor", param: null });
  });
});
