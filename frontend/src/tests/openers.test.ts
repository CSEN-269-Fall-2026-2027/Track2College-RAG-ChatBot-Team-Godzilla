import { describe, expect, it } from "vitest";
import { COLLEGE_NAMES } from "../colleges";
import { UC_MAJORS } from "../constants";
import { MENTORS, REVIEW_GUIDES, mentorById } from "../game/characters";
import { callLogMessage } from "../agent/logic";
import { aidModeLine, financesUnknown, openerFor, reviewModeLine } from "../game/openers";
import { blankProfile } from "./fixtures";

describe("guide openers", () => {
  it("Quill lists the four picks with Why / Sounds good / Swap before confirm", () => {
    const opener = openerFor(mentorById("quill"), blankProfile(), "Maya");
    expect(opener.text).toContain("I'll be writing about these four essays:");
    expect(opener.text).toMatch(/Essay #\d+:/);
    expect(opener.actions.map((a) => a.label)).toEqual(["Why?", "Sounds good", "I want to swap"]);
    expect(opener.actions[1]).toMatchObject({ kind: "confirmPiqs" });
    expect(opener.actions[2]).toMatchObject({ kind: "swapPiqs" });
  });

  describe("Quill with four essays chosen", () => {
    const profile = blankProfile({
      ucJourney: { piqs: { leadership: "ready", opportunity: "not-started", challenge: "not-started", community: "not-started" }, checks: {}, submittedAt: null, followUps: {} },
    });

    it("offers to draft remaining essays instead of one-at-a-time prompts", () => {
      const opener = openerFor(mentorById("quill"), profile, "Darren");
      expect(opener.text).toContain("I'll draft all four essays now");
      expect(opener.actions).toEqual([
        expect.objectContaining({ kind: "draftPiqs", label: "Finish drafting", piqIds: ["opportunity", "challenge", "community"] }),
      ]);
    });

    it("asks whether to add anything once all four drafts exist", () => {
      const ids = ["leadership", "opportunity", "challenge", "community"];
      const p = {
        ...profile,
        ucJourney: { ...profile.ucJourney!, piqs: Object.fromEntries(ids.map((id) => [id, "ready" as const])) },
        piqWork: Object.fromEntries(ids.map((id) => [id, { answers: {}, draft: { text: `My ${id} essay.`, words: 3, generatedAt: 1, requested: true } }])),
      };
      const opener = openerFor(mentorById("quill"), p, "Darren");
      expect(opener.text).toBe("Hey Darren! Your four essay drafts are ready. Would you like to add anything to the essays?");
      expect(opener.actions.map((a) => a.label)).toEqual([
        "Yes, add something",
        "Open essays in Profile",
        "Analyze Leadership",
        "Analyze Educational opportunity",
        "Analyze Significant challenge",
        "Analyze Community",
      ]);
      const analyze = opener.actions[2];
      expect(analyze.kind === "ask" && analyze.prompt).toContain("My leadership essay.");
    });
  });

  it("Milo offers to add more once activities are done", () => {
    const done = blankProfile({ ucJourney: { piqs: {}, checks: {}, submittedAt: null, followUps: {}, activitiesReviewed: true } });
    const opener = openerFor(mentorById("milo"), done, "Darren");
    expect(opener.text).toBe("Hey Darren! Do you want to add more activities?");
    expect(opener.actions.map((a) => a.label)).toEqual(["What counts as an activity?", "Add an activity"]);
    expect(opener.actions[1]).toEqual({ kind: "profile", label: "Add an activity", section: "activities" });
    expect(openerFor(mentorById("milo"), blankProfile(), "Darren").actions.map((a) => a.label)).toEqual([
      "What counts as an activity?",
      "How many should I list?",
      "Open activities in Profile",
    ]);
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
  it("the Counselor opens with email first (forced order before Jordan)", () => {
    const counselor = openerFor(mentorById("counselor"), blankProfile(), "Maya");
    expect(counselor.text).toMatch(/email your school counselor/i);
    expect(counselor.actions).toEqual([{ kind: "tool", label: "Email my counselor", tool: "email" }]);
  });

  it("the Application Assistant waits for email then a full virtual counselor meeting before offering apply", () => {
    const locked = openerFor(mentorById("assistant"), blankProfile(), "Maya");
    expect(locked.text).toMatch(/email your school counselor/i);
    expect(locked.text).toBe(reviewModeLine("assistant", "Maya", false, false));
    expect(locked.actions).toEqual([{ kind: "tool", label: "Email my counselor first", tool: "email" }]);

    const emailed = blankProfile({
      ucJourney: {
        piqs: {},
        checks: {},
        submittedAt: null,
        followUps: {},
        agent: { counselorEmail: { subject: "Hi", body: "Hello", openedAt: 1 } },
      },
    });
    const afterEmail = openerFor(mentorById("assistant"), emailed, "Maya");
    expect(afterEmail.text).toMatch(/First finish a full meeting with Jordan/);
    expect(afterEmail.actions).toEqual([{ kind: "tool", label: "Meet with my virtual counselor", tool: "call" }]);

    const ready = blankProfile({
      ucJourney: {
        piqs: {},
        checks: {},
        submittedAt: null,
        followUps: {},
        agent: {
          counselorEmail: { subject: "Hi", body: "Hello", openedAt: 1, sentAt: 2 },
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
    expect(unlocked.text).toBe(reviewModeLine("assistant", "Maya", true, true));
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
