/**
 * The application tools story mode opens in its Review & Apply pop-ups: finding and emailing the
 * school counselor, the voice call with Jordan, and filling in the UC application. (These used to
 * live on the Apply page, which has been folded into the chatbot.)
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ApiError,
  activeUcRun,
  cancelUcAccount,
  closeCloudBrowsers,
  draftCounselorEmail,
  findCounselors,
  startUcAccount,
  submitUcCode,
  ucAccountStatus,
  type FoundCounselor,
  type UcBrowser,
  type UcPiq,
  type UcRun,
} from "../api";
import { useAuth } from "../auth";
import { getStore } from "../data";
import { VoiceCounselor } from "./VoiceCounselor";
import { generateUcPassword, gmailComposeUrl, mailtoUrl, entryYear, ucDeadlineDate } from "./logic";
import { CheckIcon, CopyIcon, ExternalIcon, EyeIcon, MailIcon, RetryIcon, UserIcon, XIcon } from "../components/icons";
import { PIQ_PROMPTS } from "../journey/logic";
import { chosenPiqs, piqWorkOf } from "../journey/piqs";
import { profileSummary, useProfile } from "../profile";
import type { AgentState, CallLine, PersonalInfo, Profile } from "../types";

const message = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong. Try again.");

const shortDate = (date: string | number) =>
  new Date(typeof date === "string" ? `${date}T12:00:00` : date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

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
      onPersonalInfo={(info) => {
        if (account) void savePersonalInfo(account.id, info);
      }}
    />
  );
}

/** Merges the birthday / birthplace Jordan heard into the student's personal_info row (not the profile). */
async function savePersonalInfo(userId: string, info: PersonalInfo) {
  try {
    const store = await getStore();
    const saved = (await store.personalInfo.get(userId)) ?? {};
    await store.personalInfo.save(userId, { ...saved, ...info });
  } catch (error) {
    console.error("[voice] Couldn't save personal info:", error);
  }
}

