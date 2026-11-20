/** Apply rules (pure logic; no React, Google, or Supabase). */
import { describe, expect, it } from "vitest";
import { calendarEvents, daysUntilUcDeadline, entryYear, gmailComposeUrl, setAgent, withUcRunProgress, cleanTranscriptLine, withoutAudioTags } from "../agent/logic";
import { coversLastName, openGmail, pickCounselor } from "../agent/counselorEmailAuto";
import { issueOf } from "../agent/useBackgroundApply";
import { commitApplied } from "../agent/logic";
import type { UcRun } from "../api";
import { storyComplete } from "../journey/guided";
import { emptyJourney, setPiqStatus, toggleCampus, togglePiq } from "../journey/logic";
import type { Profile, UcJourneyState } from "../types";
import { blankProfile } from "./fixtures";

const fullBasics = { basics: 1, academics: 0, campuses: 0, finances: 0 };
let n = 0;
const id = () => `id-${n++}`;
const oct30 = new Date("2026-10-30T12:00:00Z");

function storyDoneProfile(): Profile {
  let p = blankProfile({
    activities: [
      {
        id: "a",
        name: "Robotics",
        role: "Captain",
        hoursPerWeek: "6",
        weeksPerYear: "36",
        years: "3",
        description: "Led a 12-person team to regionals.",
        category: "extracurricular",
      },
    ],
    academics: { ...blankProfile().academics, gpaUnweighted: "3.8" },
  });
  p = toggleCampus(p, "UC Davis", id);
  p = { ...p, goals: { ...p.goals, intendedMajor: "Biology" } };
  let j: UcJourneyState = { ...emptyJourney(), activitiesReviewed: true };
  for (const q of ["leadership", "creativity", "talent", "community"]) j = setPiqStatus(togglePiq(j, q), q, "ready");
  return { ...p, ucJourney: j };
}

