import { describe, expect, it } from "vitest";
import { COLLEGE_NAMES } from "../colleges";
import { MENTORS, REVIEW_GUIDES, mentorById } from "../game/characters";
import { callLogMessage } from "../agent/logic";
import { aidModeLine, financesUnknown, openerFor, reviewModeLine } from "../game/openers";
import { blankProfile } from "./fixtures";

describe("guide openers", () => {
  it("Quill asks you to pick a PIQ when none are chosen", () => {
    const opener = openerFor(mentorById("quill"), blankProfile(), "Maya");
    expect(opener.text).toMatch(/pick a Personal Insight Question/);
    expect(opener.actions).toHaveLength(8);
    expect(opener.actions.every((a) => a.kind === "pickPiq")).toBe(true);
  });

  it("Quill offers to write the PIQs you already chose", () => {
    const profile = blankProfile({
      ucJourney: { piqs: { leadership: "not-started", challenge: "drafting" }, checks: {}, submittedAt: null, followUps: {} },
    });
    const opener = openerFor(mentorById("quill"), profile, "");
    expect(opener.text).toContain("Leadership and Significant challenge");
    expect(opener.actions.map((a) => a.label)).toEqual(["Write: Leadership", "Write: Significant challenge"]);
    expect(opener.actions.every((a) => a.kind === "ask")).toBe(true);
  });

  it("Theo offers the tour and a button for every campus", () => {
    const opener = openerFor(mentorById("theo"), blankProfile(), "Maya");
    expect(opener.text).toContain("all nine");
    expect(opener.actions.map((a) => a.label)).toEqual(["Tell me about each UC", ...COLLEGE_NAMES]);
  });

  it("Theo offers to compare the campuses already chosen", () => {
    const profile = blankProfile();
    profile.colleges = ["UCLA", "UC Davis"].map((name, i) => ({ id: String(i), name, status: "researching", plan: "UC", deadline: "", notes: "", major: "" }));
    const opener = openerFor(mentorById("theo"), profile, "");
    expect(opener.text).toContain("UCLA and UC Davis");
    expect(opener.actions[0].label).toBe("Compare my campuses");
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
    expect(counselor.text).toMatch(/email to your school counselor/);
    expect(counselor.text).toMatch(/Jordan, your virtual counselor/);
    expect(counselor.actions).toEqual([
      { kind: "tool", label: "Help me email my counselor", tool: "email" },
      { kind: "tool", label: "Meet with my virtual counselor", tool: "call" },
    ]);
  });

  it("the Application Assistant offers to help apply", () => {
    const assistant = openerFor(mentorById("assistant"), blankProfile(), "Maya");
    expect(assistant.text).toMatch(/Want help applying/);
    expect(assistant.text).toBe(reviewModeLine("assistant", "Maya"));
    expect(assistant.actions).toEqual([{ kind: "tool", label: "Yes, help me apply", tool: "apply" }]);
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
