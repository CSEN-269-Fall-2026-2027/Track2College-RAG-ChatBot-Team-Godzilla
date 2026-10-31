import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ApiError,
  draftCounselorEmail,
  findCounselors,
  startUcAccount,
  submitUcCode,
  ucAccountStatus,
  type FoundCounselor,
  type UcPiq,
  type UcRun,
} from "../api";
import { useAuth } from "../auth";
import { getStore } from "../data";
import { VoiceCounselor } from "../agent/VoiceCounselor";
import {
  agentOf,
  agentTasks,
  aidDeadlineDate,
  calendarEvents,
  daysUntilUcDeadline,
  filingPeriod,
  generateUcPassword,
  gmailComposeUrl,
  mailtoUrl,
  entryYear,
  setAgent,
  ucDeadlineDate,
  sirDeadlineDate,
  type AgentTaskId,
} from "../agent/logic";
import { BookIcon, CheckIcon, CopyIcon, ExternalIcon, EyeIcon, FlagIcon, LockIcon, MailIcon, MicIcon, UserIcon } from "../components/icons";
import { useGame } from "../game/GameProvider";
import { academicStarted, storyComplete } from "../journey/guided";
import { computeJourney, PIQ_PROMPTS } from "../journey/logic";
import { chosenPiqs, piqWorkOf } from "../journey/piqs";
import { completeness, profileSummary, useProfile } from "../profile";
import { navigate } from "../router";
import type { AgentState, PersonalInfo, Profile } from "../types";

const ICONS = { counselor: MicIcon, ucAccount: UserIcon, fafsa: BookIcon, sir: FlagIcon } as const;

