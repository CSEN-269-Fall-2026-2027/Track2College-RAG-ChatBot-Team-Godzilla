/** Apply rules (pure logic; no React, Google, or Supabase). */
import { describe, expect, it } from "vitest";
import {
  agentTasks,
  calendarEvents,
  daysUntilUcDeadline,
  entryYear,
  filingPeriod,
  generateUcPassword,
  gmailComposeUrl,
  setAgent,
  cleanTranscriptLine,
  withoutAudioTags,
} from "../agent/logic";
import { ucFacts, shuffled } from "../journey/facts";
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

  it("lists the counselor call, the UC account, then FAFSA and Intent to Register", () => {
    const tasks = agentTasks(storyDoneProfile());
    expect(tasks.map((t) => [t.id, t.done, !!t.comingSoon])).toEqual([
      ["counselor", false, false],
      ["ucAccount", false, false],
      ["fafsa", false, false],
      ["sir", false, false],
    ]);
  });

  it("marks FAFSA and Intent to Register done when the student says so", () => {
    const p = setAgent(storyDoneProfile(), (a) => ({ ...a, fafsaDoneAt: 1, sirDoneAt: 2 }));
    expect(
      agentTasks(p)
        .filter((t) => t.done)
        .map((t) => t.id),
    ).toEqual(["fafsa", "sir"]);
  });

  it("counts talking to a counselor done after a virtual call or an email to the school counselor", () => {
    const base = storyDoneProfile();
    const counselorStep = (p: Profile) => agentTasks(p).find((t) => t.id === "counselor")!.done;
    expect(counselorStep(base)).toBe(false);
    const emailed = setAgent(base, (a) => ({
      ...a,
      counselorMode: "school",
      counselor: { name: "Ms. Lee", email: "lee@school.org", title: "", serves: "", sourceUrl: "", confirmedAt: 1 },
      counselorEmail: { subject: "Hi", body: "Hello", openedAt: 2 },
    }));
    expect(counselorStep(emailed)).toBe(false); // opened in Gmail but not sent yet
    expect(counselorStep(setAgent(emailed, (a) => ({ ...a, counselorEmail: { ...a.counselorEmail!, sentAt: 3 } })))).toBe(true);
    expect(counselorStep(setAgent(base, (a) => ({ ...a, counselorCall: { endedAt: 1, lines: [] } })))).toBe(true);
  });

  it("asks UC fun facts with exactly one true answer and three distinct false ones", () => {
    const facts = ucFacts("November 30");
    expect(facts.length).toBeGreaterThanOrEqual(8);
    expect(new Set(facts.map((f) => f.id)).size).toBe(facts.length);
    for (const f of facts) {
      const all = [f.answer, ...f.wrong];
      expect(new Set(all.map((o) => o.toLowerCase())).size).toBe(4);
      expect(f.why).toBeTruthy();
    }
    expect(facts.find((f) => f.id === "deadline")!.answer).toBe("November 30");
    expect(shuffled([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
  });

  it("cleans Jordan's lines: no leading comma, years as digits", () => {
    expect(cleanTranscriptLine(", Got it! Fall two thousand twenty seven?")).toBe("Got it! Fall 2027?");
    expect(cleanTranscriptLine("[happy] , Great.")).toBe("Great.");
    expect(cleanTranscriptLine("Great. , And your birthday?")).toBe("Great. And your birthday?");
    expect(cleanTranscriptLine("Fall two thousand and twenty-seven, or Spring twenty twenty-seven?")).toBe("Fall 2027, or Spring 2027?");
    expect(cleanTranscriptLine("Born in two thousand eight?")).toBe("Born in 2008?");
    expect(cleanTranscriptLine("You have twenty two days left.")).toBe("You have twenty two days left.");
  });

  it("hides the voice's tone cues from the transcript", () => {
    expect(withoutAudioTags("[happy] Hi Maya! [laughs] Great pick.")).toBe("Hi Maya! Great pick.");
    expect(withoutAudioTags("No tags here.")).toBe("No tags here.");
  });

  it("counts talking to a counselor done once the student has had a call", () => {
    let p = storyDoneProfile();
    expect(agentTasks(p)[0]).toMatchObject({ title: "Talk to a counselor", done: false });
    p = setAgent(p, (a) => ({ ...a, counselorCall: { endedAt: 1, lines: [{ role: "student", text: "Hi Jordan" }] } }));
    expect(agentTasks(p)[0].done).toBe(true);
    // Agent state lives beside the rest of the journey without disturbing it.
    expect(Object.keys(p.ucJourney!.piqs)).toHaveLength(4);
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

  it("counts down whole days to Nov 30 by California date", () => {
    const p = storyDoneProfile(); // graduates 2027 → deadline Nov 30, 2026
    expect(daysUntilUcDeadline(p, new Date("2026-10-30T19:00:00Z"))).toBe(31);
    // 11 PM on Nov 29 in California is already Nov 30 in UTC, but there's still a day left.
    expect(daysUntilUcDeadline(p, new Date("2026-11-30T07:00:00Z"))).toBe(1);
    expect(daysUntilUcDeadline(p, new Date("2026-11-30T20:00:00Z"))).toBe(0);
    expect(daysUntilUcDeadline(p, new Date("2026-12-01T08:30:00Z"))).toBe(-1);
  });

  it("tracks progress through the Oct 1 – Nov 30 filing period", () => {
    const p = storyDoneProfile();
    expect(filingPeriod(p, new Date("2026-09-15T19:00:00Z"))).toEqual({ opens: "2026-10-01", closes: "2026-11-30", progress: 0 });
    expect(filingPeriod(p, new Date("2026-10-30T19:00:00Z")).progress).toBeCloseTo(30 / 61);
    expect(filingPeriod(p, new Date("2026-11-30T19:00:00Z")).progress).toBe(1);
  });

  it("adds a counselor follow-up a week after the email", () => {
    const p = setAgent(storyDoneProfile(), (a) => ({
      ...a,
      counselor: { name: "Ms. Lee", email: "lee@school.org", title: "", serves: "", sourceUrl: "", confirmedAt: 1 },
      counselorEmail: { subject: "Hi", body: "Hello", sentAt: Date.parse("2026-10-30T12:00:00Z") },
    }));
    expect(calendarEvents(p, oct30)[0]).toMatchObject({ key: "counselor-followup", date: "2026-11-06" });
  });

  it("generates UC passwords that meet UC's rules every time", () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateUcPassword();
      expect(pw).toHaveLength(16);
      expect(pw).toMatch(/^[A-Za-z0-9!@#$%^&*+<>?.-]+$/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).toMatch(/[!@#$%^&*+<>?.-]/);
      expect(pw).not.toMatch(/[O0lI1]/);
    }
  });

  it("checks off the UC application once the account is created and verified", () => {
    const base = { email: "me@example.com", password: "Tq7#mVx2!pLr9Kd4", generatedAt: 1 };
    const step = (ucAccount?: typeof base & { createdAt?: number; verifiedAt?: number; signedInAt?: number }) =>
      agentTasks(setAgent(storyDoneProfile(), (a) => ({ ...a, ucAccount })))[1];
    expect(step().title).toBe("UC application");
    expect(step().done).toBe(false);
    expect(step(base).done).toBe(false);
    // Created but still waiting on the emailed code.
    expect(step({ ...base, createdAt: 2 }).done).toBe(false);
    expect(step({ ...base, createdAt: 2, verifiedAt: 3 }).done).toBe(true);
    expect(step({ ...base, signedInAt: 2 }).done).toBe(true);
  });
});
