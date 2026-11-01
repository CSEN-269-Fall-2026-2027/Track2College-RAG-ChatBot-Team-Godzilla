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
import { ENTRANCE_H, ENTRANCE_W, entrancePixels, type Office } from "../agent/entrance";
import {
  agentOf,
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
} from "../agent/logic";
import { ArrowRightIcon, CheckIcon, CopyIcon, ExternalIcon, EyeIcon, LockIcon, MailIcon, MicIcon, UserIcon } from "../components/icons";
import { academicStarted, storyComplete } from "../journey/guided";
import { AFTER_APPLY, computeJourney, PIQ_PROMPTS } from "../journey/logic";
import { chosenPiqs, piqWorkOf } from "../journey/piqs";
import { completeness, profileSummary, useProfile } from "../profile";
import { href, navigate } from "../router";
import type { AgentState, PersonalInfo, Profile } from "../types";

const message = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong. Try again.");
const shortDate = (date: string | number) =>
  new Date(typeof date === "string" ? `${date}T12:00:00` : date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const monthDay = (date: string | number) =>
  new Date(typeof date === "string" ? `${date}T12:00:00` : date).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** The three places the Apply hub leads to, in the order they're shown (not steps). */
const OFFICES: { id: Office; title: string; blurb: string; cta: string }[] = [
  { id: "counselor", title: "Counselor", blurb: "Talk through your next move.", cta: "Visit the counselor" },
  { id: "application", title: "Application assistant", blurb: "Bring your UC application together.", cta: "Open the assistant" },
  { id: "aid", title: "Financial aid", blurb: "Explore ways to pay for college.", cta: "Explore aid" },
];

/**
 * Apply: a hub with the UC deadline and three destinations, each on its own page
 * (#/agent/counselor, #/agent/application, #/agent/aid) plus the dates view (#/agent/dates).
 * Locked until the story is finished; the dates stay viewable either way.
 */
export function AgentMode({ section = null }: { section?: string | null }) {
  const { profile } = useProfile();
  if (section === "dates") return <DatesPage />;
  if (!storyComplete(profile, completeness(profile).sections)) return <ApplyLocked />;
  if (section === "counselor" || section === "application" || section === "aid") return <OfficePage office={section} />;
  return <ApplyHub />;
}

/** Current time, refreshed every minute so day counts roll over at midnight while the page stays open. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function ApplyPage({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className="page-scroll apply-bg">
      <div className={`page-inner agent-page ${className}`}>{children}</div>
    </div>
  );
}

/** The hub: the deadline sign, then the three office entrances side by side. */
function ApplyHub() {
  return (
    <ApplyPage className="apply-hub">
      <DeadlineSign />
      <h1 className="apply-hub-title">Where to next?</h1>
      <ul className="apply-offices">
        {OFFICES.map((o, i) => (
          <li key={o.id} className={`apply-office apply-office-${o.id}`}>
            <div className="apply-office-art">
              <Entrance office={o.id} />
            </div>
            <div className="apply-office-text">
              <h2>
                <span className="apply-office-num" aria-hidden="true">
                  {i + 1}
                </span>
                {o.title}
              </h2>
              <p>{o.blurb}</p>
              <OfficeStatus office={o.id} />
            </div>
            <a className="btn-primary apply-office-go" href={href("agent", o.id)}>
              {o.cta} <ArrowRightIcon width={15} height={15} />
            </a>
          </li>
        ))}
      </ul>
    </ApplyPage>
  );
}

function Entrance({ office, small = false }: { office: Office; small?: boolean }) {
  return (
    <svg
      className={`apply-entrance${small ? " is-small" : ""}`}
      viewBox={`0 0 ${ENTRANCE_W} ${ENTRANCE_H}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {entrancePixels(office).map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  );
}

/** A quiet progress line from saved data; nothing invented. */
function officeStatus(office: Office, profile: Profile): { text: string; done: boolean } {
  const a = agentOf(profile);
  if (office === "counselor") {
    if (a.counselorCall) return { text: `Talked with Jordan ${monthDay(a.counselorCall.endedAt)}`, done: true };
    if (a.counselorEmail?.sentAt && a.counselor) return { text: `Emailed ${a.counselor.name}`, done: true };
    if (a.counselor && a.counselorEmail) return { text: "Email ready to send", done: false };
    return { text: "Not started", done: false };
  }
  if (office === "application") {
    const uc = a.ucAccount;
    if (uc?.piqAt) return { text: "Essays entered on UC", done: true };
    if (uc?.aboutAt) return { text: "About you filled in", done: true };
    if (uc?.verifiedAt || uc?.signedInAt) return { text: "UC account ready", done: true };
    if (uc) return { text: "UC account started", done: false };
    return { text: "Not started", done: false };
  }
  if (a.fafsaDoneAt) return { text: `Marked done ${monthDay(a.fafsaDoneAt)}`, done: true };
  return { text: `Priority deadline ${monthDay(aidDeadlineDate(profile))}`, done: false };
}

function OfficeStatus({ office }: { office: Office }) {
  const { profile } = useProfile();
  const { text, done } = officeStatus(office, profile);
  return (
    <span className={`apply-status${done ? " is-done" : ""}`}>
      {done && <CheckIcon width={13} height={13} aria-hidden="true" />}
      {text}
    </span>
  );
}

/** The sign above the offices: time left to apply for the student's own cycle. */
function DeadlineSign() {
  const { profile } = useProfile();
  const now = useNow();
  const days = daysUntilUcDeadline(profile, now);
  const period = filingPeriod(profile, now);
  const entering = entryYear(profile, now);

  return (
    <section className="apply-sign" aria-label="UC application deadline">
      <div className={`apply-sign-board${days <= 7 && days >= 0 ? " is-urgent" : ""}${days < 0 ? " is-passed" : ""}`}>
        <span className="apply-sign-eyebrow">UC application · Fall {entering}</span>
        <p
          className="apply-sign-count"
          role="timer"
          aria-label={days < 0 ? "The UC application deadline has passed" : days === 0 ? "Due today" : `${days} days left to apply`}
        >
          {days > 0 ? (
            <>
              <strong>{days}</strong> day{days === 1 ? "" : "s"} left to apply
            </>
          ) : (
            <strong>{days < 0 ? "Applications closed" : "Due today"}</strong>
          )}
        </p>
        <p className="apply-sign-date">
          {days < 0 ? (
            "Check apply.universityofcalifornia.edu for any extension."
          ) : (
            <>
              Due <time dateTime={period.closes}>{shortDate(period.closes)}</time>, 11:59 PM Pacific
            </>
          )}
        </p>
        <div
          className="apply-sign-bar"
          role="progressbar"
          aria-label="UC filing period elapsed"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(period.progress * 100)}
        >
          <span style={{ width: `${period.progress * 100}%` }} />
        </div>
        <a className="apply-sign-link" href={href("agent", "dates")}>
          View dates <ArrowRightIcon width={13} height={13} />
        </a>
      </div>
      <span className="apply-sign-posts" aria-hidden="true" />
    </section>
  );
}

/** Each destination: a back link, the office's heading, then its existing tools. */
function DestinationPage({ title, blurb, art, children }: { title: string; blurb: string; art?: Office; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  return (
    <ApplyPage className="apply-dest">
      <a className="apply-back" href={href("agent")}>
        <ArrowRightIcon width={15} height={15} style={{ transform: "rotate(180deg)" }} /> Back to Apply
      </a>
      <header className="apply-dest-head">
        {art && <Entrance office={art} small />}
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {title}
          </h1>
          <p>{blurb}</p>
          {art && <OfficeStatus office={art} />}
        </div>
      </header>
      {children}
    </ApplyPage>
  );
}

function OfficePage({ office }: { office: Office }) {
  const { profile, update } = useProfile();
  const agent = agentOf(profile);
  const change = (fn: (a: AgentState) => AgentState) => update((p) => setAgent(p, fn));
  const o = OFFICES.find((x) => x.id === office)!;

  return (
    <DestinationPage title={o.title} blurb={o.blurb} art={office}>
      {office === "counselor" && (
        <section className="apply-panel" aria-label="Talk to a counselor">
          <CounselorTask agent={agent} change={change} />
        </section>
      )}
      {office === "application" && (
        <>
          <PreparedInfo />
          <section className="apply-panel" aria-labelledby="uc-account-heading">
            <h2 id="uc-account-heading" className="apply-panel-title">
              Your UC application account
            </h2>
            <UcAccountTask agent={agent} change={change} />
          </section>
        </>
      )}
      {office === "aid" && <AidGuide agent={agent} change={change} />}
    </DestinationPage>
  );
}

/** What the assistant will fill in on UC, from the profile and chosen essays (read-only). */
function PreparedInfo() {
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

/** Financial aid: which form to file, the Cal Grant deadline, and the existing FAFSA / Dream Act task. */
function AidGuide({ agent, change }: TaskProps) {
  const { profile } = useProfile();
  const due = shortDate(aidDeadlineDate(profile));
  return (
    <>
      <section className="apply-panel" aria-labelledby="aid-forms-heading">
        <h2 id="aid-forms-heading" className="apply-panel-title">
          File one aid application
        </h2>
        <div className="apply-aid-forms">
          <div>
            <h3>FAFSA</h3>
            <p>For U.S. citizens and eligible noncitizens. Opens federal grants, work-study, and loans, and counts for Cal Grant.</p>
          </div>
          <div>
            <h3>CA Dream Act Application</h3>
            <p>For undocumented students, DACA recipients, and others who qualify for California's AB 540 tuition exemption.</p>
          </div>
        </div>
        <ul className="apply-aid-notes">
          <li>
            <strong>Cal Grant priority deadline: {due}.</strong> Your school also has to send your GPA, so ask your counselor to confirm it did.
          </li>
          <li>Applying to UC doesn't apply you for aid. You're considered for UC grants once your aid application is in.</li>
        </ul>
        <a className="apply-inline-link" href="https://admission.universityofcalifornia.edu/tuition-financial-aid/" target="_blank" rel="noreferrer">
          UC tuition and financial aid <ExternalIcon width={12} height={12} />
        </a>
      </section>
      <section className="apply-panel" aria-labelledby="aid-task-heading">
        <h2 id="aid-task-heading" className="apply-panel-title">
          Submit the FAFSA or CA Dream Act
        </h2>
        <FafsaTask agent={agent} change={change} />
      </section>
    </>
  );
}

/** Every upcoming date for the student's cycle, plus the Intent to Register task. */
function DatesPage() {
  const { profile, update } = useProfile();
  const now = useNow();
  const agent = agentOf(profile);
  const change = (fn: (a: AgentState) => AgentState) => update((p) => setAgent(p, fn));
  const events = calendarEvents(profile, now);
  const period = filingPeriod(profile, now);

  return (
    <DestinationPage title="Dates" blurb={`Your Fall ${entryYear(profile, now)} application cycle.`}>
      <section className="apply-panel" aria-labelledby="window-heading">
        <h2 id="window-heading" className="apply-panel-title">
          UC filing period
        </h2>
        <div className="apply-sign-bar" aria-hidden="true">
          <span style={{ width: `${period.progress * 100}%` }} />
        </div>
        <div className="apply-period-scale">
          <span>
            {period.progress > 0 ? "Opened" : "Opens"} {shortDate(period.opens)}
          </span>
          <span>Closes {shortDate(period.closes)}</span>
        </div>
      </section>

      <section className="apply-panel" aria-labelledby="dates-heading">
        <h2 id="dates-heading" className="apply-panel-title">
          Coming up
        </h2>
        {events.length ? (
          <ol className="apply-dates-list">
            {events.map((e) => (
              <li key={e.key} className={e.key === "uc-deadline" ? "is-key" : undefined}>
                <time dateTime={e.date}>
                  <small>{new Date(`${e.date}T12:00:00`).toLocaleDateString(undefined, { month: "short" })}</small>
                  {Number(e.date.slice(8))}
                </time>
                <span>
                  <strong>{e.title}</strong>
                  <small>{e.detail}</small>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="agent-lead">No upcoming dates for this cycle.</p>
        )}
      </section>

      <section className="apply-panel" aria-labelledby="sir-heading">
        <h2 id="sir-heading" className="apply-panel-title">
          Submit your Intent to Register
        </h2>
        <SirTask agent={agent} change={change} />
      </section>
    </DestinationPage>
  );
}

/** Shown until every story checkpoint before Review & Apply is complete. */
function ApplyLocked() {
  const { profile } = useProfile();
  const sections = completeness(profile).sections;
  const steps = computeJourney(profile, sections, academicStarted(profile)).checkpoints.filter((c) => !AFTER_APPLY.includes(c.id));

  return (
    <ApplyPage>
      <DeadlineSign />
      <section className="apply-locked">
        <img
          src="/apply/locked.png"
          alt="A pixel-art student beside a sleeping golden padlock: “You found the door. Now finish the quest.”"
        />
        <span className="agent-mode-tag">Apply</span>
        <h1>Apply is locked</h1>
        <p>Finish these steps in Chatbot first. Once they're done, Apply opens and Sage handles the busywork for you.</p>
        <ul className="apply-locked-steps">
          {steps.map((c) => (
            <li key={c.id} className={c.complete ? "is-done" : undefined}>
              {c.complete ? <CheckIcon width={16} height={16} /> : <LockIcon width={16} height={16} />}
              <strong>{c.title}</strong>
              <span>{c.complete ? "Done" : c.summary}</span>
            </li>
          ))}
        </ul>
        <button className="btn-primary" onClick={() => navigate("advisor")}>
          Back to Chatbot
        </button>
      </section>
    </ApplyPage>
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
