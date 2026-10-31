import { describe, expect, it } from "vitest";
import { blankProfile } from "./fixtures";
import { applyDrafts, piqRequest } from "../journey/piqs";
import { completeness } from "../profile";
import { applyGuidedEffect, inputEffect, nextGuidedTurn, type GuidedEffect } from "../journey/guided";
import { ACTIVITY_QUESTIONS, computeJourney } from "../journey/logic";

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
        effect = inputEffect(turn, turn.input.field === "exams" ? "AP Calc 4" : "Something detailed enough for Quill")!;
      } else if (turn.id.startsWith("generate-")) {
        // Each essay is offered as soon as its own follow-ups are done; stand in for the Groq call.
        const gen = turn.choices[0]!.effect;
        expect(gen.type).toBe("generatePiqs");
        const ids = gen.type === "generatePiqs" ? gen.piqIds : [];
        expect(ids).toEqual([turn.id.slice("generate-".length)]);
        const req = piqRequest(p, ids);
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

  it("asks one open question for a personal-life PIQ and accepts an empty answer", () => {
    const sections = { basics: 1, academics: 1, campuses: 1, finances: 0 };
    let p = blankProfile({
      academics: { ...blankProfile().academics, gpaUnweighted: "3.7", exams: "None yet" },
      colleges: [{ id: "1", name: "UCLA", status: "researching", plan: "UC", deadline: "", notes: "", major: "Biology" }],
      activities: [
        { id: "a", name: "Robotics", role: "Lead", hoursPerWeek: "6", weeksPerYear: "36", years: "2", description: "Built robots.", category: "extracurricular" },
      ],
      ucJourney: {
        piqs: { leadership: "not-started", creativity: "not-started", challenge: "not-started", community: "not-started" },
        checks: {},
        submittedAt: null,
        followUps: {},
      },
    });
    const turn = nextGuidedTurn(p, sections, "");
    expect(turn.id).toBe("piq-personal-challenge");
    expect(turn.prompt).toContain("Please enter any information");
    expect(turn.choices).toEqual([]);
    expect(turn.input?.allowEmpty).toBe(true);
    p = applyGuidedEffect(p, inputEffect(turn, "")!, () => "x");
    expect(nextGuidedTurn(p, sections, "").id).toBe("generate-leadership");
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

  describe("activities chapter", () => {
    const sections = { basics: 1, academics: 1, campuses: 1, finances: 0 };
    const base = () =>
      blankProfile({
        academics: { ...blankProfile().academics, gpaUnweighted: "3.7", exams: "None yet" },
        colleges: [{ id: "1", name: "UCLA", status: "researching", plan: "UC", deadline: "", notes: "", major: "Biology" }],
      });
    let n = 0;
    const id = () => `act-${n++}`;

    it("asks directly whether the student plays sports, with how-many choices", () => {
      const turn = nextGuidedTurn(base(), sections, "");
      expect(turn.id).toBe("activity-sports");
      expect(turn.prompt.toLowerCase()).toContain("sports");
      expect(turn.choices.map((c) => c.label)).toEqual(["No", "Yes — 1", "Yes — 2", "Yes — 3 or more"]);
      expect(turn.input).toBeUndefined();
    });

    it("skips the details question after a No", () => {
      const p = applyGuidedEffect(base(), { type: "answerActivity", questionId: "sports", count: 0 }, id);
      expect(p.activities).toHaveLength(0);
      const turn = nextGuidedTurn(p, sections, "");
      expect(turn.id).toBe("activity-music");
      expect(turn.choices.map((c) => c.label)).toEqual(["Yes", "No"]);
    });

    it("after a Yes asks one optional details question that accepts an empty submit", () => {
      let p = applyGuidedEffect(base(), { type: "answerActivity", questionId: "sports", count: 2 }, id);
      expect(p.activities[0].name).toBe("Sports (2)");
      const turn = nextGuidedTurn(p, sections, "");
      expect(turn.id).toBe("activity-details-sports");
      expect(turn.choices).toEqual([]);
      expect(turn.input?.allowEmpty).toBe(true);

      const empty = inputEffect(turn, "");
      expect(empty).toEqual({ type: "activityDetails", questionId: "sports", value: "" });
      p = applyGuidedEffect(p, empty!, id);
      expect(p.activities[0].description).toBe("");
      expect(nextGuidedTurn(p, sections, "").id).toBe("activity-music");
    });

    it("saves typed details as the activity description", () => {
      let p = applyGuidedEffect(base(), { type: "answerActivity", questionId: "clubs", count: 1 }, id);
      p = applyGuidedEffect(p, { type: "activityDetails", questionId: "clubs", value: "Robotics club treasurer" }, id);
      expect(p.activities[0]).toMatchObject({ name: "Clubs", description: "Robotics club treasurer", category: "extracurricular" });
    });

    it("finishes the chapter once every question is answered, even all No", () => {
      let p = base();
      for (const q of ACTIVITY_QUESTIONS) p = applyGuidedEffect(p, { type: "answerActivity", questionId: q.id, count: 0 }, id);
      expect(computeJourney(p, sections, true).checkpoints[2].complete).toBe(true);
      expect(nextGuidedTurn(p, sections, "").checkpointId).toBe("essays");
    });
  });
});
