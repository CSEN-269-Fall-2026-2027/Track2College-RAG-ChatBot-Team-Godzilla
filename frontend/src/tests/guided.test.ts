import { describe, expect, it } from "vitest";
import { blankProfile } from "./fixtures";
import { applyDrafts, autoPickPiqs, currentEssay, editDraft, piqRequest } from "../journey/piqs";
import { mentorById } from "../game/characters";
import { openerFor } from "../game/openers";
import { completeness } from "../profile";
import { setAgent } from "../agent/logic";
import { applyGuidedEffect, inputEffect, nextGuidedTurn, storyComplete, type GuidedEffect } from "../journey/guided";
import { computeJourney, isReviewStage, journeyOf } from "../journey/logic";

const HANDOFFS: GuidedEffect["type"][] = ["noop", "ask", "focusChat", "resume", "generatePiqs", "pasteEssay"];

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
      // The application stops unlock only once everything before them is done.
      if (isReviewStage(turn.checkpointId)) expect(storyComplete(p, completeness(p).sections)).toBe(true);
      // The counselor and apply stops complete via their tools (email, Jordan, UC account, applied), not guided bubbles.
      if (isReviewStage(turn.checkpointId)) {
        p = setAgent(p, (a) => ({
          ...a,
          counselorCall: a.counselorCall ?? {
            endedAt: 1,
            lines: [
              { role: "student", text: "I'm good" },
              {
                role: "counselor",
                text: "Thanks so much for talking with me today! When you're ready, you can go ahead with your UC application.",
              },
            ],
          },
          counselorEmail: a.counselorEmail ?? { subject: "Hi", body: "Hello", sentAt: 1 },
          counselorDoneAt: a.counselorDoneAt ?? 1,
          ucAccount: {
            email: "maya@example.com",
            password: "Tq7#mVx2!pLr9Kd4",
            generatedAt: 1,
            verifiedAt: 1,
            signedInAt: 1,
            piqAt: 1,
            ...a.ucAccount,
          },
        }));
        continue;
      }
      const choice = turn.choices.find((c) => !HANDOFFS.includes(c.effect.type));
      let effect: GuidedEffect;
      if (turn.id === "activities-list") {
        // Milo's Confirm on the found list.
        p = { ...p, ucJourney: { ...journeyOf(p), activitiesReviewed: true } };
        continue;
      }
      if (turn.id === "confirm-piq-chat" || turn.id === "draft-piq-chat") {
        // Chat opener owns confirm + draft-all; stand in for Sounds good + Groq.
        const ids = turn.id === "confirm-piq-chat" ? autoPickPiqs(p) : Object.keys(journeyOf(p).piqs);
        if (turn.id === "confirm-piq-chat") p = applyGuidedEffect(p, { type: "setPiqs", piqIds: ids }, () => `id-${n}`);
        const req = piqRequest(p, ids);
        p = applyDrafts(p, req.map((r) => ({ id: r.id, question: "", essay: "word ".repeat(300).trim(), wordCount: 300 })));
        continue;
      }
      if (turn.campusPicker) {
        effect = { type: "setCampuses", campuses: ["UCLA", "UC Davis"] };
      } else if (choice) effect = choice.effect;
      else if (turn.input) {
        effect = inputEffect(turn, turn.input.field === "exams" ? "AP Calc 4" : "Something detailed enough for Quill")!;
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
    // Applying is the last stop: no Financial Aid questions, and the story ends in free chat.
    expect(seen.some((id) => id.startsWith("aid"))).toBe(false);
    expect(seen.at(-1)).toBe("done");
  });

  describe("questions left in the chapter", () => {
    const sections = { basics: 1, academics: 1, campuses: 0, finances: 0 };
    const ready = blankProfile({
      basics: { ...blankProfile().basics, firstName: "Maya", gradeLevel: "12", graduationYear: "2027", highSchool: "Lincoln", city: "Fresno", state: "CA" },
      academics: { ...blankProfile().academics, gpaUnweighted: "3.8" },
    });

    it("counts down as questions are answered, not by tasks done", () => {
      expect(nextGuidedTurn(ready, sections, "Maya").chapter).toBe("Campuses · 2 questions left");
      const picked = applyGuidedEffect(ready, { type: "setCampuses", campuses: ["UCLA"] }, () => "x");
      expect(nextGuidedTurn(picked, sections, "Maya").chapter).toBe("Campuses · 1 question left");
    });

    it("stays on the counselor stop when Applied is done but the counselor tasks aren't — don't jump to Aid", () => {
      let p = blankProfile({
        basics: { ...blankProfile().basics, firstName: "Maya", gradeLevel: "12", graduationYear: "2027", highSchool: "Lincoln", city: "Fresno", state: "CA" },
        academics: { ...blankProfile().academics, gpaUnweighted: "3.8" },
        goals: { ...blankProfile().goals, intendedMajor: "Biology" },
        colleges: [{ id: "1", name: "UCLA", status: "researching", plan: "UC", deadline: "", notes: "", major: "" }],
        activities: [{ id: "a", name: "Robotics", role: "Captain", hoursPerWeek: "6", weeksPerYear: "36", years: "3", description: "Led a team.", category: "extracurricular" }],
        ucJourney: {
          piqs: { leadership: "ready", creativity: "ready", talent: "ready", community: "ready" },
          checks: {},
          submittedAt: null,
          followUps: {},
          activitiesReviewed: true,
        },
      });
      p = setAgent(p, () => ({
        // Applied only — counselor still missing, so Review isn't complete.
        ucAccount: { email: "a@b.c", password: "x", generatedAt: 1, verifiedAt: 2, signedInAt: 2, piqAt: 3 },
      }));
      const turn = nextGuidedTurn(p, completeness(p).sections, "Maya");
      expect(turn.checkpointId).toBe("counselor");
      expect(turn.id).toBe("counselor-tools");
      expect(turn.speaker).toBe("counselor");
      expect(turn.chatOnly).toBe(true);
      expect(turn.chapter).toBe("Counselor · 2 tasks left");
    });

    it("doesn't count a major chosen in onboarding, or a question the student put off", () => {
      const major = { ...ready, goals: { ...ready.goals, intendedMajor: "Biology" } };
      expect(nextGuidedTurn(major, sections, "Maya").chapter).toBe("Campuses · 1 question left");
      expect(nextGuidedTurn(ready, sections, "Maya", new Set(["pick-uc"])).chapter).toBe("Campuses · 1 question left");
    });

    it("counts only the GPA question when saving it finishes academic history", () => {
      const noGpa = { ...ready, academics: blankProfile().academics };
      const turn = nextGuidedTurn(noGpa, { ...sections, academics: 0 }, "Maya");
      expect(turn.id).toBe("gpa");
      expect(turn.chapter).toBe("Basic info · 1 question left");
    });
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
    expect(next.speaker).toBe("theo");
  });

  it("hands each chapter to the guide who owns it", () => {
    const sections = { basics: 1, academics: 0, campuses: 0, finances: 0 };
    const essays = nextGuidedTurn(
      blankProfile({
        academics: { ...blankProfile().academics, gpaUnweighted: "3.7", exams: "None yet" },
        colleges: [{ id: "1", name: "UCLA", status: "researching", plan: "UC", deadline: "", notes: "", major: "Biology" }],
        goals: { ...blankProfile().goals, intendedMajor: "Biology" },
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

  it("holds essays in chat-only mode until the opener confirms the four picks", () => {
    const sections = { basics: 1, academics: 1, campuses: 1, finances: 0 };
    const turn = nextGuidedTurn(
      blankProfile({
        academics: { ...blankProfile().academics, gpaUnweighted: "3.7", exams: "None yet" },
        colleges: [{ id: "1", name: "UCLA", status: "researching", plan: "UC", deadline: "", notes: "", major: "Biology" }],
        goals: { ...blankProfile().goals, intendedMajor: "Biology" },
        activities: [
          { id: "a", name: "Robotics", role: "Lead", hoursPerWeek: "6", weeksPerYear: "36", years: "2", description: "Built robots.", category: "extracurricular" },
        ],
      }),
      sections,
    );
    expect(turn.id).toBe("confirm-piq-chat");
    expect(turn.chatOnly).toBe(true);
  });

  describe("essays chapter", () => {
    const sections = { basics: 1, academics: 1, campuses: 1, finances: 0 };
    const base = () =>
      blankProfile({
        academics: { ...blankProfile().academics, gpaUnweighted: "3.7", exams: "None yet" },
        colleges: [{ id: "1", name: "UCLA", status: "researching", plan: "UC", deadline: "", notes: "", major: "Biology" }],
        goals: { ...blankProfile().goals, intendedMajor: "Biology" },
        ucJourney: {
          activitiesReviewed: true,
          piqs: { leadership: "not-started", opportunity: "not-started", challenge: "not-started", community: "not-started" },
          checks: {},
          submittedAt: null,
          followUps: {},
        },
      });

    const listed = { id: "s", name: "Soccer", role: "Captain", hoursPerWeek: "", weeksPerYear: "", years: "", description: "", category: "extracurricular" as const };

    it("keeps a chat-only placeholder while drafts are still missing", () => {
      const turn = nextGuidedTurn({ ...base(), activities: [listed] }, sections, "Darren");
      expect(turn.id).toBe("draft-piq-chat");
      expect(turn.chatOnly).toBe(true);
      expect(turn.chapter).toBe("PIQs · 1 question left");
      expect(openerFor(mentorById("quill"), base(), "Darren").actions.map((a) => a.label)).toEqual(["Draft my essays"]);
    });

    it("ignores a leftover choose-piqs flag: swapping is a popup now, not an in-chat picker", () => {
      const p = blankProfile({
        academics: { ...blankProfile().academics, gpaUnweighted: "3.7", exams: "None yet" },
        colleges: [{ id: "1", name: "UCLA", status: "researching", plan: "UC", deadline: "", notes: "", major: "Biology" }],
        goals: { ...blankProfile().goals, intendedMajor: "Biology" },
        ucJourney: {
          activitiesReviewed: true,
          piqs: {},
          checks: { "choose-piqs": true },
          submittedAt: null,
          followUps: {},
        },
      });
      const turn = nextGuidedTurn(p, sections, "");
      expect(turn.id).toBe("confirm-piq-chat");
      expect(turn.chatOnly).toBe(true);
      expect(openerFor(mentorById("quill"), p, "").actions.map((a) => a.label)).toEqual(["Why?", "Sounds good", "I want to swap"]);
    });

    it("treats an unrequested auto-draft as unfinished until the student keeps it", () => {
      const p = {
        ...base(),
        activities: [listed],
        piqWork: { leadership: { answers: {}, draft: { text: "Auto draft.", words: 2, generatedAt: 1 } } },
      };
      expect(nextGuidedTurn(p, sections, "").id).toBe("draft-piq-chat");
      expect(openerFor(mentorById("quill"), p, "").actions[0]).toMatchObject({ kind: "draftPiqs" });
      expect(nextGuidedTurn(editDraft(p, "leadership", "My own words."), sections, "").id).toBe("draft-piq-chat");
      expect(currentEssay(editDraft(p, "leadership", "My own words."))).toBe("opportunity");
    });

    it("leaves the essays chapter once every chosen essay has a requested draft", () => {
      const written = applyDrafts(base(), [{ id: "leadership", question: "", essay: "An essay.", wordCount: 0 }]);
      expect(nextGuidedTurn(written, sections, "").id).toBe("draft-piq-chat");
      expect(currentEssay(written)).toBe("opportunity");
      const pasted = editDraft(base(), "leadership", "My own essay, pasted in.");
      expect(nextGuidedTurn(pasted, sections, "").id).toBe("draft-piq-chat");
      // Clearing the box doesn't count as filling it out.
      expect(nextGuidedTurn(editDraft(pasted, "leadership", "  "), sections, "").id).toBe("draft-piq-chat");
    });

    it("finishes the chapter once all four are filled out, without marking anything ready", () => {
      const p = applyDrafts(
        base(),
        ["leadership", "opportunity", "challenge", "community"].map((id) => ({ id, question: "", essay: "An essay.", wordCount: 0 })),
      );
      expect(computeJourney(p, sections, true).checkpoints[3].complete).toBe(true);
      expect(nextGuidedTurn(p, sections, "").checkpointId).not.toBe("essays");
    });
  });

  describe("activities chapter", () => {
    const sections = { basics: 1, academics: 1, campuses: 1, finances: 0 };
    const base = () =>
      blankProfile({
        academics: { ...blankProfile().academics, gpaUnweighted: "3.7", exams: "None yet" },
        colleges: [{ id: "1", name: "UCLA", status: "researching", plan: "UC", deadline: "", notes: "", major: "Biology" }],
        goals: { ...blankProfile().goals, intendedMajor: "Biology" },
      });

    it("holds on Milo's list with no question box: no more volunteering / job / awards questions", () => {
      const turn = nextGuidedTurn(base(), sections, "");
      expect(turn.id).toBe("activities-list");
      expect(turn.checkpointId).toBe("activities");
      expect(turn.speaker).toBe("milo");
      expect(turn.chatOnly).toBe(true);
      expect(turn.choices).toEqual([]);
    });

    it("shows one task on the map: confirm your activities and honors", () => {
      const tasks = computeJourney(base(), sections, true).checkpoints[2].tasks;
      expect(tasks.map((t) => [t.label, t.done])).toEqual([["Confirm your activities and honors", false]]);
    });

    it("moves on to essays once the list is confirmed", () => {
      const confirmed = { ...base(), ucJourney: { ...journeyOf(base()), activitiesReviewed: true } };
      expect(nextGuidedTurn(confirmed, sections, "").checkpointId).toBe("essays");
    });
  });
});
