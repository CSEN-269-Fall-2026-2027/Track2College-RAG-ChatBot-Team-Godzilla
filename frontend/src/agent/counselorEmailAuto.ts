import { draftCounselorEmail, findCounselors, type FoundCounselor } from "../api";
import { profileSummary } from "../profile";
import type { AgentState, Profile } from "../types";
import { gmailComposeUrl } from "./logic";

export type CounselorEmailProblemReason = "no-school" | "none-found" | "no-email" | "ambiguous" | "find-failed" | "draft-failed" | "blocked";

/** Why the one-click email stopped, in plain words, plus whatever we already know to prefill the fix. */
export interface CounselorEmailProblem {
  reason: CounselorEmailProblemReason;
  message: string;
  /** Counselors the search found (with an email), for a one-tap pick. */
  candidates: { name: string; email: string; serves: string }[];
  /** Prefill for the manual form. */
  name: string;
  email: string;
  /** Set when the email is written but the browser blocked the Gmail tab. */
  gmailUrl?: string;
}

export type CounselorEmailAutoResult = { status: "opened" } | { status: "needs-ui"; problem: CounselorEmailProblem };

interface Opts {
  profile: Profile;
  studentName: string;
  agent: AgentState;
  change: (fn: (a: AgentState) => AgentState) => void;
  /**
   * A tab opened right on the click (see openPendingTab). Finding the counselor and writing the email
   * take longer than the few seconds a browser lets a click open a tab, so opening Gmail at the end was
   * blocked the first time. Opening the tab first and pointing it at Gmail later isn't.
   */
  tab?: Window | null;
}

/** Opens a "Writing your email…" tab right away, on the click itself. Null if the browser refused. */
export function openPendingTab(): Window | null {
  const win = window.open("", "_blank");
  if (!win) return null;
  try {
    win.opener = null;
    win.document.title = "Writing your email…";
    win.document.body.style.cssText = "font: 16px system-ui, sans-serif; color: #555; display: grid; place-items: center; height: 100vh; margin: 0;";
    win.document.body.textContent = "Writing your email to your counselor…";
  } catch {
    // A blank tab is fine too.
  }
  return win;
}

/** Close the waiting tab when we stop without an email to show in it. */
export function closePendingTab(tab: Window | null | undefined): void {
  try {
    if (tab && !tab.closed) tab.close();
  } catch {
    // Already gone.
  }
}

const RANGE_RE = /\b([a-z]{1,3})\s*(?:-|–|—|\bto\b|\bthrough\b)\s*([a-z]{1,3})\b/gi;

/**
 * Whether a counselor's "serves" text (e.g. "A–L", "Last names Gi-M", "A-C, M-O") covers this last name.
 * Compares letter prefixes, so "A-Gh" covers "Garcia" but not "Gomez". Null when the text has no range.
 */
export function coversLastName(serves: string, lastName: string): boolean | null {
  const last = lastName.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!last) return null;
  const ranges = [...serves.matchAll(RANGE_RE)];
  if (!ranges.length) return null;
  return ranges.some(([, from, to]) => {
    const lo = from.toLowerCase();
    const hi = to.toLowerCase();
    return last.slice(0, lo.length) >= lo && last.slice(0, hi.length) <= hi;
  });
}

/** The student's counselor: their last-name range first, then the search's own match, then the only one with an email. */
export function pickCounselor(list: FoundCounselor[], lastName: string): FoundCounselor | null {
  const withEmail = list.filter((c) => c.email);
  return (
    withEmail.find((c) => coversLastName(c.serves, lastName) === true) ??
    withEmail.find((c) => c.match && coversLastName(c.serves, lastName) !== false) ??
    (withEmail.length === 1 ? withEmail[0] : null)
  );
}

/**
 * Opens Gmail in a new tab; false only when the browser really blocked it.
 * Not via the "noopener" feature: with it, window.open always returns null, which looked like a block
 * even when the tab opened. We cut the link back to this page by hand instead.
 */
