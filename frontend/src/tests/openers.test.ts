import { describe, expect, it } from "vitest";
import { COLLEGE_NAMES } from "../colleges";
import { UC_MAJORS } from "../constants";
import { MENTORS, REVIEW_GUIDES, mentorById } from "../game/characters";
import { callLogMessage } from "../agent/logic";
import { aidModeLine, financesUnknown, openerFor, reviewModeLine } from "../game/openers";
import { blankProfile } from "./fixtures";

describe("guide openers", () => {
  it("Quill offers suggestions and each question when none are chosen", () => {
    const opener = openerFor(mentorById("quill"), blankProfile(), "Maya");
    expect(opener.actions).toHaveLength(9);
    expect(opener.text).toContain("Do you want to learn more about each essay question?");
    expect(opener.actions[0]).toMatchObject({ kind: "ask", label: "Suggest four essays for me" });
    // Learning about a question never chooses it: that happens in the picker.
    expect(opener.actions.every((a) => a.kind === "ask")).toBe(true);
  });

  describe("Quill with four essays chosen", () => {
    const profile = blankProfile({
      ucJourney: { piqs: { leadership: "ready", opportunity: "not-started", challenge: "not-started", community: "not-started" }, checks: {}, submittedAt: null, followUps: {} },
    });

    it("introduces the current essay with a one-liner and the three options", () => {
      const opener = openerFor(mentorById("quill"), profile, "Darren");
      expect(opener.text).toBe("Hey Darren! You selected Prompt #4: **Educational opportunity**. It's about a chance you made the most of, or a school barrier you worked around.");
      expect(opener.actions.map((a) => a.label)).toEqual(["Analyze my readiness for this essay", "How can I write this essay well?", "Add more information", "Brainstorm my essay"]);
      expect(opener.actions[2]).toEqual({ kind: "followUp", label: "Add more information", piqId: "opportunity" });
      expect(opener.actions[3]).toEqual({ kind: "write", label: "Brainstorm my essay", piqId: "opportunity" });
    });

    it("moves to the next essay once this one is ready", () => {
      const p = { ...profile, ucJourney: { ...profile.ucJourney!, piqs: { ...profile.ucJourney!.piqs, opportunity: "ready" as const } } };
      expect(openerFor(mentorById("quill"), p, "").text).toContain("Prompt #5: **Significant challenge**");
    });

    it("congratulates when all four are ready", () => {
      const piqs = { leadership: "ready", opportunity: "ready", challenge: "ready", community: "ready" } as const;
      const opener = openerFor(mentorById("quill"), { ...profile, ucJourney: { ...profile.ucJourney!, piqs } }, "");
      expect(opener.text).toContain("All four");
      expect(opener.actions).toEqual([]);
    });

    it("offers to analyze each written essay once all four are done, sending the essay but showing only the label", () => {
      const ids = ["leadership", "opportunity", "challenge", "community"];
      const p = {
        ...profile,
        ucJourney: { ...profile.ucJourney!, piqs: Object.fromEntries(ids.map((id) => [id, "ready" as const])) },
        piqWork: Object.fromEntries(ids.map((id) => [id, { answers: {}, draft: { text: `My ${id} essay.`, words: 3, generatedAt: 1, requested: true } }])),
      };
      const opener = openerFor(mentorById("quill"), p, "Darren");
      expect(opener.text).toBe("Hey Darren! All four of your essays are done. Nice work!");
      expect(opener.actions.map((a) => a.label)).toEqual([
        "Analyze my leadership essay",
        "Analyze my educational opportunity essay",
        "Analyze my significant challenge essay",
        "Analyze my community essay",
      ]);
      const first = opener.actions[0];
      expect(first.kind === "ask" && first.prompt).toContain("My leadership essay.");
      expect(first.kind === "ask" && first.display).toBeUndefined();
    });
  });

  it("Milo offers to add more once activities are done", () => {
    const done = blankProfile({ ucJourney: { piqs: {}, checks: {}, submittedAt: null, followUps: {}, activitiesReviewed: true } });
    const opener = openerFor(mentorById("milo"), done, "Darren");
    expect(opener.text).toBe("Hey Darren! Do you want to add more activities?");
    expect(opener.actions.map((a) => a.label)).toEqual(["What counts as an activity?", "Add an activity"]);
    expect(opener.actions[1]).toEqual({ kind: "profile", label: "Add an activity", section: "activities" });
    expect(openerFor(mentorById("milo"), blankProfile(), "Darren").actions).toEqual([]);
  });

  it("Theo offers the tour and a button for every campus", () => {
    const opener = openerFor(mentorById("theo"), blankProfile(), "Maya");
    expect(opener.text).toContain("all nine");
    expect(opener.actions.map((a) => a.label)).toEqual(["Tell me about each UC", ...COLLEGE_NAMES]);
    expect(opener.actions[1]).toMatchObject({ label: COLLEGE_NAMES[0], answer: expect.any(String) });
  });

  it("Theo's campus buttons focus on the intended major when one is already chosen", () => {
    const profile = blankProfile({ goals: { ...blankProfile().goals, intendedMajor: "Biology" } });
    const opener = openerFor(mentorById("theo"), profile, "Maya");
    expect(opener.text).toContain("quick tour for Biology");
    expect(opener.actions[0]).toMatchObject({
      label: "Tell me about each UC",
      prompt: expect.stringContaining("interested in Biology"),
    });
    expect(opener.actions[0]).not.toHaveProperty("answer");
    expect(opener.actions[1]).toMatchObject({
      label: COLLEGE_NAMES[0],
      display: `What's special about ${COLLEGE_NAMES[0]}?`,
      prompt: expect.stringMatching(/Biology/),
    });
    expect(opener.actions[1]).not.toHaveProperty("answer");
  });

  it("Theo offers a major at the campuses already chosen", () => {
    const profile = blankProfile();
    profile.colleges = ["UCLA", "UC Davis"].map((name, i) => ({ id: String(i), name, status: "researching", plan: "UC", deadline: "", notes: "", major: "" }));
    const opener = openerFor(mentorById("theo"), profile, "");
    expect(opener.text).toContain("You've got UCLA and UC Davis on your list. Would you like to learn more about a specific major at each of these campuses?");
    expect(opener.actions.map((a) => a.label)).toEqual([...UC_MAJORS]);
    expect(opener.actions[0]).toMatchObject({
      prompt: "What's Biology like at UCLA and UC Davis? What stands out at each one?",
      display: "What's Biology like at my campuses?",
    });
  });

  it("Theo offers the student's major at each of their schools once his chapter is done", () => {
    const profile = blankProfile();
    profile.colleges = ["UCLA", "UC Davis"].map((name, i) => ({ id: String(i), name, status: "researching", plan: "UC", deadline: "", notes: "", major: "" }));
    profile.goals.intendedMajor = "Computer Science";
    const opener = openerFor(mentorById("theo"), profile, "Maya");
    expect(opener.text).toBe("Hey Maya! Would you like to learn more about Computer Science at your schools (UCLA and UC Davis)?");
    expect(opener.actions.map((a) => a.label)).toEqual(["UCLA", "UC Davis"]);
    expect(opener.actions[1]).toMatchObject({ prompt: "What's Computer Science like at UC Davis? What stands out about it there?" });

    profile.colleges = profile.colleges.slice(0, 1);
    expect(openerFor(mentorById("theo"), profile, "").text).toContain("at your school (UCLA)?");

    profile.goals.intendedMajor = "Other";
    const other = openerFor(mentorById("theo"), profile, "");
    expect(other.text).toContain("learn more about majors at your school (UCLA)?");
    expect(other.actions[0]).toMatchObject({ label: "UCLA", prompt: "What majors stand out at UCLA?" });
  });

  it("Penny prompts a finance walkthrough only when the profile shows nothing", () => {
    const blank = blankProfile();
    expect(financesUnknown(blank)).toBe(true);
    expect(openerFor(mentorById("penny"), blank, "").actions).toHaveLength(1);

    const known = blankProfile({ preferences: { ...blank.preferences, needsAid: "yes", fafsa: "in-progress" } });
    expect(financesUnknown(known)).toBe(false);
    expect(openerFor(mentorById("penny"), known, "").actions).toHaveLength(0);
  });

  it("Sage just greets, with no topic options", () => {
    expect(openerFor(mentorById("sage"), blankProfile(), "Sam").actions).toEqual([]);
  });
});