describe("Apply", () => {
  it("unlocks once every checkpoint before Review & Apply is complete", () => {
    expect(storyComplete(blankProfile(), fullBasics)).toBe(false);
    expect(storyComplete(storyDoneProfile(), fullBasics)).toBe(true);
  });

  it("cleans Jordan's lines: no leading comma or bang, years as digits", () => {
    expect(cleanTranscriptLine(", Got it! Fall two thousand twenty seven?")).toBe("Got it! Fall 2027?");
    expect(cleanTranscriptLine("[happy] , Great.")).toBe("Great.");
    expect(cleanTranscriptLine("Great. , And your birthday?")).toBe("Great. And your birthday?");
    expect(cleanTranscriptLine("! So, your birth date is June seventeenth, 2003.")).toBe("So, your birth date is June seventeenth, 2003.");
    expect(cleanTranscriptLine("Fall two thousand and twenty-seven, or Spring twenty twenty-seven?")).toBe("Fall 2027, or Spring 2027?");
    expect(cleanTranscriptLine("Born in two thousand eight?")).toBe("Born in 2008?");
    expect(cleanTranscriptLine("You have twenty two days left.")).toBe("You have twenty two days left.");
  });

  it("hides the voice's tone cues from the transcript", () => {
    expect(withoutAudioTags("[happy] Hi Maya! [laughs] Great pick.")).toBe("Hi Maya! Great pick.");
    expect(withoutAudioTags("No tags here.")).toBe("No tags here.");
  });

  it("builds a Gmail compose link in the connected account", () => {
    const url = new URL(gmailComposeUrl("lee@school.org", "UC question", "Hi Ms. Lee,\nThanks!", "me@gmail.com"));
    expect(url.origin + url.pathname).toBe("https://mail.google.com/mail/");
    expect(url.searchParams.get("view")).toBe("cm");
    expect(url.searchParams.get("to")).toBe("lee@school.org");
    expect(url.searchParams.get("body")).toBe("Hi Ms. Lee,\nThanks!");
    expect(url.searchParams.get("authuser")).toBe("me@gmail.com");
  });

  it("puts this cycle's remaining deadlines on the calendar, in date order", () => {
    const p = storyDoneProfile(); // graduates 2027
    expect(entryYear(p)).toBe(2027);
    const events = calendarEvents(p, oct30);
    expect(events.map((e) => [e.key, e.date])).toEqual([
      ["uc-review", "2026-11-16"],
      ["uc-deadline", "2026-11-30"],
      ["aid-deadline", "2027-03-02"],
      ["uc-sir", "2027-05-01"],
    ]);
    // Dates already past are left off.
    expect(calendarEvents(p, new Date("2026-11-20T12:00:00Z"))[0].key).toBe("uc-deadline");
  });

  it("counts down whole days to the nearest Nov 30 by California date", () => {
    const p = storyDoneProfile(); // graduates 2027
    expect(daysUntilUcDeadline(p, new Date("2026-10-30T19:00:00Z"))).toBe(31);
    // 11 PM on Nov 29 in California is already Nov 30 in UTC, but there's still a day left.
    expect(daysUntilUcDeadline(p, new Date("2026-11-30T07:00:00Z"))).toBe(1);
    expect(daysUntilUcDeadline(p, new Date("2026-11-30T20:00:00Z"))).toBe(0);
    // After this cycle closes, countdown flips to next Nov 30 (not negative forever).
    expect(daysUntilUcDeadline(p, new Date("2026-12-01T08:30:00Z"))).toBe(364);
  });

  it("uses the nearest Nov 30 even when graduation year is later", () => {
    const junior = {
      ...storyDoneProfile(),
      basics: { ...storyDoneProfile().basics, gradeLevel: "11" as const, graduationYear: "2028" },
    };
    expect(entryYear(junior)).toBe(2028);
    expect(daysUntilUcDeadline(junior, new Date("2026-11-18T20:00:00Z"))).toBe(12);
  });

  it("adds a counselor follow-up a week after the email", () => {
    const p = setAgent(storyDoneProfile(), (a) => ({
      ...a,
      counselor: { name: "Ms. Lee", email: "lee@school.org", title: "", serves: "", sourceUrl: "", confirmedAt: 1 },
      counselorEmail: { subject: "Hi", body: "Hello", sentAt: Date.parse("2026-10-30T12:00:00Z") },
    }));
    expect(calendarEvents(p, oct30)[0]).toMatchObject({ key: "counselor-followup", date: "2026-11-06" });
  });

  describe("saving a UC run's progress", () => {
    const login = { email: "maya@example.com", password: "Tq7#mVx2!pLr9Kd4" };
    const quiet = { status: "filling", created: false, verified: false, setup: false, about: false, piq: false };
    const inside = { ...quiet, status: "signed_in", created: true, verified: true };

    it("changes nothing, so saves nothing, when a run has no news", () => {
      const a = withUcRunProgress({}, inside, login, 1);
      expect(withUcRunProgress(a, inside, login, 2)).toBe(a);
      expect(withUcRunProgress(a, { ...inside, status: "filling" }, login, 3)).toBe(a);
      const profile = setAgent(blankProfile(), () => a);
      expect(setAgent(profile, (x) => withUcRunProgress(x, inside, login, 4))).toBe(profile);
    });

    it("saves a new milestone once", () => {
      const a = withUcRunProgress({}, inside, login, 1);
      const b = withUcRunProgress(a, { ...inside, piq: true }, login, 2);
      expect(b.ucAccount?.piqAt).toBe(2);
      expect(b.ucAccount?.signedInAt).toBe(1);
      expect(withUcRunProgress(b, { ...inside, piq: true }, login, 3)).toBe(b);
    });

    it("records a working login even after status leaves signed_in for filling", () => {
      const a = withUcRunProgress({}, { ...inside, status: "filling" }, login, 1);
      expect(a.ucAccount).toMatchObject({ email: login.email, password: login.password, verifiedAt: 1, signedInAt: 1 });
    });

    it("saves a login only once UC accepts it", () => {
      expect(withUcRunProgress({}, quiet, login, 1)).toEqual({});
      expect(withUcRunProgress({}, inside, login, 1).ucAccount).toMatchObject(login);
    });

    it("replaces the saved password once UC accepts a corrected one", () => {
      const a = withUcRunProgress({}, inside, login, 1);
      const fixed = { ...login, password: "N3w!Password#99" };
      expect(withUcRunProgress(a, quiet, fixed, 2)).toBe(a);
      expect(withUcRunProgress(a, inside, fixed, 2).ucAccount?.password).toBe(fixed.password);
    });
  });
});

describe("counselor email: picking the student's counselor", () => {
  const found = (name: string, serves: string, email = `${name.toLowerCase()}@school.edu`, match = false) => ({
    name,
    title: "Counselor",
    email,
    serves,
    match,
    sourceUrl: "",
  });

  it("reads last-name ranges, including two-letter ones and several ranges", () => {
    expect(coversLastName("A–L", "Garcia")).toBe(true);
    expect(coversLastName("Last names M - Z", "Garcia")).toBe(false);
    expect(coversLastName("A-Gh", "Garcia")).toBe(true);
    expect(coversLastName("A-Gh", "Gomez")).toBe(false);
    expect(coversLastName("A-C, M-O", "Nguyen")).toBe(true);
    expect(coversLastName("Students A to F", "Diaz")).toBe(true);
    expect(coversLastName("Grades 9-12", "Diaz")).toBeNull();
    expect(coversLastName("A–L", "")).toBeNull();
  });

  it("picks by the last-name range before the search's own guess", () => {
    const list = [found("Rivera", "A–L", undefined, false), found("Chen", "M–Z", undefined, true)];
    expect(pickCounselor(list, "Garcia")?.name).toBe("Rivera");
    expect(pickCounselor(list, "Smith")?.name).toBe("Chen");
    // Several with no ranges and no match: we can't tell, so the popup asks.
    expect(pickCounselor([found("Rivera", ""), found("Chen", "")], "Garcia")).toBeNull();
    // Only one with an email: that's the one.
    expect(pickCounselor([found("Rivera", "", ""), found("Chen", "")], "Garcia")?.name).toBe("Chen");
  });
});