export function openGmail(url: string, tab?: Window | null): boolean {
  // The tab opened on the click: just send it to Gmail.
  if (tab && !tab.closed) {
    try {
      tab.location.href = url;
      return true;
    } catch {
      // Fall through to a new tab.
    }
  }
  const win = window.open(url, "_blank");
  if (!win) return false;
  try {
    win.opener = null;
  } catch {
    // Some browsers don't allow setting it; the tab is open either way.
  }
  return true;
}

const transcriptOf = (agent: AgentState) =>
  (agent.counselorCall?.lines ?? []).map((l) => `${l.role === "student" ? "Student" : "Counselor"}: ${l.text}`).join("\n");

/** Writes the email to this counselor, saves both, and opens it in Gmail. Used by the one-click flow and the manual form. */
export async function emailCounselor(
  opts: Opts,
  counselor: { name: string; email: string; title?: string; serves?: string; sourceUrl?: string },
): Promise<CounselorEmailAutoResult> {
  const { profile, studentName, agent, change } = opts;
  const saved = { title: "", serves: "", sourceUrl: "", ...counselor, confirmedAt: Date.now() };
  const sameCounselor = agent.counselor?.email === saved.email;
  change((a) => ({ ...a, counselor: saved, counselorEmail: sameCounselor ? a.counselorEmail : undefined }));

  const existing = sameCounselor ? agent.counselorEmail : undefined;
  let email = existing?.subject && existing.body ? { subject: existing.subject, body: existing.body } : null;
  if (!email) {
    try {
      email = await draftCounselorEmail(saved.name, studentName, profileSummary(profile), transcriptOf(agent));
    } catch (e) {
      const detail = e instanceof Error ? e.message : "Something went wrong.";
      return {
        status: "needs-ui",
        problem: { reason: "draft-failed", message: `Found ${saved.name}, but writing the email failed: ${detail}`, candidates: [], name: saved.name, email: saved.email },
      };
    }
  }
  const draft = email;
  change((a) => ({ ...a, counselor: a.counselor ?? saved, counselorEmail: { ...a.counselorEmail, ...draft, openedAt: Date.now() } }));
  const url = gmailComposeUrl(saved.email, draft.subject, draft.body);
  if (openGmail(url, opts.tab)) return { status: "opened" };
  return {
    status: "needs-ui",
    problem: { reason: "blocked", message: "Your email is written, but the browser blocked the Gmail tab.", candidates: [], name: saved.name, email: saved.email, gmailUrl: url },
  };
}

/** Find counselor → write the email → open Gmail. Stops with a specific problem when a step can't finish on its own. */
export async function autoEmailCounselor(opts: Opts): Promise<CounselorEmailAutoResult> {
  const { profile, agent } = opts;
  if (agent.counselor?.email) return emailCounselor(opts, agent.counselor);

  const school = profile.basics.highSchool.trim();
  const problem = (reason: CounselorEmailProblemReason, message: string, list: FoundCounselor[] = []): CounselorEmailAutoResult => ({
    status: "needs-ui",
    problem: {
      reason,
      message,
      candidates: list.filter((c) => c.email).map(({ name, email, serves }) => ({ name, email, serves })),
      name: "",
      email: "",
    },
  });
  if (!school) return problem("no-school", "We don't have your high school, so we couldn't look up your counselor.");

  let list: FoundCounselor[];
  try {
    list = await findCounselors({ highSchool: school, city: profile.basics.city, state: profile.basics.state, lastName: profile.basics.lastName });
  } catch (e) {
    return problem("find-failed", `The counselor search failed: ${e instanceof Error ? e.message : "something went wrong."}`);
  }
  if (!list.length) return problem("none-found", `We couldn't find any counselors for ${school} online.`);
  if (!list.some((c) => c.email)) return problem("no-email", `We found counselors at ${school}, but none of them list an email address.`, list);

  const lastName = profile.basics.lastName.trim();
  const picked = pickCounselor(list, lastName);
  if (!picked) {
    // Most schools assign counselors by last name, so a missing last name is the usual reason we can't choose.
    return problem(
      "ambiguous",
      lastName
        ? `We found several counselors at ${school} and couldn't tell which one covers the last name ${lastName}.`
        : `We found several counselors at ${school}, but your profile has no last name to match you to one. Pick yours below, and add your last name in Profile.`,
      list,
    );
  }
  return emailCounselor(opts, picked);
}
