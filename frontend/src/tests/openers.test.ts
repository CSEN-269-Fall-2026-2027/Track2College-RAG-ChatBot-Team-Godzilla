import { describe, expect, it } from "vitest";
import { COLLEGE_NAMES } from "../colleges";
import { MENTORS, REVIEW_GUIDES, mentorById } from "../game/characters";
import { callLogMessage } from "../agent/logic";
import { doneOpener, keepThroughEmailDone, openerFor, reviewModeLine } from "../game/openers";
import type { Message } from "../types";
import { blankProfile } from "./fixtures";

function msg(role: Message["role"], content: string, id: string): Message {
  return { id, role, content, createdAt: 1 };
}

describe("guide openers", () => {
  it("Quill lists the four picks with Why / Sounds good / Swap before confirm", () => {
    const opener = openerFor(mentorById("quill"), blankProfile(), "Maya");
    expect(opener.text).toContain("I'll be writing about these four essays:");
    expect(opener.text).toMatch(/Essay #\d+\*\*:/);
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

  it("Theo states the UC list and offers learn / Confirm / Decline", () => {
    const profile = blankProfile();
    profile.colleges = COLLEGE_NAMES.map((name, i) => ({ id: String(i), name, status: "researching", plan: "UC", deadline: "", notes: "", major: "" }));
    profile.goals.intendedMajor = "Computer Science";
    const opener = openerFor(mentorById("theo"), profile, "Darren");
    expect(opener.text).toBe("Hey Darren! We'll be applying to all nine UC campuses.");
    expect(opener.actions.map((a) => a.label)).toEqual(["Learn about all UCs", "Confirm", "Decline"]);
    expect(opener.actions[0]).toMatchObject({ kind: "ask", prompt: expect.stringContaining("Computer Science at each of my UCs") });
    expect(opener.actions[1]).toEqual({ kind: "confirmUcs", label: "Confirm" });
    expect(opener.actions[2]).toEqual({ kind: "profile", label: "Decline", section: "campuses" });

    profile.colleges = profile.colleges.filter((c) => c.name === "UCLA" || c.name === "UC Davis");
    expect(openerFor(mentorById("theo"), profile, "").text).toMatch(/^Hey! We'll be applying to (UCLA and UC Davis|UC Davis and UCLA)\.$/);
  });

  it("Sage just greets, with no topic options", () => {
    expect(openerFor(mentorById("sage"), blankProfile(), "Sam").actions).toEqual([]);
  });
});

describe("Counselor and Application assistant stops", () => {
  it("the Counselor opens with email first (forced order before Jordan)", () => {
    const counselor = openerFor(mentorById("counselor"), blankProfile(), "Maya");
    expect(counselor.text).toBe("Hey Maya! Let's email your counselor to set up a meeting.");
    expect(counselor.actions).toEqual([{ kind: "tool", label: "Email my counselor", tool: "email" }]);
  });

  it("the Application Assistant offers apply only after the counselor stop (email sent + full meeting)", () => {
    const locked = openerFor(mentorById("assistant"), blankProfile(), "Maya");
    expect(locked.text).toMatch(/Finish the Counselor stop first/);
    expect(locked.text).toBe(reviewModeLine("assistant", "Maya", false, false));
    expect(locked.actions).toEqual([]);

    const emailed = blankProfile({
      ucJourney: {
        piqs: {},
        checks: {},
        submittedAt: null,
        followUps: {},
        agent: { counselorEmail: { subject: "Hi", body: "Hello", openedAt: 1, sentAt: 2 } },
      },
    });
    const afterEmail = openerFor(mentorById("assistant"), emailed, "Maya");
    expect(afterEmail.text).toMatch(/Finish the Counselor stop first/);
    expect(afterEmail.actions).toEqual([]);
    // The Counselor moves on to Jordan once the email is marked sent.
    expect(openerFor(mentorById("counselor"), emailed, "Maya").actions).toEqual([{ kind: "tool", label: "Meet with my virtual counselor", tool: "call" }]);

    const ready = blankProfile({
      ucJourney: {
        piqs: {},
        checks: {},
        submittedAt: null,
        followUps: {},
        agent: {
          counselorEmail: { subject: "Hi", body: "Hello", openedAt: 1, sentAt: 2 },
          counselorDoneAt: 3,
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
    expect(unlocked.actions).toEqual([{ kind: "tool", label: "Help me apply", tool: "apply" }]);
  });

  it("Restart after email keeps the I-am-done exchange and drops Jordan call text", () => {
    const done = reviewModeLine("counselor", "Darren", false, true);
    const thread = [
      msg("user", "I am done with the email", "1"),
      msg("assistant", done, "2"),
      msg("assistant", "Here's the log from your call with Jordan:\n\n**Jordan:** Hi", "3"),
      msg("user", "Done with counselor", "4"),
    ];
    expect(keepThroughEmailDone(thread, "Darren")?.map((m) => m.id)).toEqual(["1", "2"]);
    expect(keepThroughEmailDone([msg("assistant", "Hi", "a")], "Darren")).toBeNull();
  });

  it("after Gmail opens, the Counselor waits for \"I am done with the email\" before moving on", () => {
    const opened = blankProfile({
      ucJourney: {
        piqs: {},
        checks: {},
        submittedAt: null,
        followUps: {},
        agent: { counselorEmail: { subject: "Hi", body: "Hello", openedAt: 1 } },
      },
    });
    const o = openerFor(mentorById("counselor"), opened, "Maya");
    expect(o.text).toMatch(/clicked Send/);
    expect(o.actions).toEqual([
      { kind: "tool", label: "Open the email again", tool: "email" },
      { kind: "markEmailSent", label: "I am done with the email" },
    ]);
    expect(openerFor(mentorById("assistant"), opened, "Maya").actions).toEqual([]);
  });

  it("the review personas aren't in the general mentor list, and Sage keeps the usual greeting", () => {
    expect(MENTORS.map((m) => m.id)).not.toContain("counselor");
    expect(REVIEW_GUIDES.map((m) => m.id)).toEqual(["counselor", "assistant"]);
    const sage = mentorById("sage");
    expect(openerFor(sage, blankProfile(), "Maya").text).toBe(sage.greeting("Maya"));
  });

  it("posts the call with Jordan as a readable log", () => {
    const text = callLogMessage([
      { role: "counselor", text: "Hi Maya!" },
      { role: "student", text: "Hi Jordan." },
    ]);
    expect(text).toBe("Here's the log from your call with Jordan:\n\n**Jordan:** Hi Maya!\n\n**You:** Hi Jordan.");
  });
});

describe("Counselor: after the call with Jordan", () => {
  const call = {
    endedAt: 1,
    lines: [
      { role: "student" as const, text: "I'm good" },
      { role: "counselor" as const, text: "Thanks, Maya! You're all set to start your UC application." },
    ],
  };
  const withAgent = (agent: Record<string, unknown>) =>
    blankProfile({ ucJourney: { piqs: {}, checks: {}, submittedAt: null, followUps: {}, agent } });

  it("waits for \"Done with counselor\" after a full meeting, with \"Meet with Jordan again\" on its left", () => {
    const o = openerFor(mentorById("counselor"), withAgent({ counselorEmail: { subject: "", body: "", sentAt: 1 }, counselorCall: call }), "Maya");
    expect(o.text).toBe("Hey Maya! Nice work with Jordan! Ready to move on?");
    expect(o.actions).toEqual([
      { kind: "tool", label: "Meet with Jordan again", tool: "call" },
      { kind: "counselorDone", label: "Done with counselor" },
    ]);
    // The Application assistant stays locked until they click it.
    expect(openerFor(mentorById("assistant"), withAgent({ counselorEmail: { subject: "", body: "", sentAt: 1 }, counselorCall: call }), "Maya").actions).toEqual([]);
  });

  it("moves on once they click it", () => {
    const done = withAgent({ counselorEmail: { subject: "", body: "", sentAt: 1 }, counselorCall: call, counselorDoneAt: 2 });
    expect(openerFor(mentorById("counselor"), done, "Maya").text).toMatch(/Next up: your UC application/);
    expect(openerFor(mentorById("assistant"), done, "Maya").actions).toEqual([{ kind: "tool", label: "Help me apply", tool: "apply" }]);
  });
});

describe("Application assistant: after the background run", () => {
  it("offers Open UC application and Done with application once everything is filled in", () => {
    const p = blankProfile({
      ucJourney: { piqs: {}, checks: {}, submittedAt: null, followUps: {}, agent: { pendingApply: true, ucAccount: { email: "a@b.c", password: "x", generatedAt: 1 } } },
    });
    const o = openerFor(mentorById("assistant"), p, "Maya");
    expect(o.text).toBe("Hey Maya! Your UC application is filled in. Look it over on UC, then submit it there.");
    expect(o.actions.map((a) => a.label)).toEqual(["Open UC application", "Done with application"]);
  });
});

describe("after the journey: each guide's greeting and basic buttons", () => {
  const p = blankProfile();
  p.colleges = ["UCLA", "UC Davis"].map((name, i) => ({ id: String(i), name, status: "researching", plan: "UC", deadline: "", notes: "", major: "" }));
  p.goals.intendedMajor = "Computer Science";
  const labels = (id: Parameters<typeof mentorById>[0]) => doneOpener(mentorById(id), p, "Maya Rivera").actions.map((a) => a.label);

  it("opens with the guide's standard greeting", () => {
    for (const id of ["sage", "theo", "milo", "quill", "penny", "counselor", "assistant"] as const) {
      expect(doneOpener(mentorById(id), p, "Maya Rivera").text).toBe(mentorById(id).greeting("Maya"));
    }
  });

  it("gives each guide only their basic job, with nothing that says again", () => {
    expect(labels("sage")).toEqual([]);
    expect(labels("theo")).toEqual(["Learn about all UCs", "UCLA", "UC Davis"]);
    expect(labels("milo")).toEqual(["Add more activities"]);
    expect(labels("quill")).toEqual(["Review my essays"]);
    expect(labels("counselor")).toEqual(["Email my counselor", "Meet with my virtual counselor"]);
    expect(labels("assistant")).toEqual(["Help me apply"]);
    expect(labels("penny")).toEqual(["Apply for FAFSA"]);
    for (const id of ["theo", "milo", "quill", "counselor", "assistant", "penny"] as const) {
      expect(labels(id).some((l) => /again/i.test(l))).toBe(false);
    }
  });

  it("makes Theo's campus buttons about the student's major, and Milo's go to Profile", () => {
    const theo = doneOpener(mentorById("theo"), p, "Maya").actions;
    expect(theo[0]).toMatchObject({ prompt: expect.stringContaining("Computer Science at each of my UCs (UCLA and UC Davis)") });
    expect(theo[1]).toMatchObject({ prompt: expect.stringMatching(/^What's Computer Science like at UCLA\?/) });
    expect(doneOpener(mentorById("milo"), p, "Maya").actions[0]).toEqual({ kind: "profile", label: "Add more activities", section: "activities" });
  });

  it("shows Penny's FAFSA button as not clickable yet", () => {
    expect(doneOpener(mentorById("penny"), p, "Maya").actions).toEqual([{ kind: "soon", label: "Apply for FAFSA" }]);
  });
});

describe("Quill's four picks", () => {
  it("bolds Essay #N on each line", () => {
    const text = openerFor(mentorById("quill"), blankProfile(), "Maya").text;
    expect(text).toMatch(/\n\*\*Essay #\d\*\*: /);
    expect(text.match(/\*\*Essay #\d\*\*/g)).toHaveLength(4);
  });
});
