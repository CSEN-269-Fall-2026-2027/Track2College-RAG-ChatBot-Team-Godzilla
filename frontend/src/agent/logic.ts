import { journeyOf } from "../journey/logic";
import type { AgentState, Profile } from "../types";

/**
 * Apply: after story mode, the agent does the application busywork and the
 * student only approves it. Pure helpers here.
 */

export type AgentTaskId = "counselor" | "ucAccount" | "fafsa" | "sir";

export interface AgentTask {
  id: AgentTaskId;
  title: string;
  done: boolean;
  /** Shown but not usable yet. */
  comingSoon?: boolean;
}

export function agentOf(profile: Profile): AgentState {
  return journeyOf(profile).agent ?? {};
}

export function setAgent(profile: Profile, change: (a: AgentState) => AgentState): Profile {
  const journey = journeyOf(profile);
  return { ...profile, ucJourney: { ...journey, agent: change(journey.agent ?? {}) } };
}

export function agentTasks(profile: Profile): AgentTask[] {
  const a = agentOf(profile);
  return [
    {
      id: "counselor",
      title: "Talk to a counselor",
      // Either a call with the virtual counselor or an email sent to their school counselor.
      done: !!a.counselorCall || !!a.counselorEmail?.sentAt,
    },
    {
      id: "ucAccount",
      title: "UC application",
      // Checked off once the UC account exists and is verified.
      done: !!(a.ucAccount?.verifiedAt || a.ucAccount?.signedInAt),
    },
    { id: "fafsa", title: "Submit the FAFSA or CA Dream Act", done: !!a.fafsaDoneAt },
    { id: "sir", title: "Submit your Intent to Register", done: !!a.sirDoneAt },
  ];
}

/** UC's allowed special characters; UC needs 8–30 characters and three of four kinds. */
const UC_SPECIALS = "!@#$%^&*+<>?.-";

/**
 * A 16-character password that meets UC's rules with all four kinds of character.
 * Look-alike characters (O/0, l/1/I) are left out so it's easy to copy by hand.
 */
