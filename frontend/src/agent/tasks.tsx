/** The Jordan call, shared UC form facts, and the live Browserbase panel. */
import { useState, type ReactNode } from "react";
import { type UcPiq, type UcRun } from "../api";
import { useAuth } from "../auth";
import { getStore } from "../data";
import { VoiceCounselor } from "./VoiceCounselor";
import { entryYear, ucDeadlineDate } from "./logic";
import { ExternalIcon, RetryIcon, XIcon } from "../components/icons";
import { PIQ_PROMPTS } from "../journey/logic";
import { chosenPiqs, piqWorkOf } from "../journey/piqs";
import { profileSummary, useProfile } from "../profile";
import type { AgentState, CallLine, PersonalInfo, Profile } from "../types";


export interface TaskProps {
  agent: AgentState;
  change: (fn: (a: AgentState) => AgentState) => void;
}

/** The student's full name, falling back to their sign-up name (emails are signed with it). */
function useStudentName() {
  const { profile } = useProfile();
  const { account } = useAuth();
  const b = profile.basics;
  return (
    [b.firstName, b.lastName]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ") ||
    account?.name?.trim() ||
    ""
  );
}

/** A voice call with Jordan, the AI counselor. */
export function VirtualCounselor({
  agent,
  change,
  onCallEnd,
  variant,
  details,
}: TaskProps & { onCallEnd?: (lines: CallLine[]) => void; variant?: "page" | "popup"; details?: ReactNode }) {
  const { profile } = useProfile();
  const { account } = useAuth();
  const studentName = useStudentName();
  const deadline = new Date(`${ucDeadlineDate(profile)}T12:00:00`);
  return (
    <VoiceCounselor
      studentName={studentName}
      profileSummary={profileSummary(profile)}
      ucDeadline={deadline.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
      entryYear={entryYear(profile)}
      lastCall={agent.counselorCall}
      variant={variant}
      details={details}
      onEnd={(lines) => {
        change((a) => ({ ...a, counselorCall: { endedAt: Date.now(), lines } }));
        onCallEnd?.(lines);
      }}
      onPersonalInfo={async (info) => {
        if (!account) return;
        await savePersonalInfo(account.id, info);
      }}
    />
  );
}

/** Merges the birthday / birthplace Jordan heard into the student's personal_info row (not the profile). */
async function savePersonalInfo(userId: string, info: PersonalInfo) {
  const store = await getStore();
  const saved = (await store.personalInfo.get(userId)) ?? {};
  await store.personalInfo.save(userId, { ...saved, ...info });
}

/** What Track2College knows that UC's "About you" asks for. Only exact answers; the rest is left to the student. */
export function ucFacts(profile: Profile, signUpName: string): Record<string, string> {
  const b = profile.basics;
  // Older profiles may lack a last name; fall back to the full name given at sign-up
  // ("Darren Tang" → "Tang"). The account name is the email when none was given; skip that.
  const words = signUpName.includes("@") ? [] : signUpName.trim().split(/\s+/).filter(Boolean);
  return {
    first_name: b.firstName.trim() || (words.length > 1 ? words[0] : ""),
    last_name: b.lastName.trim() || (words.length > 1 ? words[words.length - 1] : ""),
    city: b.city.trim(),
    state: b.state.trim(),
  };
}

/** Birthday and birthplace from the voice counselor call (the personal_info row, not the profile). */
export async function personalFacts(userId: string | undefined): Promise<Record<string, string>> {
  if (!userId) return {};
  try {
    const info = (await (await getStore()).personalInfo.get(userId)) ?? {};
    const facts: Record<string, string> = {
      birth_date: info.birthDate?.trim() ?? "",
      birth_country: info.birthCountry?.trim() ?? "",
      birth_city: info.birthCity?.trim() ?? "",
    };
    return Object.fromEntries(Object.entries(facts).filter(([, v]) => v));
  } catch (error) {
    console.error("[uc] Couldn't read personal info:", error);
    return {};
  }
}

/** The student's chosen PIQs with their saved answers (what Materials → Essays shows), in UC's numbering. */
export function ucPiqs(profile: Profile): UcPiq[] {
  return chosenPiqs(profile).flatMap((id) => {
    const index = PIQ_PROMPTS.findIndex((q) => q.id === id);
    const text = piqWorkOf(profile, id).draft?.text.trim();
    return index >= 0 && text ? [{ number: index + 1, title: PIQ_PROMPTS[index].title, text }] : [];
  });
}

/** UC statuses where the student acts in the cloud browser themselves before the assistant goes on. */
const YOUR_TURN = new Set(["waiting", "needs_code", "login_failed", "needs_you"]);

/**
 * Cloud mode: Browserbase session. Hidden by default — status only — unless the student opts in
 * to watch, or an error / login failure / your-turn moment needs the live view.
 */
export function CloudBrowserPanel({
  popup,
  run,
  onRetry,
  onClose,
  closing,
  startWatching = false,
}: {
  /** Open with the live view showing (the chat's Watch button). */
  startWatching?: boolean;
  /** Shown centered over the browser, e.g. UC asking for a verification code. */
  popup?: ReactNode;
  run: UcRun | null;
  onRetry: (() => void) | null;
  /** Closes the cloud browser (and any leftover ones) so it stops using browser time. */
  onClose: () => void;
  closing: boolean;
}) {
  const [watching, setWatching] = useState(startWatching);
  const failed = !!run && !run.open && (run.status === "error" || run.status === "disconnected" || run.status === "login_failed");
  const failedTitle = run?.status === "login_failed" ? "Wrong email or password" : run?.status === "disconnected" ? "The cloud browser disconnected" : "The cloud browser couldn't start";
  const ended = !!run && !run.open && !failed;
  const liveUrl = run?.open && !closing ? run.live_url : null;
  const yourTurn = !!liveUrl && !run?.finished && YOUR_TURN.has(run?.status ?? "");
  // The code popup asks for this itself, so nothing should point the student at the browser instead.
  const askingCode = run?.status === "needs_code" || run?.status === "checking_code";
  const forceShow = watching || failed || yourTurn || askingCode || !!popup;

  let pill: { text: string; tone: "busy" | "turn" | "bad" | "idle" } | null;
  if (!run) pill = { text: "Not started", tone: "idle" };
  else if (closing && run.open) pill = { text: "Closing", tone: "busy" };
  else if (failed) pill = { text: run.status === "disconnected" ? "Disconnected" : run.status === "login_failed" ? "Couldn't sign in" : "Couldn't start", tone: "bad" };
  else if (run.finished) pill = null;
  else if (ended) pill = { text: "Session ended", tone: "idle" };
  else if (yourTurn) pill = { text: "Your turn", tone: "turn" };
  else pill = { text: liveUrl ? "Assistant working" : "Starting", tone: "busy" };

  const address = run?.page_url || (liveUrl ? "apply.universityofcalifornia.edu" : "");

  let screen: ReactNode;
  if (liveUrl && forceShow) {
    screen = <iframe src={liveUrl} title="UC application in the cloud browser" sandbox="allow-same-origin allow-scripts" allow="clipboard-read; clipboard-write" />;
  } else if (liveUrl && !forceShow) {
    screen = (
      <div className="cloud-browser-empty">
        <strong>Working in the background</strong>
        <span>{run?.detail || "Filling in your UC application. You won't see the browser unless something needs you."}</span>
        <button type="button" className="btn-ghost" onClick={() => setWatching(true)}>
          Watch browser
        </button>
      </div>
    );
  } else if (run && failed) {
    screen = (
      <div className="cloud-browser-empty">
        <strong>{failedTitle}</strong>
        {run.status !== "login_failed" && <span>{run.detail}</span>}
        {onRetry && (
          <button type="button" className="btn-primary" onClick={onRetry}>
            <RetryIcon width={15} height={15} /> Retry
          </button>
        )}
      </div>
    );
  } else if (run?.open) {
    screen = (
      <div className="cloud-browser-empty">
        <span className="cloud-browser-spinner" aria-hidden="true" />
        <strong>{closing ? "Closing the browser…" : run.detail}</strong>
      </div>
    );
  } else if (run) {
    screen = (
      <div className="cloud-browser-empty">
        <strong>{run.finished ? "Ready for review" : "The cloud session ended"}</strong>
        <span>
          {run.finished
            ? run.detail || "Review everything on UC's site and submit it yourself."
            : run.detail}
        </span>
        {onRetry && (
          <button type="button" className="btn-ghost" onClick={onRetry}>
            <RetryIcon width={15} height={15} /> Start again
          </button>
        )}
      </div>
    );
  } else {
    screen = (
      <div className="cloud-browser-empty">
        <strong>Ready when you are</strong>
        <span>Start below. The assistant fills the application in the background — open the live view only if you want to watch or something goes wrong.</span>
      </div>
    );
  }

  return (
    <section className="cloud-browser" aria-label="Cloud browser">
      <div className="cloud-browser-bar">
        <span className="cloud-browser-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="cloud-browser-url" title={address}>
          {forceShow ? address || "about:blank" : "Working in background"}
        </span>
        {pill && (
          <span className={`cloud-browser-pill is-${pill.tone}`} role="status" aria-live="polite">
            {pill.tone === "busy" && <span className="uc-run-dot" aria-hidden="true" />}
            {pill.text}
          </span>
        )}
        {liveUrl && (
          <button type="button" className="cloud-browser-close" onClick={() => setWatching((w) => !w)} title={watching ? "Hide the live view" : "Watch the browser"}>
            {watching ? "Hide view" : "Watch"}
          </button>
        )}
        <button
          type="button"
          className="cloud-browser-close"
          onClick={onClose}
          disabled={closing}
          title="Close the cloud browser so it stops using browser time"
        >
          <XIcon width={14} height={14} /> {closing ? "Closing…" : "Close browser"}
        </button>
      </div>

      {run?.open && !closing && (
        <p className={`cloud-browser-detail${yourTurn ? " is-turn" : ""}${run.finished ? " is-good" : ""}`}>
          {askingCode ? (
            "UC is waiting for your verification code."
          ) : yourTurn ? (
            <>
              <strong>Take over in the browser below.</strong> {run.detail} The assistant picks back up when you're done.
            </>
          ) : run.finished ? (
            <>
              <strong>Ready for review.</strong> {run.detail || "The assistant filled in everything it could. Look it over on UC's site and submit it yourself."}
            </>
          ) : (
            run.detail
          )}
        </p>
      )}

      <div className="cloud-browser-screen">
        {screen}
        {!closing && popup}
      </div>

      {liveUrl && forceShow && (
        <div className="cloud-browser-foot">
          <a href={liveUrl} target="_blank" rel="noreferrer">
            Open in a new tab <ExternalIcon width={12} height={12} />
          </a>
          {watching && (
            <button type="button" className="btn-ghost" onClick={() => setWatching(false)}>
              Hide browser
            </button>
          )}
        </div>
      )}
    </section>
  );
}