/** Finds the student's school counselor online, then drafts an email they send from Gmail. */
export function SchoolCounselor({ agent, change }: TaskProps) {
  const { profile } = useProfile();
  const studentName = useStudentName();
  const b = profile.basics;
  const [school, setSchool] = useState(b.highSchool);
  const [found, setFound] = useState<FoundCounselor[] | null>(null);
  const [picked, setPicked] = useState<number | "manual">(0);
  const [manual, setManual] = useState({ name: "", email: "" });
  const [busy, setBusy] = useState<"find" | "draft" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const counselor = agent.counselor;
  const draft = agent.counselorEmail;
  // A call with the virtual counselor, if there was one, helps the email say what the student wants to talk about.
  const callTranscript = (agent.counselorCall?.lines ?? []).map((l) => `${l.role === "student" ? "Student" : "Counselor"}: ${l.text}`).join("\n");

  const find = async () => {
    setBusy("find");
    setError(null);
    try {
      const list = await findCounselors({ highSchool: school.trim(), city: b.city, state: b.state, lastName: b.lastName });
      setFound(list);
      setPicked(list.length ? 0 : "manual");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : message(e));
    } finally {
      setBusy(null);
    }
  };

  const writeEmail = async (name: string) => {
    setBusy("draft");
    setError(null);
    try {
      const email = await draftCounselorEmail(name, studentName, profileSummary(profile), callTranscript);
      change((a) => ({ ...a, counselorEmail: email }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const confirm = () => {
    const chosen =
      picked === "manual"
        ? { name: manual.name.trim(), email: manual.email.trim(), title: "", serves: "", sourceUrl: "" }
        : (({ match: _match, ...c }) => c)(found![picked]);
    change((a) => ({ ...a, counselor: { ...chosen, confirmedAt: Date.now() }, counselorEmail: undefined }));
    void writeEmail(chosen.name);
  };

  const errorBox = error && (
    <p className="form-error" role="alert">
      {error}
    </p>
  );

  // Step 1 of 3: find and confirm the counselor.
  if (!counselor) {
    const pickedOne = picked === "manual" ? !!manual.name.trim() && EMAIL_OK.test(manual.email.trim()) : !!found?.[picked]?.email;
    return (
      <>
        <CounselorSteps at={0} />
        {!found ? (
          <form
            className="agent-find"
            onSubmit={(e) => {
              e.preventDefault();
              if (school.trim()) void find();
            }}
          >
            <label className="field">
              <span className="field-label">Your high school</span>
              <input value={school} onChange={(e) => setSchool(e.target.value)} placeholder="e.g. Lincoln High School" />
              <span className="field-hint">
                We search your school's website for its counselors{b.lastName ? ` and match yours by your last name (${b.lastName})` : ""}.
              </span>
            </label>
            <button type="submit" className="btn-primary" disabled={!school.trim() || busy === "find"}>
              {busy === "find" ? "Searching your school's site…" : "Find my counselor"}
            </button>
          </form>
        ) : (
          <form
            className="agent-pick"
            onSubmit={(e) => {
              e.preventDefault();
              if (pickedOne) confirm();
            }}
          >
            <p className="agent-lead">
              {found.length ? "Is this your counselor? Pick the right one and confirm." : "We couldn't find your counselors online. Add yours below."}
            </p>
            <div className="agent-options" role="radiogroup" aria-label="Counselors">
              {found.map((c, i) => (
                <label key={`${c.name}-${i}`} className={`agent-option${picked === i ? " on" : ""}${c.email ? "" : " disabled"}`}>
                  <input type="radio" name="counselor" checked={picked === i} onChange={() => setPicked(i)} disabled={!c.email} />
                  <span className="agent-option-text">
                    <strong>
                      {c.name}
                      {c.match && <span className="agent-match">Matches your last name</span>}
                    </strong>
                    <small>{[c.title, c.serves && `Students ${c.serves}`].filter(Boolean).join(" · ")}</small>
                    <small>{c.email || "No email listed"}</small>
                    {c.sourceUrl && (
                      <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="agent-source">
                        Source <ExternalIcon width={12} height={12} />
                      </a>
                    )}
                  </span>
                </label>
              ))}
              <label className={`agent-option${picked === "manual" ? " on" : ""}`}>
                <input type="radio" name="counselor" checked={picked === "manual"} onChange={() => setPicked("manual")} />
                <span className="agent-option-text">
                  <strong>Someone else</strong>
                  {picked === "manual" && (
                    <span className="agent-manual">
                      <input
                        value={manual.name}
                        onChange={(e) => setManual((m) => ({ ...m, name: e.target.value }))}
                        placeholder="Counselor's name"
                        aria-label="Counselor's name"
                      />
                      <input
                        type="email"
                        value={manual.email}
                        onChange={(e) => setManual((m) => ({ ...m, email: e.target.value }))}
                        placeholder="Counselor's email"
                        aria-label="Counselor's email"
                      />
                    </span>
                  )}
                </span>
              </label>
            </div>
            <div className="agent-actions">
              <button type="submit" className="btn-primary" disabled={!pickedOne}>
                Confirm and write my email
              </button>
              <button type="button" className="btn-ghost" onClick={() => setFound(null)}>
                Search again
              </button>
            </div>
          </form>
        )}
        {errorBox}
      </>
    );
  }

  const resetCounselor = () => change(({ counselor: _c, counselorEmail: _e, ...a }) => a);

  // Step 3 of 3: sent.
  if (draft?.sentAt) {
    return (
      <>
        <CounselorSteps at={3} />
        <p className="agent-lead">
          You emailed {counselor.name} on {shortDate(draft.sentAt)}.
        </p>
        <div className="agent-actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => change((a) => ({ ...a, counselorEmail: a.counselorEmail && { ...a.counselorEmail, sentAt: undefined } }))}
          >
            I didn't actually send it
          </button>
        </div>
      </>
    );
  }

  const opened = () => change((a) => ({ ...a, counselorEmail: a.counselorEmail && { ...a.counselorEmail, openedAt: Date.now() } }));

  // Step 2 of 3: review the draft, open it in Gmail, click Send.
  return (
    <>
      <CounselorSteps at={draft?.openedAt ? 2 : 1} />
      <div className="agent-counselor">
        <span>
          To <strong>{counselor.name}</strong> &lt;{counselor.email}&gt;
        </span>
        <button type="button" className="agent-link" onClick={resetCounselor}>
          Change counselor
        </button>
      </div>
      {!draft ? (
        busy === "draft" ? (
          <p className="agent-lead" aria-busy="true">
            Writing your email…
          </p>
        ) : (
          <div className="agent-actions">
            <button type="button" className="btn-primary" onClick={() => void writeEmail(counselor.name)}>
              Write my email
            </button>
          </div>
        )
      ) : (
        <>
          <label className="field">
            <span className="field-label">Subject</span>
            <input value={draft.subject} onChange={(e) => change((a) => ({ ...a, counselorEmail: { ...draft, subject: e.target.value } }))} />
          </label>
          <label className="field">
            <span className="field-label">Message</span>
            <textarea rows={10} value={draft.body} onChange={(e) => change((a) => ({ ...a, counselorEmail: { ...draft, body: e.target.value } }))} />
            <span className="field-hint">Edit anything you like. It opens in Gmail exactly like this, and you click Send.</span>
          </label>
          <div className="agent-actions">
            <a className="btn-primary" href={gmailComposeUrl(counselor.email, draft.subject, draft.body)} target="_blank" rel="noreferrer" onClick={opened}>
              <MailIcon width={16} height={16} /> Open in Gmail
            </a>
            <a className="btn-ghost" href={mailtoUrl(counselor.email, draft.subject, draft.body)} onClick={opened}>
              Use my mail app instead
            </a>
            <button type="button" className="btn-ghost" onClick={() => void writeEmail(counselor.name)} disabled={busy === "draft"}>
              {busy === "draft" ? "Rewriting…" : "Rewrite it"}
            </button>
          </div>
          {draft.openedAt && (
            <div className="agent-confirm">
              <span>Did you click Send?</span>
              <button
                type="button"
                className="btn-primary"
                onClick={() => change((a) => ({ ...a, counselorEmail: a.counselorEmail && { ...a.counselorEmail, sentAt: Date.now() } }))}
              >
                <CheckIcon width={16} height={16} /> Yes, I sent it
              </button>
            </div>
          )}
        </>
      )}
      {errorBox}
    </>
  );
}

function CounselorSteps({ at }: { at: number }) {
  const labels = ["Find your counselor", "Review the email", "Click Send"];
  return (
    <ol className="agent-steps" aria-label="Progress">
      {labels.map((label, i) => (
        <li key={label} className={i < at ? "done" : i === at ? "on" : undefined} aria-current={i === at ? "step" : undefined}>
          {label}
        </li>
      ))}
    </ol>
  );
}

const UC_LOGIN_URL = "https://apply.universityofcalifornia.edu/my-application/login";

const UC_RESET_URL = "https://apply.universityofcalifornia.edu/my-application/resetPassword";

const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Creates (or signs in to) the student's UC application account. The backend opens UC in a
 * real browser window (on this computer, or in the cloud) and fills it in; the student agrees
 * to UC's terms and submits there.
 */
export function UcAccountTask({
  agent,
  change,
  browser = "cloud",
  onBusyChange,
  onRunBrowser,
}: TaskProps & {
  /** A run that was already open when the popup opened: the popup's switch follows its mode. */
  onRunBrowser?: (browser: UcBrowser) => void;
  /** Where the next run's browser starts (the popup's Local / Cloud switch). */
  browser?: UcBrowser;
  /** Tells the popup when a run starts and ends, so the switch locks while one is going. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const { account } = useAuth();
  const { profile } = useProfile();
  const saved = agent.ucAccount;
  const [email, setEmail] = useState(saved?.email ?? account?.email ?? "");
  const [run, setRun] = useState<UcRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const runId = useRef<string | null>(null);
  const changeRef = useRef(change);
  changeRef.current = change;

  // Reopening the popup: reconnect to a UC window that's still open (it may be using cloud time).
  const onRunBrowserRef = useRef(onRunBrowser);
  onRunBrowserRef.current = onRunBrowser;
  const reconnect = useCallback(async () => {
    const found = await activeUcRun();
    if (!found) return false;
    runId.current = found.runId;
    setRun(found.run);
    if (found.run.browser) onRunBrowserRef.current?.(found.run.browser);
    return true;
  }, []);
  useEffect(() => {
    void reconnect();
  }, [reconnect]);

  // Follow the UC window until it closes, recording what happened there.
  useEffect(() => {
    if (!run?.open || !runId.current) return;
    const id = runId.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const next = await ucAccountStatus(id, controller.signal);
        if (runId.current !== id) return;
        setRun(next);
        // Save each milestone once, so the next visit continues from it.
        changeRef.current((a) => {
          const uc = a.ucAccount;
          if (!uc) return a;
          const now = Date.now();
          const nextUc = {
            ...uc,
            createdAt: uc.createdAt ?? (next.created ? now : undefined),
            verifiedAt: uc.verifiedAt ?? (next.verified ? now : undefined),
            setupAt: uc.setupAt ?? (next.setup ? now : undefined),
            aboutAt: uc.aboutAt ?? (next.about ? now : undefined),
            piqAt: uc.piqAt ?? (next.piq ? now : undefined),
            signedInAt: next.status === "signed_in" ? now : uc.signedInAt,
          };
          const same = (["createdAt", "verifiedAt", "setupAt", "aboutAt", "piqAt", "signedInAt"] as const).every((k) => nextUc[k] === uc[k]);
          return same ? a : { ...a, ucAccount: nextUc };
        });
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(message(e));
          setRun((r) => (r ? { ...r, open: false } : r));
        }
      }
    }, 1000);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [run]);

  // The last start, so Retry can repeat it.
  const lastLaunch = useRef<{ mode: "login" | "create"; creds: { email: string; password: string } } | null>(null);

  const launch = async (mode: "login" | "create", creds: { email: string; password: string }) => {
    setError(null);
    lastLaunch.current = { mode, creds };
    const starting: UcRun = {
      status: "opening",
      detail: browser === "cloud" ? "Starting cloud browser…" : "Opening the UC application…",
      mode,
      open: true,
      created: false,
      browser,
      live_url: null,
      page_url: "",
      finished: false,
      verified: false,
      setup: false,
      about: false,
      about_report: { filled: [], missing: [], check: [] },
      piq: false,
      piq_report: { entered: [], skipped: [] },
    };
    // Cloud shows its panel's starting state right away; the session itself takes a few seconds.
    if (browser === "cloud") {
      runId.current = null;
      setRun(starting);
    }
    try {
      const id = await startUcAccount(
        creds.email,
        creds.password,
        mode,
        { ...ucFacts(profile, account?.name ?? ""), ...(await personalFacts(account?.id)) },
        !!agent.ucAccount?.aboutAt,
        !!(agent.ucAccount?.verifiedAt || agent.ucAccount?.signedInAt),
        ucPiqs(profile),
        browser,
      );
      runId.current = id;
      setRun({ ...starting }); // a new object, so polling starts now that the run has an id
    } catch (e) {
      // "A UC window is already open": show that one instead of an error.
      if (await reconnect()) return;
      if (browser === "cloud") setRun({ ...starting, status: "error", detail: message(e), open: false });
      else setError(message(e));
    }
  };

  const retry = () => {
    if (lastLaunch.current) void launch(lastLaunch.current.mode, lastLaunch.current.creds);
  };

  const createAccount = () => {
    const creds = { email: email.trim(), password: generateUcPassword() };
    change((a) => ({ ...a, ucAccount: { ...creds, generatedAt: Date.now() } }));
    launch("create", creds);
  };

  const sendCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!runId.current) return;
    setError(null);
    try {
      await submitUcCode(runId.current, code);
      setCode("");
      setRun((r) => (r ? { ...r, status: "checking_code", detail: "Entering your code…" } : r));
    } catch (e) {
      setError(message(e));
    }
  };

  const busy = !!run?.open;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const stop = async () => {
    if (!runId.current) return;
    try {
      await cancelUcAccount(runId.current);
    } catch (e) {
      setError(message(e));
    }
  };
  // Ends the run and any cloud browser left over (e.g. from before a server restart), to save browser time.
  const [closing, setClosing] = useState(false);
  const closeCloud = async () => {
    setClosing(true);
    setError(null);
    try {
      await closeCloudBrowsers();
    } catch (e) {
      setError(message(e));
    } finally {
      setClosing(false);
    }
  };

  const cloudPanel = browser === "cloud" && (
    <CloudBrowserPanel
      run={run?.browser === "cloud" ? run : null}
      onRetry={lastLaunch.current ? retry : null}
      onClose={closeCloud}
      closing={closing || run?.detail === "Stopping…"}
    />
  );
  const errorBox = error && (
    <p className="form-error" role="alert">
      {error}
    </p>
  );

  // No UC login saved under this Track2College account yet: make one.
  if (!saved) {
    return (
      <div className="agent-step">
        <p className="agent-lead">
          We'll open the official UC application {browser === "cloud" ? "in a cloud browser" : "on this computer"}, make you a strong password, and fill in UC's sign-up form. You just agree
          to UC's terms and click Create account.
        </p>
        <label className="field">
          <span className="field-label">Email for your UC account</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <span className="field-hint">Use an email you'll check through senior year. UC sends every update here.</span>
        </label>
        <div className="agent-actions">
          <button type="button" className="btn-primary" onClick={createAccount} disabled={!EMAIL_OK.test(email.trim())}>
            <UserIcon width={16} height={16} /> Create my UC account
          </button>
        </div>
        {errorBox}
        {cloudPanel}
      </div>
    );
  }

  const done = !!(saved.verifiedAt || saved.signedInAt);
  // Once UC has the account, signing in always picks up wherever the student left off there.
  const exists = !!(saved.createdAt || done);
  return (
    <div className="agent-step">
      {/* Cloud runs report their status in the browser panel instead. */}
      {run && run.browser !== "cloud" && <UcRunStatus run={run} />}
      {cloudPanel}

      {run?.open && run.status === "needs_code" && (
        <form className="uc-code" onSubmit={sendCode}>
          <label className="field">
            <span className="field-label">Verification code from UC</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))}
              placeholder="e.g. 123456"
              autoComplete="one-time-code"
              maxLength={10}
              autoFocus
            />
            <span className="field-hint">Check {saved.email} (and your spam folder) for an email from UC.</span>
          </label>
          <button type="submit" className="btn-primary" disabled={code.length < 4}>
            Enter code
          </button>
        </form>
      )}

      {browser === "local" ? (
        <div className="agent-actions">
          <button
            type="button"
            className="btn-primary uc-run-big"
            onClick={() => launch(exists || run?.status === "login_failed" ? "login" : "create", saved)}
            disabled={busy}
          >
            <ExternalIcon width={18} height={18} /> {busy ? "Running on this computer…" : "Run on this computer"}
          </button>
          {busy && (
            <button type="button" className="btn-ghost" onClick={stop} disabled={run?.detail === "Stopping…"}>
              Stop
            </button>
          )}
          {!busy && run?.status === "login_failed" && (
            <a className="btn-ghost" href={UC_RESET_URL} target="_blank" rel="noreferrer">
              Reset it on UC <ExternalIcon width={12} height={12} />
            </a>
          )}
        </div>
      ) : (
      <div className="agent-actions">
        {exists || run?.status === "login_failed" ? (
          <button type="button" className="btn-primary" onClick={() => launch("login", saved)} disabled={busy}>
            <ExternalIcon width={16} height={16} /> {busy ? "Agent is running…" : "Run agent"}
          </button>
        ) : (
          <>
            <button type="button" className="btn-primary" onClick={() => launch("create", saved)} disabled={busy}>
              <UserIcon width={16} height={16} /> {busy ? "UC window is open…" : "Open UC sign-up again"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => launch("login", saved)} disabled={busy}>
              I already created it — sign me in
            </button>
          </>
        )}
        {busy && (
          <button type="button" className="btn-ghost" onClick={stop} disabled={run?.detail === "Stopping…"}>
            Stop
          </button>
        )}
        {!busy && run?.status === "login_failed" && (
          <a className="btn-ghost" href={UC_RESET_URL} target="_blank" rel="noreferrer">
            Reset it on UC <ExternalIcon width={12} height={12} />
          </a>
        )}
        <p className="field-hint agent-diy">
          Prefer to do it yourself?{" "}
          <a href={UC_LOGIN_URL} target="_blank" rel="noreferrer">
            Open the UC application
          </a>
          .
        </p>
      </div>
      )}

      {!exists && !busy && (
        <button type="button" className="agent-link" onClick={() => change(({ ucAccount: _u, ...a }) => a)}>
          Start over with a different email
        </button>
      )}
      {errorBox}
    </div>
  );
}

