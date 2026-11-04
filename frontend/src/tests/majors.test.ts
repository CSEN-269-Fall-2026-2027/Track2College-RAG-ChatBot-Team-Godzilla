/** One intended major for every UC campus, chosen from ten large UC majors or "Other". */
import { describe, expect, it } from "vitest";
import { MAJOR_CHOICES, toMajorChoice } from "../constants";
import { applyGuidedEffect, nextGuidedTurn } from "../journey/guided";
import { toggleCampus } from "../journey/logic";
import { hydrate, profileSummary } from "../profile";
import { blankProfile } from "./fixtures";

describe("major choices", () => {
  it("has ten majors plus Other", () => {
    expect(MAJOR_CHOICES).toHaveLength(11);
    expect(MAJOR_CHOICES.at(-1)).toBe("Other");
  });

  it("maps typed or older majors onto the choices", () => {
    expect(toMajorChoice("computer science")).toBe("Computer Science");
    expect(toMajorChoice("Biological Sciences")).toBe("Biology");
    expect(toMajorChoice("Bioengineering")).toBe("Engineering");
    expect(toMajorChoice("Business Economics")).toBe("Business");
    expect(toMajorChoice("Applied Mathematics")).toBe("Mathematics");
    expect(toMajorChoice("Film & Media Studies")).toBe("Other");
    expect(toMajorChoice("Undeclared")).toBe("");
    expect(toMajorChoice("  ")).toBe("");
  });
});

describe("saved profiles", () => {
  it("moves an older per-campus major into the one intended major", () => {
    const old = { ...blankProfile(), colleges: [{ id: "1", name: "UCLA", status: "researching" as const, plan: "UC" as const, deadline: "", notes: "", major: "Psych" }] };
    const { intendedMajor, ...goals } = old.goals;
    void intendedMajor;
    expect(hydrate({ ...old, goals: goals as typeof old.goals }, blankProfile()).goals.intendedMajor).toBe("Psychology");
  });

  it("falls back to an onboarding interest, and keeps a saved choice as is", () => {
    const { intendedMajor, ...rest } = blankProfile().goals;
    void intendedMajor;
    const fromInterest = { ...blankProfile(), goals: { ...rest, majors: ["Undecided", "Economics"] } as ReturnType<typeof blankProfile>["goals"] };
    expect(hydrate(fromInterest, blankProfile()).goals.intendedMajor).toBe("Economics");
    const chosen = { ...blankProfile(), goals: { ...blankProfile().goals, intendedMajor: "Other" } };
    expect(hydrate(chosen, blankProfile()).goals.intendedMajor).toBe("Other");
  });

  it("tells the chatbot the one major that applies everywhere", () => {
    const p = { ...blankProfile(), goals: { ...blankProfile().goals, intendedMajor: "Engineering" } };
    expect(profileSummary(p)).toContain("Intended major (the same at every UC campus): Engineering");
    expect(profileSummary(blankProfile())).toContain("Intended major (the same at every UC campus): not chosen yet");
  });
});

describe("story mode", () => {
  it("asks for one major after campuses are picked, with the ten choices and Other", () => {
    const sections = { basics: 1, academics: 1, campuses: 0, finances: 0 };
    let p = blankProfile({
      basics: { ...blankProfile().basics, firstName: "Maya", gradeLevel: "12", graduationYear: "2027", highSchool: "Lincoln", city: "Fresno", state: "CA" },
      academics: { ...blankProfile().academics, gpaUnweighted: "3.8", exams: "None yet" },
    });
    p = toggleCampus(toggleCampus(p, "UCLA", () => "a"), "UC Davis", () => "b");
    const turn = nextGuidedTurn(p, sections, "Maya");
    expect(turn.id).toBe("major");
    expect(turn.choices.map((c) => c.label)).toEqual([...MAJOR_CHOICES, "Help me pick a major"]);

    const picked = applyGuidedEffect(p, turn.choices[1].effect, () => "x");
    expect(picked.goals.intendedMajor).toBe("Computer Science");
    expect(nextGuidedTurn(picked, sections, "Maya").id).not.toBe("major");
  });
});
