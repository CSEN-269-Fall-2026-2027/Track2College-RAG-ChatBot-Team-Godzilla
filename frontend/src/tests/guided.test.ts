import { describe, expect, it } from "vitest";
import { blankProfile } from "./fixtures";
import { applyDrafts, currentEssay, editDraft, PERSONAL_ANSWER, piqRequest, setPiqAnswer } from "../journey/piqs";
import { mentorById } from "../game/characters";
import { openerFor } from "../game/openers";
import { completeness } from "../profile";
import { setAgent } from "../agent/logic";
import { applyGuidedEffect, inputEffect, nextGuidedTurn, storyComplete, type ActivityItem, type GuidedEffect } from "../journey/guided";
import type { ActivitySectionId, Profile } from "../types";
import { clearOpenActivityAnswer, computeJourney, journeyOf, resetActivitiesStep } from "../journey/logic";
import { activitiesSummary, activityNotesFrom, activityReportMessage, canFinishActivities, fillInProfileMessage } from "../journey/piqs";

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
      // Apply unlocks at Review & Apply; the Financial Aid stop after it never holds Apply up.
      if (turn.id === "submit") expect(storyComplete(p, completeness(p).sections)).toBe(true);
      if (turn.checkpointId === "aid") expect(turn.speaker).toBe("penny");
      // Review & Apply completes via counselor + UC account + applied (tools), not guided bubbles alone.
      if (turn.checkpointId === "review") {
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
      if (turn.id.startsWith("generate-")) {
        // Each essay is offered as soon as its own follow-ups are done; stand in for the Groq call.
        const gen = turn.choices[0]!.effect;
        expect(gen.type).toBe("generatePiqs");
        const ids = gen.type === "generatePiqs" ? gen.piqIds : [];
        expect(ids).toEqual([turn.id.slice("generate-".length)]);
        const req = piqRequest(p, ids);
        p = applyDrafts(p, req.map((r) => ({ id: r.id, question: "", essay: "word ".repeat(300).trim(), wordCount: 300 })));
        continue;
      }
      if (turn.campusPicker) {
        effect = { type: "setCampuses", campuses: ["UCLA", "UC Davis"] };
      } else if (turn.piqPicker) {
        effect = { type: "setPiqs", piqIds: ["leadership", "creativity", "talent", "community"] };
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
    // Financial Aid is the last stop: asked after submitting, and answering it finishes the story.
    expect(seen.indexOf("aid-needs")).toBeGreaterThan(seen.indexOf("submit"));
    expect(seen).toContain("aid-fafsa");
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

    it("keeps Review & Apply when Applied is done but counselor isn't — don't jump the left panel to Aid", () => {
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
      expect(turn.checkpointId).toBe("review");
      expect(turn.id).toBe("review-tools");
      expect(turn.chapter).toMatch(/task/);
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

  it("offers a 4-of-8 PIQ checkbox picker before essay follow-ups", () => {
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
    expect(turn.id).toBe("pick-piq");
    expect(turn.piqPicker).toBe(true);
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

    const NOTE = '*Essay generation would improve with more information. Please select "Add more information" in the chat.';

    it("adds a note, and no question or answer box, only when no activity is left for the essay", () => {
      const none = nextGuidedTurn(base(), sections, "");
      expect(none.prompt).toBe("Essay 1 of 4: Leadership. Want me to write it?");
      expect(none.note).toBe(NOTE);
      expect(none.input).toBeUndefined();
      expect(none.choices.map((c) => c.label)).toEqual(["Generate my essay", "I already wrote my essay", "Skip this essay for now"]);

      // Soccer is free for two essays, then the third essay gets the note.
      let p: ReturnType<typeof applyDrafts> = { ...base(), activities: [listed] };
      expect(nextGuidedTurn(p, sections, "").note).toBeUndefined();
      p = applyDrafts(p, [{ id: "leadership", question: "", essay: "Soccer one.", wordCount: 0 }]);
      expect(nextGuidedTurn(p, sections, "").note).toBeUndefined();
      p = applyDrafts(p, [{ id: "opportunity", question: "", essay: "Soccer two.", wordCount: 0 }]);
      expect(nextGuidedTurn(p, sections, "").note).toBe(NOTE);
    });

    it("offers the question in Quill's chat, and drops the note and button once it's answered", () => {
      const quill = (p: ReturnType<typeof base>) => openerFor(mentorById("quill"), p, "").actions.map((a) => a.label);
      expect(quill(base())).toEqual(["Analyze my readiness for this essay", "How can I write this essay well?", "Add more information", "Brainstorm my essay"]);
      const answered = setPiqAnswer(base(), "leadership", PERSONAL_ANSWER, "Quill: What's a time?\nStudent: I organized a bake sale");
      expect(quill(answered)).not.toContain("Add more information");
      expect(nextGuidedTurn(answered, sections, "").note).toBeUndefined();
      expect(piqRequest(answered, ["leadership"])[0].answers[0].answer).toContain("bake sale");
    });

    it("offers to generate or skip each essay, including personal-life ones, with no typed question", () => {
      const turn = nextGuidedTurn({ ...base(), activities: [listed] }, sections, "Darren");
      expect(turn.id).toBe("generate-leadership");
      expect(turn.prompt).toBe("Darren, essay 1 of 4: Leadership. Want me to write it?");
      expect(turn.choices.map((c) => c.label)).toEqual(["Generate my essay", "I already wrote my essay", "Skip this essay for now"]);
      expect(turn.choices[0].effect).toEqual({ type: "generatePiqs", piqIds: ["leadership"] });
      expect(turn.choices[1].effect).toEqual({ type: "pasteEssay", piqId: "leadership" });
      expect(turn.input).toBeUndefined();
      expect(turn.chapter).toBe("PIQs · 4 questions left");
    });

    it("starts from the beginning when the only draft is one the app wrote on its own", () => {
      const p = {
        ...base(),
        activities: [listed],
        piqWork: { leadership: { answers: {}, draft: { text: "Auto draft.", words: 2, generatedAt: 1 } } },
      };
      const turn = nextGuidedTurn(p, sections, "");
      expect(turn.id).toBe("generate-leadership");
      expect(turn.choices[0].label).toBe("Generate my essay");
      expect(openerFor(mentorById("quill"), p, "").actions.map((a) => a.label)).toEqual([
        "Analyze my readiness for this essay",
        "How can I write this essay well?",
        "Brainstorm my essay",
      ]);
      expect(nextGuidedTurn(editDraft(p, "leadership", "My own words."), sections, "").id).toBe("generate-opportunity");
    });

    it("skipping moves on to the next essay, and it can be brought back", () => {
      let p = applyGuidedEffect(base(), { type: "skipPiq", piqId: "leadership" }, () => "x");
      const next = nextGuidedTurn(p, sections, "");
      expect(next.id).toBe("generate-opportunity");
      expect(next.chapter).toBe("PIQs · 3 questions left");
      p = applyGuidedEffect(p, { type: "unskipPiqs" }, () => "x");
      expect(nextGuidedTurn(p, sections, "").id).toBe("generate-leadership");
    });

    it("moves straight to the next essay once one is written, saved, or pasted in", () => {
      const written = applyDrafts(base(), [{ id: "leadership", question: "", essay: "An essay.", wordCount: 0 }]);
      expect(nextGuidedTurn(written, sections, "").id).toBe("generate-opportunity");
      expect(currentEssay(written)).toBe("opportunity");
      const pasted = editDraft(base(), "leadership", "My own essay, pasted in.");
      expect(nextGuidedTurn(pasted, sections, "").id).toBe("generate-opportunity");
      // Clearing the box doesn't count as filling it out.
      expect(nextGuidedTurn(editDraft(pasted, "leadership", "  "), sections, "").id).toBe("generate-leadership");
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
    const id = () => "x";

    it("restarting Milo's chat clears the number and Done for the question in progress, and nothing finished", () => {
      const clear = clearOpenActivityAnswer;
      const picked = applyGuidedEffect(base(), { type: "setActivityCount", section: "activities", count: 1 }, id);
      expect(nextGuidedTurn(picked, sections, "").choices.some((c) => c.selected)).toBe(true);
      const turn = nextGuidedTurn(clear(picked), sections, "");
      expect(turn.id).toBe("activity-count");
      expect(turn.choices.some((c) => c.selected)).toBe(false);
      expect(turn.choices.some((c) => c.effect.type === "finishActivities")).toBe(false);

      // On the second question: the first keeps its answer.
      const first = applyGuidedEffect(base(), { type: "setActivityCount", section: "activities", count: 0 }, id);
      const second = applyGuidedEffect(first, { type: "setActivityCount", section: "volunteering", count: 2 }, id);
      const cleared = clear(second);
      expect(nextGuidedTurn(cleared, sections, "").id).toBe("volunteering-count");
      expect(nextGuidedTurn(cleared, sections, "").choices.some((c) => c.selected)).toBe(false);
      expect(journeyOf(cleared).activityCount).toBe(0);
    });

    it("3 or more goes to the Profile page instead of Milo's questions, then on to the next question", () => {
      const picked = applyGuidedEffect(base(), { type: "setActivityCount", section: "activities", count: 3 }, id);
      const turn = nextGuidedTurn(picked, sections, "");
      expect(turn.choices.filter((c) => c.selected).map((c) => c.label)).toEqual(["3+"]);
      expect(turn.choices.at(-1)).toMatchObject({ label: "Go to Activities & awards", effect: { type: "fillInProfile", section: "activities" } });
      expect(turn.choices.some((c) => c.effect.type === "finishActivities")).toBe(false);
      const done = applyGuidedEffect(picked, turn.choices.at(-1)!.effect, id);
      expect(nextGuidedTurn(done, sections, "").id).toBe("volunteering-count");
      expect(computeJourney(done, sections, true).checkpoints[2].tasks[0]).toMatchObject({ label: "Activities: 3+", done: true });
      expect(fillInProfileMessage("job")).toContain("3 or more jobs");
    });

    it("keeps Done, not the Profile button, for 1 or 2", () => {
      const picked = applyGuidedEffect(base(), { type: "setActivityCount", section: "activities", count: 2 }, id);
      expect(nextGuidedTurn(picked, sections, "").choices.at(-1)?.effect.type).toBe("finishActivities");
    });

    it("lists each question with its answer in See tasks", () => {
      const tasks = (p: ReturnType<typeof base>) => computeJourney(p, sections, true).checkpoints[2].tasks.map((t) => [t.label, t.done]);
      expect(tasks(base())).toEqual([["Activities", false], ["Volunteering", false], ["Jobs", false], ["Honors and awards", false]]);
      const zero = applyGuidedEffect(base(), { type: "setActivityCount", section: "activities", count: 0 }, id);
      expect(tasks(zero)[0]).toEqual(["Activities: 0", true]);
      // Picked a number but still talking to Milo: the answer shows, unchecked until Done.
      const chatting = applyGuidedEffect(zero, { type: "setActivityCount", section: "volunteering", count: 3 }, id);
      expect(tasks(chatting)[1]).toEqual(["Volunteering: 3+", false]);
    });
    const say = (role: "user" | "assistant", content: string, n: number) => ({ id: String(n), role, content, createdAt: n });

    const finish = (p: Profile, section: ActivitySectionId, notes: string, items: ActivityItem[] = []) =>
      applyGuidedEffect(p, { type: "saveActivitySection", section, notes, items }, id);
    const none = (p: Profile, section: ActivitySectionId) => applyGuidedEffect(p, { type: "setActivityCount", section, count: 0 }, id);

    it("asks how many activities with a row per answer, with Milo as the speaker", () => {
      const turn = nextGuidedTurn(base(), sections, "Darren");
      expect(turn.id).toBe("activity-count");
      expect(turn.speaker).toBe("milo");
      expect(turn.prompt).toBe("Darren, are there any activities you want to report (sports, clubs, band)?");
      expect(turn.stackedChoices).toBe(true);
      expect(turn.choices.map((c) => c.label)).toEqual(["0", "1", "2", "3+"]);
      expect(turn.chapter).toBe("Activities · 4 questions left");
    });

    it("asks about volunteering, then a job, in the same format", () => {
      let p = none(base(), "activities");
      let turn = nextGuidedTurn(p, sections, "Darren");
      expect(turn.id).toBe("volunteering-count");
      expect(turn.speaker).toBe("milo");
      expect(turn.prompt).toBe("Darren, do you do any volunteering?");
      expect(turn.choices.map((c) => c.label)).toEqual(["0", "1", "2", "3+"]);

      p = applyGuidedEffect(p, { type: "setActivityCount", section: "volunteering", count: 2 }, id);
      turn = nextGuidedTurn(p, sections, "");
      expect(turn.id).toBe("volunteering-count");
      expect(turn.choices.at(-1)).toMatchObject({ label: "Done — save my volunteering", effect: { type: "finishActivities", section: "volunteering" } });

      p = finish(p, "volunteering", "Milo: Where?\nStudent: Food bank");
      turn = nextGuidedTurn(p, sections, "Darren");
      expect(turn.id).toBe("job-count");
      expect(turn.prompt).toBe("Darren, do you have a job?");
      expect(turn.choices.map((c) => c.label)).toEqual(["0", "1", "2", "3+"]);
      p = applyGuidedEffect(p, { type: "setActivityCount", section: "job", count: 1 }, id);
      expect(nextGuidedTurn(p, sections, "").choices.at(-1)?.label).toBe("Done — save my job");
    });

    it("finishes the chapter only when all four questions are answered", () => {
      let p = none(base(), "activities");
      p = none(p, "volunteering");
      expect(computeJourney(p, sections, true).checkpoints[2].complete).toBe(false);
      p = none(p, "job");
      expect(computeJourney(p, sections, true).checkpoints[2].complete).toBe(false);
      p = none(p, "awards");
      expect(computeJourney(p, sections, true).checkpoints[2].complete).toBe(true);
      expect(nextGuidedTurn(p, sections, "").checkpointId).toBe("essays");
    });

    it("keeps the row up with the answer selected and adds Done until the student finishes", () => {
      const p = applyGuidedEffect(base(), { type: "setActivityCount", section: "activities", count: 2 }, id);
      const turn = nextGuidedTurn(p, sections, "");
      expect(turn.id).toBe("activity-count");
      expect(turn.choices.filter((c) => c.selected).map((c) => c.label)).toEqual(["2"]);
      expect(turn.choices.at(-1)?.effect).toEqual({ type: "finishActivities", section: "activities" });

      const done = finish(p, "activities", "Milo: Role?\nStudent: Captain");
      expect(nextGuidedTurn(done, sections, "").id).toBe("volunteering-count");
      expect(activitiesSummary(done)).toContain("Student: Captain");
    });

    it("Done puts what the student told Milo on their activities list, under the right category", () => {
      let p = applyGuidedEffect(base(), { type: "setActivityCount", section: "activities", count: 1 }, id);
      p = finish(p, "activities", "n", [{ name: "Soccer Team", role: "Captain", description: "Runs warmups." }]);
      expect(p.activities).toEqual([
        { id: "x", name: "Soccer Team", role: "Captain", hoursPerWeek: "", weeksPerYear: "", years: "", description: "Runs warmups.", category: "extracurricular" },
      ]);
      p = finish(p, "volunteering", "n", [{ name: "Food Bank", role: "", description: "" }]);
      p = finish(p, "job", "n", [{ name: "In-N-Out", role: "Cashier", description: "x".repeat(400) }]);
      expect(p.activities.map((a) => a.category)).toEqual(["extracurricular", "volunteering", "work"]);
      expect(p.activities[2].description).toHaveLength(350);
    });

    it("updates a row instead of repeating it when the student goes through Milo again", () => {
      let p = finish(base(), "activities", "n", [{ name: "Soccer Team", role: "Captain", description: "Runs warmups." }]);
      p = { ...p, activities: p.activities.map((a) => ({ ...a, hoursPerWeek: "6" })) };
      p = finish(p, "activities", "n", [{ name: "soccer team", role: "", description: "Sets the lineup." }]);
      expect(p.activities).toHaveLength(1);
      expect(p.activities[0]).toMatchObject({ role: "Captain", description: "Sets the lineup.", hoursPerWeek: "6" });
    });

    it("asks about honors and awards after the job, and saves them to the awards list", () => {
      let p = none(none(none(base(), "activities"), "volunteering"), "job");
      let turn = nextGuidedTurn(p, sections, "Darren");
      expect(turn.id).toBe("awards-count");
      expect(turn.speaker).toBe("milo");
      expect(turn.prompt).toBe("Darren, do you have any honors or awards to report?");
      expect(turn.choices.map((c) => c.label)).toEqual(["0", "1", "2", "3+"]);

      p = applyGuidedEffect(p, { type: "setActivityCount", section: "awards", count: 2 }, id);
      turn = nextGuidedTurn(p, sections, "");
      expect(turn.choices.at(-1)?.label).toBe("Done — save my honors and awards");

      p = finish(p, "awards", "Student: Honor Roll", [
        { name: "Honor Roll", role: "", description: "", level: "school" },
        { name: "Science Fair", role: "", description: "", level: "made-up" },
      ]);
      expect(p.awards).toEqual([
        { id: "x", title: "Honor Roll", level: "school" },
        { id: "x", title: "Science Fair", level: "" },
      ]);
      expect(p.activities).toEqual([]);
      expect(activitiesSummary(p)).toContain("About their honors and awards:\nStudent: Honor Roll");
      expect(computeJourney(p, sections, true).checkpoints[2].complete).toBe(true);

      p = finish(p, "awards", "n", [{ name: "honor roll", role: "", description: "" }]);
      expect(p.awards).toHaveLength(2);
      expect(p.awards[0].level).toBe("school");
    });

    it("lets a student finish after naming it and skipping the follow-ups", () => {
      const chat = [
        say("user", "Hi, I have 1 activity I want to report.", 0),
        say("assistant", "What's the activity, and what's your role?", 1),
        say("user", "soccer", 2),
        say("assistant", "What do you do on the team? You can skip this if you want.", 3),
        say("user", "skip", 4),
        say("assistant", "No problem. I have what I need, so hit Done to save it.", 5),
      ];
      expect(canFinishActivities(chat)).toBe(true);
    });

    it("hands every section's notes to the essays", () => {
      let p = finish(base(), "activities", "Student: Captain");
      p = finish(p, "job", "Student: Cashier");
      const summary = activitiesSummary(p);
      expect(summary).toContain("Student: Captain");
      expect(summary).toContain("About their job:\nStudent: Cashier");
    });

    it("drops saved notes when the number changes", () => {
      let p = finish(base(), "activities", "old");
      p = applyGuidedEffect(p, { type: "setActivityCount", section: "activities", count: 1 }, id);
      expect(activitiesSummary(p)).not.toContain("old");
    });

    const soccer = { id: "a", name: "Soccer", role: "Captain", hoursPerWeek: "", weeksPerYear: "", years: "", description: "Runs warmups.", category: "extracurricular" as const };

    it("doesn't ask about a section the student already has on their list", () => {
      const p = applyGuidedEffect({ ...base(), activities: [soccer] }, { type: "setActivityCount", section: "activities", count: 1 }, id);
      const turn = nextGuidedTurn(p, sections, "");
      expect(turn.id).toBe("volunteering-count");
      expect(computeJourney(p, sections, true).checkpoints[2].tasks[0]).toMatchObject({ label: "Activities: 1", done: true });
      const listed = computeJourney({ ...base(), activities: [soccer] }, sections, true).checkpoints[2].tasks[0];
      expect(listed).toMatchObject({ label: "Activities: 1", done: true });
    });

    it("Reset starts the activities step over and clears the list and awards", () => {
      let p = applyGuidedEffect(base(), { type: "setActivityCount", section: "activities", count: 1 }, id);
      p = { ...p, activities: [soccer], awards: [{ id: "b", title: "Honor roll", level: "school" }] as typeof p.awards };
      p = resetActivitiesStep(p);
      const turn = nextGuidedTurn(p, sections, "");
      expect(turn.id).toBe("activity-count");
      expect(turn.choices.some((c) => c.selected)).toBe(false);
      expect(p.activities).toEqual([]);
      expect(p.awards).toEqual([]);
    });

    it("Restart can clear a number left with no chat", () => {
      const p = applyGuidedEffect(base(), { type: "setActivityCount", section: "activities", count: 1 }, id);
      expect(clearOpenActivityAnswer(p)).not.toBe(p);
      const empty = base();
      expect(clearOpenActivityAnswer(empty)).toBe(empty);
    });

    it("words the opening message to Milo from the section and number", () => {
      expect(activityReportMessage("activities", 1)).toBe("Hi, I have 1 activity I want to report.");
      expect(activityReportMessage("activities", 2)).toBe("Hi, I have 2 activities I want to report.");
      expect(activityReportMessage("activities", 3)).toBe("Hi, I have 3 or more activities I want to report.");
      expect(activityReportMessage("volunteering", 1)).toBe("Hi, I have 1 volunteering experience I want to report.");
      expect(activityReportMessage("job", 2)).toBe("Hi, I have 2 jobs I want to report.");
      expect(activityReportMessage("awards", 1)).toBe("Hi, I have 1 honor or award I want to report.");
      expect(activityReportMessage("awards", 3)).toBe("Hi, I have 3 or more honors or awards I want to report.");
    });

    it("saves Milo's questions with the answers, and lets Done through once the student has answered", () => {
      const start = [say("user", "Hi, I have 1 activity I want to report.", 0), say("assistant", "What is it?", 1)];
      expect(canFinishActivities(start)).toBe(false);
      const answered = [...start, say("user", "Robotics captain", 2)];
      expect(canFinishActivities(answered)).toBe(false);
      const closed = [...answered, say("assistant", "That's everything I need.", 3)];
      expect(canFinishActivities(closed)).toBe(true);
      expect(activityNotesFrom(closed)).toBe("Milo: What is it?\nStudent: Robotics captain");
    });
  });
});