/** What the assistant will fill in on UC, from the profile and chosen essays (read-only). */
export function PreparedInfo() {
  const { profile } = useProfile();
  const { account } = useAuth();
  const facts = ucFacts(profile, account?.name ?? "");
  const piqs = ucPiqs(profile);
  const rows: [string, string][] = [
    ["First name", facts.first_name],
    ["Last name", facts.last_name],
    ["City", facts.city],
    ["State", facts.state],
  ];
  return (
    <section className="apply-panel" aria-labelledby="prepared-heading">
      <h2 id="prepared-heading" className="apply-panel-title">
        Ready to fill in
      </h2>
      <p className="agent-lead">The assistant enters these on UC for you. Anything missing is left for you in the UC window.</p>
      <dl className="apply-prepared">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={value ? undefined : "is-missing"}>{value || "Not in your profile yet"}</dd>
          </div>
        ))}
        <div>
          <dt>Personal insight answers</dt>
          <dd className={piqs.length ? undefined : "is-missing"}>
            {piqs.length ? piqs.map((q) => `${q.number}. ${q.title}`).join(" · ") : "No drafts yet. Write them in Profile → Essays."}
          </dd>
        </div>
      </dl>
      <p className="field-hint">Your birthday and birthplace come from your counselor call, if you had one.</p>
    </section>
  );
}