export function generateUcPassword(random: (n: number) => number = secureRandom) {
  const sets = ["abcdefghijkmnpqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", UC_SPECIALS];
  const all = sets.join("");
  const chars = sets.map((set) => set[random(set.length)]);
  while (chars.length < 16) chars.push(all[random(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Uniform random integer in [0, n) from the browser's crypto source. */
function secureRandom(n: number) {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % n;
}

/** Opens Gmail's compose window in the given account with everything filled in; the student clicks Send. */
export function gmailComposeUrl(to: string, subject: string, body: string, account?: string) {
  const params = new URLSearchParams({ view: "cm", fs: "1", to, su: subject, body });
  if (account) params.set("authuser", account);
  return `https://mail.google.com/mail/?${params}`;
}

/** Jordan's voice adds cues like "[happy]" for tone; they're spoken, not shown. */
export const withoutAudioTags = (text: string) =>
  text
    .replace(/\[[^\]\n]{1,40}\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const UNDER_100 = `(?:${TENS.slice(2).join("|")})(?:[\\s-]+(?:${ONES.slice(1).join("|")}))?|${TEENS.join("|")}|${ONES.slice(1).join("|")}`;
// "two thousand (and) twenty-seven" and "twenty twenty-seven".
const SPELLED_YEAR = new RegExp(`\\btwo thousand(?:\\s+and)?(?:[\\s-]+(${UNDER_100}))?\\b|\\btwenty[\\s-]+((?:${TENS.slice(2).join("|")})(?:[\\s-]+(?:${ONES.slice(1).join("|")}))?|${TEENS.join("|")})\\b`, "gi");

function wordsToNumber(words: string): number {
  return words
    .toLowerCase()
    .split(/[\s-]+/)
    .reduce((sum, w) => sum + Math.max(ONES.indexOf(w), TEENS.indexOf(w) >= 0 ? TEENS.indexOf(w) + 10 : -1, TENS.indexOf(w) * 10, 0), 0);
}

/**
 * What the transcript shows for one of Jordan's lines: no tone cues, no stray comma the voice
 * sometimes starts a sentence with, and years as digits ("two thousand twenty seven" → 2027).
 */
export function cleanTranscriptLine(text: string): string {
  return withoutAudioTags(text)
    .replace(SPELLED_YEAR, (_match, afterThousand?: string, afterTwenty?: string) =>
      String(2000 + (afterThousand ? wordsToNumber(afterThousand) : afterTwenty ? wordsToNumber(afterTwenty) : 0)),
    )
    .replace(/^[\s,;:.]+/, "")
    .replace(/\s+([,;:.!?])/g, "$1")
    .replace(/([.!?])\s*,\s*/g, "$1 ")
    .trim();
}

export function mailtoUrl(to: string, subject: string, body: string) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export interface CalendarEvent {
  key: string;
  title: string;
  /** All-day date, YYYY-MM-DD. */
  date: string;
  detail: string;
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Year the student starts college: their graduation year, else the next one to come. */
export function entryYear(profile: Profile, now = new Date()) {
  const year = Number.parseInt(profile.basics.graduationYear, 10);
  if (year >= 2000 && year < 2100) return year;
  return now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
}

/** UC's filing deadline (Nov 30, 11:59 PM Pacific) for the student's application cycle, as YYYY-MM-DD. */
export function ucDeadlineDate(profile: Profile, now = new Date()) {
  return iso(entryYear(profile, now) - 1, 11, 30);
}

/** FAFSA / CA Dream Act priority deadline for Cal Grant (Mar 2 of the year the student starts college). */
export const aidDeadlineDate = (profile: Profile, now = new Date()) => iso(entryYear(profile, now), 3, 2);

/** UC Statement of Intent to Register deadline (May 1 of the year the student starts college). */
export const sirDeadlineDate = (profile: Profile, now = new Date()) => iso(entryYear(profile, now), 5, 1);

/** Today's date in California, where UC's deadline is set, as YYYY-MM-DD. */
const pacificToday = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** Whole days until UC's deadline, counted by California calendar date: 0 means it's due tonight, negative means it passed. */
export function daysUntilUcDeadline(profile: Profile, now = new Date()) {
  return Math.round(dayNumber(ucDeadlineDate(profile, now)) - dayNumber(pacificToday(now)));
}

/** UC's filing period (Oct 1 – Nov 30) and how far through it today is, from 0 (not open yet) to 1 (closed). */
export function filingPeriod(profile: Profile, now = new Date()) {
  const closes = ucDeadlineDate(profile, now);
  const opens = iso(entryYear(profile, now) - 1, 10, 1);
  const total = dayNumber(closes) - dayNumber(opens) + 1;
  const elapsed = dayNumber(pacificToday(now)) - dayNumber(opens) + 1;
  return { opens, closes, progress: Math.min(1, Math.max(0, elapsed / total)) };
}

/**
 * Deadlines for the student's application cycle. Dates follow UC's usual calendar and
 * shift between cycles, so the page lets the student change any of them before adding.
 */
export function calendarEvents(profile: Profile, now = new Date()): CalendarEvent[] {
  const deadline = ucDeadlineDate(profile, now);
  const a = agentOf(profile);
  const events: CalendarEvent[] = [
    {
      key: "uc-review",
      title: "Final review of my UC application",
      date: addDays(deadline, -14),
      detail: "Go through every section, check the four PIQs, and confirm your campuses and majors.",
    },
    {
      key: "uc-deadline",
      title: "UC application deadline",
      date: deadline,
      detail: "Submit at apply.universityofcalifornia.edu. Confirm this cycle's exact date on UC's site.",
    },
    {
      key: "aid-deadline",
      title: "FAFSA / CA Dream Act and Cal Grant deadline",
      date: aidDeadlineDate(profile, now),
      detail: "Submit the FAFSA or CA Dream Act Application and make sure your school sends your Cal Grant GPA.",
    },
    {
      key: "uc-sir",
      title: "UC Statement of Intent to Register deadline",
      date: sirDeadlineDate(profile, now),
      detail: "Accept your offer at the campus you choose.",
    },
  ];
  const sentAt = a.counselorEmail?.sentAt ?? a.counselorEmail?.openedAt;
  if (a.counselor && sentAt) {
    events.unshift({
      key: "counselor-followup",
      title: `Follow up with ${a.counselor.name} if they haven't replied`,
      date: addDays(new Date(sentAt).toISOString().slice(0, 10), 7),
      detail: `Your counselor: ${a.counselor.email}`,
    });
  }
  const today = now.toISOString().slice(0, 10);
  return events.filter((e) => e.date >= today).sort((p, q) => p.date.localeCompare(q.date));
}