describe("counselor email: the Mission San Jose search, as the web search returned it", () => {
  // Real shape from the search: ranges written "Lastnames Lo-Sh" / "Si - Z", match all false
  // (the model wasn't given a last name), plus non-counselor staff with emails.
  const list = [
    { name: "Counselor A", title: "Counselor", email: "a@fusdk12.net", serves: "Lastnames A-Ch", match: false, sourceUrl: "" },
    { name: "Counselor B", title: "Counselor", email: "b@fusdk12.net", serves: "Lastnames Lo-Sh", match: false, sourceUrl: "" },
    { name: "Lindsay Rotter", title: "Counselor", email: "lrotter@fusdk12.net", serves: "Lastnames Si-Z", match: false, sourceUrl: "" },
    { name: "Yvonne Ng", title: "College/Career Specialist", email: "wng@fusdk12.net", serves: "", match: false, sourceUrl: "" },
  ];

  it("picks Lindsay Rotter for an Si–Z last name once the last name is known", () => {
    expect(pickCounselor(list, "Tran")?.name).toBe("Lindsay Rotter");
    expect(pickCounselor(list, "Smith")?.name).toBe("Lindsay Rotter");
    expect(pickCounselor(list, "Shah")?.name).toBe("Counselor B");
  });

  it("can't choose with no last name (the original bug: onboarding never saved it)", () => {
    expect(pickCounselor(list, "")).toBeNull();
  });
});

describe("counselor email: opening Gmail", () => {
  const withOpen = (impl: (...args: unknown[]) => unknown, run: () => void) => {
    const g = globalThis as { window?: unknown };
    const prev = g.window;
    g.window = { open: impl };
    try {
      run();
    } finally {
      g.window = prev;
    }
  };

  it("counts an opened tab as opened (no 'noopener' feature, which always returns null)", () => {
    const tab: { opener: unknown } = { opener: "us" };
    const calls: unknown[][] = [];
    withOpen(
      (...args) => {
        calls.push(args);
        return tab;
      },
      () => expect(openGmail("https://mail.google.com/")).toBe(true),
    );
    expect(calls[0]).toEqual(["https://mail.google.com/", "_blank"]);
    expect(tab.opener).toBeNull();
  });

  it("sends the tab opened on the click to Gmail instead of opening another (the first-try block)", () => {
    const tab = { closed: false, location: { href: "" } };
    let opened = 0;
    withOpen(
      () => {
        opened++;
        return null;
      },
      () => expect(openGmail("https://mail.google.com/x", tab as unknown as Window)).toBe(true),
    );
    expect(tab.location.href).toBe("https://mail.google.com/x");
    expect(opened).toBe(0);
  });

  it("reports a real popup block", () => {
    withOpen(() => null, () => expect(openGmail("https://mail.google.com/")).toBe(false));
  });
});

describe("Help me apply in the background", () => {
  const run = (over: Partial<UcRun>): UcRun => ({
    status: "filling",
    detail: "Filling in About you…",
    mode: "login",
    open: true,
    created: true,
    browser: "cloud",
    live_url: "https://live.example/x",
    page_url: "",
    finished: false,
    verified: true,
    setup: true,
    about: false,
    about_report: { filled: [], missing: [], check: [] },
    piq: false,
    piq_report: { entered: [], skipped: [] },
    ...over,
  });

  it("keeps working quietly, and only flags what needs the student", () => {
    expect(issueOf(run({}), null)).toBeNull();
    expect(issueOf(run({ status: "needs_code" }), null)?.kind).toBe("code");
    // The server is looking for UC's code in Gmail, or entering one it found: don't ask yet.
    expect(issueOf(run({ status: "needs_code", code_search: true }), null)).toBeNull();
    expect(issueOf(run({ status: "checking_code" }), null)).toBeNull();
    expect(issueOf(run({ status: "needs_you", detail: "Fill in the gender question." }), null)).toEqual({ kind: "your-turn", message: "Fill in the gender question." });
    expect(issueOf(run({ status: "login_failed", open: false }), null)?.kind).toBe("login");
    expect(issueOf(run({ status: "error", open: false, detail: "The cloud browser couldn't start." }), null)).toEqual({
      kind: "failed",
      message: "The cloud browser couldn't start.",
    });
    expect(issueOf(null, "Cloud mode isn't set up on this server yet.")?.kind).toBe("failed");
    // Finished is not an issue: the chat shows "Done with application".
    expect(issueOf(run({ status: "piq_done", finished: true }), null)).toBeNull();
  });

  it("records Applied only when the student clicks Done with application", () => {
    const a = { pendingApply: true, ucAccount: { email: "maya@example.com", password: "x", generatedAt: 1 } };
    const done = commitApplied(a, null, 5);
    expect(done.pendingApply).toBeUndefined();
    expect(done.ucAccount).toMatchObject({ piqAt: 5, verifiedAt: 5, signedInAt: 5 });
    // A brand-new login from this run becomes the saved account.
    expect(commitApplied({ pendingApply: true }, { email: "new@example.com", password: "Pw!12345" }, 7).ucAccount).toMatchObject({
      email: "new@example.com",
      piqAt: 7,
    });
  });
});
