import { describe, expect, it } from "vitest";
import { blankProfile } from "./fixtures";
import { applyDrafts, piqRequest } from "../journey/piqs";
import { completeness } from "../profile";
import { applyGuidedEffect, nextGuidedTurn, type GuidedEffect } from "../journey/guided";

const HANDOFFS: GuidedEffect["type"][] = ["noop", "ask", "openManual", "resume", "generatePiqs", "openEssays"];

describe("nextGuidedTurn", () => {
  it("asks a grade question with four choices when empty", () => {
    const p = blankProfile({
      basics: {
        firstName: "Darren",
        lastName: "Tang",
        gradeLevel: "",
        graduationYear: "",
        highSchool: "",
        city: "",
        state: "",
        firstGen: "",
      },
    });
    const turn = nextGuidedTurn(p, completeness(p).sections, "Darren");
    expect(turn.checkpointId).toBe("profile");
    expect(turn.choices).toHaveLength(4);
    expect(turn.prompt.toLowerCase()).toContain("grade");
  });

  it("applies a grade choice", () => {
    const p = blankProfile({
      basics: {
        firstName: "Darren",
        lastName: "Tang",
        gradeLevel: "",
        graduationYear: "",
        highSchool: "",
        city: "",
        state: "",
        firstGen: "",
      },
    });
    const next = applyGuidedEffect(p, { type: "setBasics", patch: { gradeLevel: "11" } }, () => "x");
    expect(next.basics.gradeLevel).toBe("11");
  });

  it("offers a campus checkbox picker on the ucs chapter", () => {
    const sections = { basics: 1, academics: 0, campuses: 0, finances: 0 };
    const turn = nextGuidedTurn(
      blankProfile({
        academics: { ...blankProfile().academics, gpaUnweighted: "3.5", exams: "None yet" },
      }),
      sections,
      "",
    );
    expect(turn.checkpointId).toBe("ucs");
    expect(turn.id).toBe("pick-uc");
    expect(turn.campusPicker).toBe(true);
    expect(turn.choices).toEqual([]);
  });

  it("never stalls: saving replies keep advancing without idling", () => {
    let p = blankProfile();
    const seen: string[] = [];
    for (let n = 0; n < 120; n++) {
      const turn = nextGuidedTurn(p, completeness(p).sections, "Maya");
      seen.push(turn.id);
      if (turn.finished) break;
      expect(turn.id).not.toBe("idle");
      const choice = turn.choices.find((c) => !HANDOFFS.includes(c.effect.type));
      let effect: GuidedEffect;
      if (turn.campusPicker) {
        effect = { type: "setCampuses", campuses: ["UCLA", "UC Davis"] };
      } else if (turn.piqPicker) {
        effect = { type: "setPiqs", piqIds: ["leadership", "creativity", "talent", "community"] };
      } else if (choice) effect = choice.effect;
      else if (turn.input) {
        effect = {
          type: "applyText",
          field: turn.input.field,
          value: turn.input.field === "exams" ? "AP Calc 4" : "Something detailed enough for Quill",
        };
      } else if (turn.id.startsWith("generate-")) {
        // Each essay is offered as soon as its own follow-ups are done; stand in for the Groq call.
        const gen = turn.choices[0]!.effect;
        expect(gen.type).toBe("generatePiqs");
        const ids = gen.type === "generatePiqs" ? gen.piqIds : [];
        expect(ids).toEqual([turn.id.slice("generate-".length)]);
        const req = piqRequest(p, ids);
        expect(req[0].answers.length).toBeGreaterThanOrEqual(2);
        p = applyDrafts(p, req.map((r) => ({ id: r.id, question: "", essay: "word ".repeat(300).trim(), wordCount: 300 })));
        continue;
      } else {
        effect = turn.choices[0]!.effect;
      }
      const before = JSON.stringify(p);
      p = applyGuidedEffect(p, effect, () => `id-${n}`);
      if (JSON.stringify(p) === before && (effect.type === "noop" || HANDOFFS.includes(effect.type))) {
        // Defer-only turns are allowed to move the skip set forward via the caller; here advance by skipping id.
        continue;
      }
      expect(JSON.stringify(p), `turn ${turn.id} saved nothing`).not.toBe(before);
    }
    expect(seen.includes("idle")).toBe(false);
    expect(seen.length).toBeGreaterThan(5);
  });

  it("moves on to the next chapter when the student defers a question", () => {
    const p = blankProfile({
      basics: { ...blankProfile().basics, firstName: "Maya", gradeLevel: "11", graduationYear: "2027", highSchool: "Lincoln", state: "CA" },
    });
    const sections = completeness(p).sections;
    expect(nextGuidedTurn(p, sections, "Maya").checkpointId).toBe("profile");
    const skipped = new Set(["gpa", "exams"]);
    const next = nextGuidedTurn(p, sections, "Maya", skipped);
    expect(next.checkpointId).toBe("ucs");
    expect(next.speaker).toBe("sage");
  });

  it("hands each chapter to the guide who owns it", () => {
    const sections = { basics: 1, academics: 0, campuses: 0, finances: 0 };
    const essays = nextGuidedTurn(
      blankProfile({
        academics: { ...blankProfile().academics, gpaUnweighted: "3.7", exams: "None yet" },
        colleges: [{ id: "1", name: "UCLA", status: "researching", plan: "UC", deadline: "", notes: "", major: "Biology" }],
        activities: [
          {
            id: "a",
            name: "Robotics",
            role: "Lead",
            hoursPerWeek: "6",
            weeksPerYear: "36",
            years: "2",
            description: "Built robots.",
            category: "extracurricular",
          },
        ],
      }),
      sections,
    );
    expect(essays.checkpointId).toBe("essays");
    expect(essays.speaker).toBe("quill");
  });

  it("offers a 4-of-8 PIQ checkbox picker before essay follow-ups", () => {
    const sections = { basics: 1, academics: 1, campuses: 1, finances: 0 };
    const turn = nextGuidedTurn(
      blankProfile({
        academics: { ...blankProfile().academics, gpaUnweighted: "3.7", exams: "None yet" },
        colleges: [{ id: "1", name: "UCLA", status: "researching", plan: "UC", deadline: "", notes: "", major: "Biology" }],
        activities: [
          { id: "a", name: "Robotics", role: "Lead", hoursPerWeek: "6", weeksPerYear: "36", years: "2", description: "Built robots.", category: "extracurricular" },
        ],
      }),
      sections,
    );
    expect(turn.id).toBe("pick-piq");
    expect(turn.piqPicker).toBe(true);
  });

  it("offers to generate an essay as soon as that one PIQ's questions are done", () => {
    const sections = { basics: 1, academics: 1, campuses: 1, finances: 0 };
    let p = blankProfile({
      academics: { ...blankProfile().academics, gpaUnweighted: "3.7", exams: "None yet" },
      colleges: [{ id: "1", name: "UCLA", status: "researching", plan: "UC", deadline: "", notes: "", major: "Biology" }],
      activities: [
        { id: "a", name: "Robotics", role: "Lead", hoursPerWeek: "6", weeksPerYear: "36", years: "2", description: "Built robots.", category: "extracurricular" },
      ],
      ucJourney: {
        piqs: { leadership: "not-started", creativity: "not-started", talent: "not-started", community: "not-started" },
        checks: {},
        submittedAt: null,
        followUps: {},
      },
    });
    for (let i = 0; i < 3; i++) {
      const turn = nextGuidedTurn(p, sections, "");
      if (!turn.id.startsWith("piq-q-leadership-")) break;
      p = applyGuidedEffect(p, { type: "setPiqAnswer", piqId: "leadership", questionId: turn.input!.questionId!, value: "Real detail" }, () => "x");
    }
    const turn = nextGuidedTurn(p, sections, "");
    expect(turn.id).toBe("generate-leadership");
    expect(turn.choices[0].effect).toEqual({ type: "generatePiqs", piqIds: ["leadership"] });
  });
});