const message = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong. Try again.");
const shortDate = (date: string | number) =>
  new Date(typeof date === "string" ? `${date}T12:00:00` : date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/** Apply: open at all times, but locked until the story is finished. */
export function AgentMode() {
  const { profile } = useProfile();
  return storyComplete(profile, completeness(profile).sections) ? <ApplyWorkspace /> : <ApplyLocked />;
}

const monthDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Current time, refreshed every minute so day counts roll over at midnight while the page stays open. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** Main column plus a sticky deadline sidebar; the sidebar moves above the content on narrow screens. */
function ApplyLayout({ children }: { children: ReactNode }) {
  return (
    <div className="page-scroll">
      <div className="page-inner agent-page">
        <div className="apply-layout">
          <div className="apply-main">{children}</div>
          <DeadlineSidebar />
        </div>
      </div>
    </div>
  );
}

function DeadlineSidebar() {
  const { profile } = useProfile();
  const now = useNow();
  const days = daysUntilUcDeadline(profile, now);
  const period = filingPeriod(profile, now);
  const upcoming = calendarEvents(profile, now).slice(0, 4);

  return (
    <aside className="apply-aside" aria-label="Deadlines">
      <section
        className={`apply-countdown${days <= 7 && days >= 0 ? " is-urgent" : ""}${days < 0 ? " is-passed" : ""}`}
        role="timer"
        aria-label={days < 0 ? "The UC application deadline has passed" : `${days} days until the UC application deadline`}
      >
        <span className="apply-countdown-eyebrow">UC application deadline</span>
        <p className="apply-countdown-date">
          {days > 0 ? (
            <>
              <strong>{days}</strong>
              <span className="apply-countdown-unit">
                <span>day{days === 1 ? "" : "s"}</span>
                <span>left</span>
              </span>
            </>
          ) : (
            <strong className="is-word">{days < 0 ? "Closed" : "Due today"}</strong>
          )}
        </p>
        {days < 0 && <p className="apply-countdown-due">Check apply.universityofcalifornia.edu for any extension.</p>}
        <div className="apply-countdown-period">
          <div
            className="apply-countdown-bar"
            role="progressbar"
            aria-label="UC filing period elapsed"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(period.progress * 100)}
          >
            <span style={{ width: `${period.progress * 100}%` }} />
          </div>
          <div className="apply-countdown-scale">
            <span>
              {period.progress > 0 ? "Opened" : "Opens"} {monthDay(period.opens)}
            </span>
            <time className="apply-countdown-left" dateTime={period.closes}>
              {monthDay(period.closes)}
            </time>
          </div>
        </div>
      </section>

      {upcoming.length > 0 && (
        <section className="apply-dates">
          <h2>Coming up</h2>
          <ol>
            {upcoming.map((e) => (
              <li key={e.key} className={e.key === "uc-deadline" ? "is-key" : undefined}>
                <time dateTime={e.date}>
                  <small>{new Date(`${e.date}T12:00:00`).toLocaleDateString(undefined, { month: "short" })}</small>
                  {Number(e.date.slice(8))}
                </time>
                <span>{e.title}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </aside>
  );
}

/** Shown until every story checkpoint before Review & Apply is complete. */
function ApplyLocked() {
  const { profile } = useProfile();
  const { updateSettings } = useGame();
  const sections = completeness(profile).sections;
  const steps = computeJourney(profile, sections, academicStarted(profile)).checkpoints.filter((c) => c.id !== "review");

  return (
    <ApplyLayout>
      <section className="apply-locked">
        <img
          src="/apply/locked.png"
          alt="A pixel-art student beside a sleeping golden padlock: “You found the door. Now finish the quest.”"
        />
        <span className="agent-mode-tag">Apply</span>
        <h1>Apply is locked</h1>
        <p>Finish the story with Sage first. Once these steps are done, Apply opens and Sage handles the busywork for you.</p>
        <ul className="apply-locked-steps">
          {steps.map((c) => (
            <li key={c.id} className={c.complete ? "is-done" : undefined}>
              {c.complete ? <CheckIcon width={16} height={16} /> : <LockIcon width={16} height={16} />}
              <strong>{c.title}</strong>
              <span>{c.complete ? "Done" : c.summary}</span>
            </li>
          ))}
        </ul>
        <button
          className="btn-primary"
          onClick={() => {
            updateSettings({ storyMode: true });
            navigate("advisor");
          }}
        >
          Continue the story
        </button>
      </section>
    </ApplyLayout>
  );
}

/** Story mode is done, so the agent does the application busywork and the student approves it. */
function ApplyWorkspace() {
  const { profile, update } = useProfile();
  const agent = agentOf(profile);
  const tasks = agentTasks(profile);
  const firstOpen = tasks.find((t) => !t.done && !t.comingSoon)?.id ?? null;
  const [open, setOpen] = useState<AgentTaskId | null>(firstOpen);
  const change = (fn: (a: AgentState) => AgentState) => update((p) => setAgent(p, fn));

  const actionable = tasks.filter((t) => !t.comingSoon);
  const doneCount = actionable.filter((t) => t.done).length;

  return (
    <ApplyLayout>
      <div className="apply-section-head">
        <h2>Your to-dos</h2>
        <span>
          {doneCount} of {actionable.length} done
        </span>
      </div>
      <ol className="agent-tasks">
        {tasks.map((task, i) => {
          const Icon = ICONS[task.id];
          const expanded = open === task.id && !task.comingSoon;
          return (
            <li
              key={task.id}
              className={`agent-task${task.done ? " done" : ""}${task.comingSoon ? " soon" : ""}${expanded ? " open" : ""}`}
            >
              <button
                type="button"
                className="agent-task-head"
                onClick={() => setOpen(expanded ? null : task.id)}
                disabled={task.comingSoon}
                aria-expanded={expanded}
              >
                <span className="agent-task-num">{task.done ? <CheckIcon width={16} height={16} /> : i + 1}</span>
                <Icon width={18} height={18} className="agent-task-icon" />
                <span className="agent-task-text">
                  <strong>{task.title}</strong>
                </span>
                {task.comingSoon ? (
                  <span className="agent-badge">
                    <LockIcon width={13} height={13} /> Coming soon
                  </span>
                ) : task.done ? (
                  <span className="agent-badge agent-badge-done">Done</span>
                ) : null}
              </button>
              {expanded && (
                <div className="agent-task-body">
                  {task.id === "counselor" && <CounselorTask agent={agent} change={change} />}
                  {task.id === "ucAccount" && <UcAccountTask agent={agent} change={change} />}
                  {task.id === "fafsa" && <FafsaTask agent={agent} change={change} />}
                  {task.id === "sir" && <SirTask agent={agent} change={change} />}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </ApplyLayout>
  );
}

interface TaskProps {
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

/**
 * Talk to a counselor: a switch between Jordan, the virtual (AI voice) counselor, and the
 * student's real school counselor, whom we find online and draft an email to. Either one
 * completes the task; the switch remembers the student's last pick.
 */
function CounselorTask({ agent, change }: TaskProps) {
  const mode = agent.counselorMode ?? (agent.counselor ? "school" : "virtual");
  return (
    <div className="agent-step">
      <div className="counselor-switch" role="tablist" aria-label="Which counselor">
        {(
          [
            ["virtual", "Virtual counselor", MicIcon],
            ["school", "My school counselor", MailIcon],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            className={mode === id ? "on" : undefined}
            onClick={() => change((a) => ({ ...a, counselorMode: id }))}
          >
            <Icon width={15} height={15} /> {label}
          </button>
        ))}
      </div>
      {mode === "virtual" ? <VirtualCounselor agent={agent} change={change} /> : <SchoolCounselor agent={agent} change={change} />}
    </div>
  );
}

/** A voice call with Jordan, the AI counselor. */
function VirtualCounselor({ agent, change }: TaskProps) {
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
      onEnd={(lines) => change((a) => ({ ...a, counselorCall: { endedAt: Date.now(), lines } }))}
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
function SchoolCounselor({ agent, change }: TaskProps) {
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
 * real browser window on this computer and fills it in; the student agrees to UC's terms there.
 */
function UcAccountTask({ agent, change }: TaskProps) {
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

  const launch = async (mode: "login" | "create", creds: { email: string; password: string }) => {
    setError(null);
    try {
      runId.current = await startUcAccount(
        creds.email,
        creds.password,
        mode,
        { ...ucFacts(profile, account?.name ?? ""), ...(await personalFacts(account?.id)) },
        !!agent.ucAccount?.aboutAt,
        !!(agent.ucAccount?.verifiedAt || agent.ucAccount?.signedInAt),
        ucPiqs(profile),
      );
      setRun({
        status: "opening",
        detail: "Opening the UC application…",
        mode,
        open: true,
        created: false,
        verified: false,
        setup: false,
        about: false,
        about_report: { filled: [], missing: [], check: [] },
        piq: false,
        piq_report: { entered: [], skipped: [] },
      });
    } catch (e) {
      setError(message(e));
    }
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
          We'll open the official UC application on this computer, make you a strong password, and fill in UC's sign-up form. You just agree
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
      </div>
    );
  }

  const done = !!(saved.verifiedAt || saved.signedInAt);
  // Once UC has the account, signing in always picks up wherever the student left off there.
  const exists = !!(saved.createdAt || done);
  return (
    <div className="agent-step">
      <div className="uc-creds" aria-label="Your UC login">
        <div className="uc-cred">
          <span className="uc-cred-label">Email</span>
          <span className="uc-cred-value">{saved.email}</span>
          <CopyButton value={saved.email} label="Copy email" />
        </div>
        <div className="uc-cred">
          <span className="uc-cred-label">Password</span>
          <SecretValue value={saved.password} />
          <CopyButton value={saved.password} label="Copy password" />
        </div>
        <p className="uc-creds-note">
          We generated this password and saved it to your Track2College account so you can always find it here. Save it in your password
          manager too.
        </p>
      </div>

      {run && <UcRunStatus run={run} />}
      {run && <AboutYouReport report={run.about_report} />}
      {run && <PiqReport report={run.piq_report} />}

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

      <div className="agent-actions">
        {exists || run?.status === "login_failed" ? (
          <button type="button" className="btn-primary" onClick={() => launch("login", saved)} disabled={busy}>
            <ExternalIcon width={16} height={16} /> {busy ? "UC window is open…" : "Continue on UC"}
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
        {!busy && run?.status === "login_failed" && (
          <a className="btn-ghost" href={UC_RESET_URL} target="_blank" rel="noreferrer">
            Reset it on UC <ExternalIcon width={12} height={12} />
          </a>
        )}
      </div>

      {!exists && !busy && (
        <button type="button" className="agent-link" onClick={() => change(({ ucAccount: _u, ...a }) => a)}>
          Start over with a different email
        </button>
      )}
      <p className="field-hint">
        Prefer to do it yourself?{" "}
        <a href={UC_LOGIN_URL} target="_blank" rel="noreferrer">
          Open the UC application
        </a>
        .
      </p>
      {errorBox}
    </div>
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

/** Personal insight on UC: which answers went in, and which were left alone. */
function PiqReport({ report }: { report: UcRun["piq_report"] }) {
  if (!report.entered.length && !report.skipped.length) return null;
  return (
    <div className="uc-report" aria-label="Personal insight on UC">
      {report.entered.length > 0 && (
        <section>
          <h4>Personal insight answers entered</h4>
          <ul>
            {report.entered.map((title) => (
              <li key={title}>
                <span>{title}</span>
                <b>Entered</b>
              </li>
            ))}
          </ul>
        </section>
      )}
      {report.skipped.length > 0 && (
        <section className="uc-report-needs">
          <h4>Left for you</h4>
          <ul>
            {report.skipped.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** "About you" on UC: what we filled, and what's left for the student. */
function AboutYouReport({ report }: { report: UcRun["about_report"] }) {
  if (!report.filled.length && !report.missing.length) return null;
  return (
    <div className="uc-report" aria-label="About you on UC">
      {report.missing.length > 0 && (
        <section className="uc-report-needs">
          <h4>Needs you in the UC window</h4>
          <ul>
            {report.missing.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </section>
      )}
      {report.filled.length > 0 && (
        <section>
          <h4>Filled in for you</h4>
          <ul>
            {report.filled.map((f) => (
              <li key={f.label}>
                <span>{f.label}</span>
                <b>{f.value}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
      {report.check.map((note) => (
        <p key={note} className="uc-report-check">
          {note}
        </p>
      ))}
    </div>
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

/** A deadline the student handles on an official site, then marks done here. */
function DeadlineTask({
  due,
  links,
  doneAt,
  setDone,
}: {
  due: string;
  links: { label: string; url: string }[];
  doneAt?: number;
  setDone: (at: number | undefined) => void;
}) {
  return (
    <div className="agent-step">
      <p className="agent-lead">{doneAt ? `Marked done ${shortDate(doneAt)}.` : `Due ${shortDate(due)}.`}</p>
      <div className="agent-actions">
        {!doneAt &&
          links.map((link, i) => (
            <a key={link.url} className={i === 0 ? "btn-primary" : "btn-ghost"} href={link.url} target="_blank" rel="noreferrer">
              {link.label} <ExternalIcon width={14} height={14} />
            </a>
          ))}
        <button type="button" className="btn-ghost" onClick={() => setDone(doneAt ? undefined : Date.now())}>
          {doneAt ? (
            "Mark not done"
          ) : (
            <>
              <CheckIcon width={16} height={16} /> Mark done
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function FafsaTask({ agent, change }: TaskProps) {
  const { profile } = useProfile();
  return (
    <DeadlineTask
      due={aidDeadlineDate(profile)}
      links={[
        { label: "Open the FAFSA", url: "https://studentaid.gov/h/apply-for-aid/fafsa" },
        { label: "CA Dream Act", url: "https://dream.csac.ca.gov/" },
      ]}
      doneAt={agent.fafsaDoneAt}
      setDone={(fafsaDoneAt) => change((a) => ({ ...a, fafsaDoneAt }))}
    />
  );
}

function SirTask({ agent, change }: TaskProps) {
  const { profile } = useProfile();
  return (
    <DeadlineTask
      due={sirDeadlineDate(profile)}
      links={[{ label: "UC Admissions", url: "https://admission.universityofcalifornia.edu/" }]}
      doneAt={agent.sirDoneAt}
      setDone={(sirDoneAt) => change((a) => ({ ...a, sirDoneAt }))}
    />
  );
}