/** What Track2College knows that UC's "About you" asks for. Only exact answers; the rest is left to the student. */
function ucFacts(profile: Profile, signUpName: string): Record<string, string> {
  const b = profile.basics;
  // Onboarding never asks for a last name, so fall back to the full name given at sign-up
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
async function personalFacts(userId: string | undefined): Promise<Record<string, string>> {
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
function ucPiqs(profile: Profile): UcPiq[] {
  return chosenPiqs(profile).flatMap((id) => {
    const index = PIQ_PROMPTS.findIndex((q) => q.id === id);
    const text = piqWorkOf(profile, id).draft?.text.trim();
    return index >= 0 && text ? [{ number: index + 1, title: PIQ_PROMPTS[index].title, text }] : [];
  });
}

/** UC statuses where the student acts in the cloud browser themselves before the assistant goes on. */
const YOUR_TURN = new Set(["waiting", "needs_code", "login_failed", "needs_you"]);

/**
 * Cloud mode: the real UC page from the Browserbase session, live, inside the modal. The student can
 * click into it to sign in or enter UC's code, and the assistant picks up again once the page moves on.
 */
function CloudBrowserPanel({
  run,
  onRetry,
  onClose,
  closing,
}: {
  run: UcRun | null;
  onRetry: (() => void) | null;
  /** Closes the cloud browser (and any leftover ones) so it stops using browser time. */
  onClose: () => void;
  closing: boolean;
}) {
  const failed = !!run && !run.open && (run.status === "error" || run.status === "disconnected");
  const ended = !!run && !run.open && !failed;
  const liveUrl = run?.open ? run.live_url : null;
  const yourTurn = !!liveUrl && !run?.finished && YOUR_TURN.has(run?.status ?? "");

  let pill: { text: string; tone: "busy" | "turn" | "bad" | "idle" } | null;
  if (!run) pill = { text: "Not started", tone: "idle" };
  else if (failed) pill = { text: run.status === "disconnected" ? "Disconnected" : "Couldn't start", tone: "bad" };
  else if (run.finished) pill = null;
  else if (ended) pill = { text: "Session ended", tone: "idle" };
  else if (yourTurn) pill = { text: "Your turn", tone: "turn" };
  else pill = { text: liveUrl ? "Assistant working" : "Starting", tone: "busy" };

  const address = run?.page_url || (liveUrl ? "apply.universityofcalifornia.edu" : "");

  let screen: ReactNode;
  if (liveUrl) {
    screen = <iframe src={liveUrl} title="UC application in the cloud browser" sandbox="allow-same-origin allow-scripts" allow="clipboard-read; clipboard-write" />;
  } else if (run && failed) {
    screen = (
      <div className="cloud-browser-empty">
        <strong>{run.status === "disconnected" ? "The cloud browser disconnected" : "The cloud browser couldn't start"}</strong>
        <span>{run.detail}</span>
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
        <strong>{run.detail}</strong>
      </div>
    );
  } else if (run) {
    screen = (
      <div className="cloud-browser-empty">
        <strong>{run.finished ? "Ready for review" : "The cloud session ended"}</strong>
        <span>{run.finished ? "Review everything on UC's site and submit it yourself." : run.detail}</span>
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
        <strong>The UC application will show here</strong>
        <span>Start below and watch the assistant fill it in. You can click in and take over any time.</span>
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
          {address || "about:blank"}
        </span>
        {pill && (
          <span className={`cloud-browser-pill is-${pill.tone}`} role="status" aria-live="polite">
            {pill.tone === "busy" && <span className="uc-run-dot" aria-hidden="true" />}
            {pill.text}
          </span>
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

      {run && (run.open || failed) && (
        <p className={`cloud-browser-detail${yourTurn ? " is-turn" : ""}${failed ? " is-bad" : ""}${run.finished ? " is-good" : ""}`}>
          {yourTurn ? (
            <>
              <strong>Take over in the browser below.</strong> {run.detail} The assistant picks back up when you're done.
            </>
          ) : run.finished ? (
            <>
              <strong>Ready for review.</strong> The assistant filled in everything it could. Look it over on UC's site and submit it yourself.
            </>
          ) : (
            run.detail
          )}
        </p>
      )}

      <div className="cloud-browser-screen">{screen}</div>

      {liveUrl && (
        <div className="cloud-browser-foot">
          <a href={liveUrl} target="_blank" rel="noreferrer">
            Open in a new tab <ExternalIcon width={12} height={12} />
          </a>
        </div>
      )}
    </section>
  );
}

function UcRunStatus({ run }: { run: UcRun }) {
  const good = ["submitted", "verified", "ready", "signed_in", "about_done", "piq_done"].includes(run.status);
  const bad = run.status === "login_failed" || run.status === "error";
  return (
    <div className={`uc-run${good ? " is-good" : bad ? " is-bad" : ""}`} role="status" aria-live="polite">
      {run.open && !good && !bad && <span className="uc-run-dot" aria-hidden="true" />}
      {good && <CheckIcon width={16} height={16} />}
      <span>{run.detail}</span>
    </div>
  );
}

/** The student's saved UC email and password, with show and copy (shown beside the UC application tool). */
export function UcCredentials({ email, password }: { email: string; password: string }) {
  return (
    <div className="uc-creds" aria-label="Your UC login">
      <div className="uc-cred">
        <span className="uc-cred-label">Email</span>
        <span className="uc-cred-value">{email}</span>
        <CopyButton value={email} label="Copy email" />
      </div>
      <div className="uc-cred">
        <span className="uc-cred-label">Password</span>
        <SecretValue value={password} />
        <CopyButton value={password} label="Copy password" />
      </div>
    </div>
  );
}

function SecretValue({ value }: { value: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="uc-cred-value uc-cred-secret">
      <code>{shown ? value : "•".repeat(value.length)}</code>
      <button
        type="button"
        className="uc-icon-btn"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
      >
        <EyeIcon crossed={shown} width={15} height={15} />
      </button>
    </span>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="uc-icon-btn"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={() =>
        navigator.clipboard.writeText(value).then(
          () => setCopied(true),
          () => undefined,
        )
      }
    >
      {copied ? <CheckIcon width={15} height={15} /> : <CopyIcon width={15} height={15} />}
    </button>
  );
}