describe("Review & Apply modes", () => {
  it("the Counselor opens by offering the email and the virtual counselor, as buttons", () => {
    const counselor = openerFor(mentorById("counselor"), blankProfile(), "Maya");
    expect(counselor.text).toMatch(/email your school counselor/);
    expect(counselor.text).toMatch(/Jordan, your virtual counselor/);
    expect(counselor.actions).toEqual([
      { kind: "tool", label: "Help me email my counselor", tool: "email" },
      { kind: "tool", label: "Meet with my virtual counselor", tool: "call" },
    ]);
  });

  it("the Application Assistant waits for a full virtual counselor meeting before offering apply", () => {
    const locked = openerFor(mentorById("assistant"), blankProfile(), "Maya");
    expect(locked.text).toMatch(/First finish a full meeting with Jordan/);
    expect(locked.text).toBe(reviewModeLine("assistant", "Maya", false));
    expect(locked.actions).toEqual([{ kind: "tool", label: "Meet with my virtual counselor", tool: "call" }]);

    const ready = blankProfile({
      ucJourney: {
        piqs: {},
        checks: {},
        submittedAt: null,
        followUps: {},
        agent: {
          counselorCall: {
            endedAt: 1,
            lines: [
              { role: "student", text: "I'm good" },
              {
                role: "counselor",
                text: "Thanks so much for talking with me today! When you're ready, you can go ahead with your UC application.",
              },
            ],
          },
        },
      },
    });
    const unlocked = openerFor(mentorById("assistant"), ready, "Maya");
    expect(unlocked.text).toMatch(/fill in your UC application/);
    expect(unlocked.text).toBe(reviewModeLine("assistant", "Maya", true));
    expect(unlocked.actions).toEqual([{ kind: "tool", label: "Yes, help me apply", tool: "apply" }]);
  });

  it("the review personas aren't in the general mentor list, and Sage keeps the usual greeting", () => {
    expect(MENTORS.map((m) => m.id)).not.toContain("counselor");
    expect(REVIEW_GUIDES.map((m) => m.id)).toEqual(["counselor", "assistant"]);
    const sage = mentorById("sage");
    expect(openerFor(sage, blankProfile(), "Maya", null).text).toBe(sage.greeting("Maya"));
  });

  it("posts the call with Jordan as a readable log", () => {
    const text = callLogMessage([
      { role: "counselor", text: "Hi Maya!" },
      { role: "student", text: "Hi Jordan." },
    ]);
    expect(text).toBe("Here's the log from your call with Jordan:\n\n**Jordan:** Hi Maya!\n\n**You:** Hi Jordan.");
  });

  it("Penny's Financial Aid opener follows the FAFSA or Scholarships mode", () => {
    const fafsa = openerFor(mentorById("penny"), blankProfile(), "Maya", "fafsa");
    expect(fafsa.text).toBe(aidModeLine("fafsa", "Maya"));
    expect(fafsa.text).toMatch(/FAFSA/);
    expect(fafsa.actions.map((a) => a.label)).toContain("FAFSA or Dream Act?");

    const scholarships = openerFor(mentorById("penny"), blankProfile(), "Maya", "scholarships");
    expect(scholarships.text).toMatch(/scholarships/);
    expect(scholarships.actions.map((a) => a.label)).toContain("Find scholarships for me");

    // A Review & Apply mode never changes Penny, and an aid mode never changes Sage.
    expect(openerFor(mentorById("penny"), blankProfile(), "", "counselor").text).not.toMatch(/Counselor mode/);
    expect(openerFor(mentorById("sage"), blankProfile(), "", "fafsa").text).not.toBe(aidModeLine("fafsa", ""));
  });
});
