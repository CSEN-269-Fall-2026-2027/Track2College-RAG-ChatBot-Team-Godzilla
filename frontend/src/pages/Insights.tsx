import { useAnalysis } from "../analysis";
import { planningChecklist } from "../checklist";
import { completeness, profileSummary, upcomingDeadlines, useProfile } from "../profile";
import { href } from "../router";
import { daysLabel, formatDeadline, hostOf } from "../format";
import type { Fit, ProfileAnalysis } from "../types";
import { ProgressRing } from "../components/Form";
import { AlertIcon, ArrowRightIcon, BookIcon, CalendarIcon, ChatIcon, CheckIcon, ExternalIcon, FileIcon, RetryIcon, SparkIcon } from "../components/icons";
import { TranscriptTab } from "./TranscriptTab";
import { CoursePlanTab } from "./CoursePlanTab";

const FIT_LABEL: Record<Fit, string> = { reach: "Reach", target: "Target", likely: "Likely", unknown: "Not enough info" };
const FIT_ORDER: Fit[] = ["reach", "target", "likely", "unknown"];

const TABS = [
  { id: "readiness", label: "Readiness", Icon: SparkIcon, blurb: "Where you stand, what's coming up, and an AI review of your college list." },
  { id: "transcript", label: "Transcript", Icon: FileIcon, blurb: "Upload your transcript to see your GPA, A–G progress, and AI feedback." },
  { id: "plan", label: "Course plan", Icon: BookIcon, blurb: "A year-by-year high school course plan for the college you're aiming for." },
] as const;

export function Insights({ tab: param, onAsk }: { tab: string | null; onAsk: (text: string) => void }) {
  const tab = TABS.find((t) => t.id === param) ?? TABS[0];
  return (
    <div className="page-scroll">
      <div className="page-inner">
        <header className="page-head">
          <div>
            <h1>Insights</h1>
            <p>{tab.blurb}</p>
          </div>
        </header>
        <nav className="tabs" aria-label="Insights sections">
          {TABS.map(({ id, label, Icon }) => (
            <a key={id} href={href("insights", id === "readiness" ? undefined : id)} className={id === tab.id ? "on" : ""} aria-current={id === tab.id ? "page" : undefined}>
              <Icon width={16} height={16} /> {label}
            </a>
          ))}
        </nav>
        <div key={tab.id} className="tab-panel">
          {tab.id === "readiness" && <ReadinessTab onAsk={onAsk} />}
          {tab.id === "transcript" && <TranscriptTab onAsk={onAsk} />}
          {tab.id === "plan" && <CoursePlanTab onAsk={onAsk} />}
        </div>
      </div>
    </div>
  );
}

function ReadinessTab({ onAsk }: { onAsk: (text: string) => void }) {
  const { profile } = useProfile();
  const { analysis, running, error, stale, run, cancel } = useAnalysis();
  const { overall } = completeness(profile);
  const checklist = planningChecklist(profile);
  const doneCount = checklist.filter((i) => i.done).length;
  const deadlines = upcomingDeadlines(profile);
  const nextDeadline = deadlines.find((d) => d.days >= 0);
  const hasProfile = profileSummary(profile).length > 0;
  const statusCounts = {
    building: profile.colleges.filter((c) => c.status === "researching" || c.status === "applying").length,
    submitted: profile.colleges.filter((c) => c.status === "submitted").length,
    decisions: profile.colleges.filter((c) => ["accepted", "waitlisted", "denied"].includes(c.status)).length,
  };

  return (
    <>
        <div className="stat-grid">
          <a className="card stat" href={href("profile")}>
            <ProgressRing value={overall} size={48} stroke={5} />
            <span>
              <strong>{Math.round(overall * 100)}%</strong>
              <span className="stat-label">Profile complete</span>
            </span>
          </a>
          <div className="card stat">
            <span className="stat-icon">
              <CheckIcon />
            </span>
            <span>
              <strong>
                {doneCount}/{checklist.length}
              </strong>
              <span className="stat-label">Checklist done</span>
            </span>
          </div>
          <div className="card stat">
            <span className="stat-icon">
              <CalendarIcon />
            </span>
            <span>
              <strong>{nextDeadline ? daysLabel(nextDeadline.days) : "—"}</strong>
              <span className="stat-label">Next deadline</span>
            </span>
          </div>
          <div className="card stat">
            <span className="stat-split">
              <span>
                <strong>{statusCounts.building}</strong>
                <span className="stat-label">In progress</span>
              </span>
              <span>
                <strong>{statusCounts.submitted}</strong>
                <span className="stat-label">Submitted</span>
              </span>
              <span>
                <strong>{statusCounts.decisions}</strong>
                <span className="stat-label">Decisions</span>
              </span>
            </span>
          </div>
        </div>

        <section className="card ai-card">
          <header className="ai-head">
            <div className="ai-title">
              <span className="ai-badge">
                <SparkIcon width={18} height={18} />
              </span>
              <div>
                <h2>AI college list analysis</h2>
                <p>
                  {analysis
                    ? `Generated ${new Date(analysis.generatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
                    : "Reviews your profile against admission info from each school's official pages."}
                </p>
              </div>
            </div>
            {running ? (
              <button className="btn-ghost" onClick={cancel}>
                Cancel
              </button>
            ) : (
              <button className={analysis && !stale ? "btn-ghost" : "btn-primary"} onClick={run} disabled={!hasProfile}>
                {analysis ? <RetryIcon width={15} height={15} /> : <SparkIcon width={15} height={15} />}
                {analysis ? "Regenerate" : "Generate analysis"}
              </button>
            )}
          </header>

          {stale && !running && (
            <div className="notice">
              <AlertIcon width={16} height={16} />
              Your profile changed since this analysis was generated. Regenerate to include the latest details.
            </div>
          )}
          {error && !running && (
            <div className="error-card">
              <p>{error}</p>
              <button className="btn-ghost" onClick={run}>
                <RetryIcon width={14} height={14} /> Try again
              </button>
            </div>
          )}

          {running ? (
            <AnalysisSkeleton colleges={profile.colleges.length} />
          ) : analysis ? (
            <AnalysisResult analysis={analysis} onAsk={onAsk} />
          ) : (
            <div className="ai-empty">
              {hasProfile ? (
                <p>
                  {profile.colleges.length === 0 ? (
                    <>
                      Tip: <a href={href("profile", "colleges")}>add a few colleges</a> first to get a reach / target / likely breakdown.
                    </>
                  ) : (
                    <>Ready to analyze {profile.colleges.length} college{profile.colleges.length === 1 ? "" : "s"} on your list.</>
                  )}
                </p>
              ) : (
                <p>
                  <a href={href("profile")}>Start your profile</a> to unlock an AI analysis of your strengths, gaps, and college fit.
                </p>
              )}
            </div>
          )}
        </section>

        <div className="two-col">
          <section className="card">
            <header className="card-head">
              <h2>Deadlines</h2>
              <p>Upcoming dates for colleges you're still applying to</p>
            </header>
            {deadlines.length === 0 ? (
              <p className="list-empty">
                No deadlines yet. <a href={href("profile", "colleges")}>Add deadlines to your college list</a>.
              </p>
            ) : (
              <ol className="timeline">
                {deadlines.map(({ college, date, days }) => (
                  <li key={college.id} className={days < 0 ? "past" : days <= 14 ? "soon" : ""}>
                    <span className="timeline-dot" />
                    <span className="timeline-body">
                      <strong>{college.name}</strong>
                      <span>
                        {college.plan || "Application"} · {formatDeadline(date)}
                      </span>
                    </span>
                    <span className="timeline-days">{daysLabel(days)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="card">
            <header className="card-head">
              <h2>Checklist</h2>
              <p>
                {doneCount} of {checklist.length} complete
              </p>
            </header>
            <ul className="checklist">
              {checklist.map((item) => (
                <li key={item.id} className={item.done ? "done" : ""}>
                  <a href={href("profile", item.section)}>
                    <span className="check">{item.done && <CheckIcon width={13} height={13} />}</span>
                    <span>{item.label}</span>
                    {!item.done && <ArrowRightIcon width={14} height={14} className="check-go" />}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
    </>
  );
}

function AnalysisSkeleton({ colleges }: { colleges: number }) {
  return (
    <div className="ai-loading" aria-live="polite">
      <p className="shimmer">
        {colleges > 0 ? `Reading admission pages for ${colleges} college${colleges === 1 ? "" : "s"}…` : "Reviewing your profile…"}
      </p>
      <div className="skeleton-lines">
        <span style={{ width: "92%" }} />
        <span style={{ width: "78%" }} />
        <span style={{ width: "64%" }} />
      </div>
    </div>
  );
}

function AnalysisResult({ analysis, onAsk }: { analysis: ProfileAnalysis; onAsk: (text: string) => void }) {
  const byFit = FIT_ORDER.map((fit) => ({ fit, count: analysis.colleges.filter((c) => c.fit === fit).length })).filter(
    (x) => x.count > 0,
  );
  const sorted = [...analysis.colleges].sort((a, b) => FIT_ORDER.indexOf(a.fit) - FIT_ORDER.indexOf(b.fit));
  const missingLikely = analysis.colleges.length >= 3 && !analysis.colleges.some((c) => c.fit === "likely");

  return (
    <div className="ai-result">
      {analysis.summary && <p className="ai-summary">{analysis.summary}</p>}

      <div className="two-col tight">
        <div className="pill-list strengths">
          <h3>Strengths</h3>
          <ul>
            {analysis.strengths.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
        <div className="pill-list gaps">
          <h3>Areas to strengthen</h3>
          <ul>
            {analysis.gaps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      </div>

      {analysis.colleges.length > 0 && (
        <>
          <div className="fit-head">
            <h3>College fit</h3>
            <div className="fit-summary">
              {byFit.map(({ fit, count }) => (
                <span key={fit} className={`fit fit-${fit}`}>
                  {count} {FIT_LABEL[fit].toLowerCase()}
                </span>
              ))}
            </div>
          </div>
          {missingLikely && (
            <div className="notice">
              <AlertIcon width={16} height={16} />
              Your list has no likely schools. Consider adding one or two where your profile is well above the typical admit.
            </div>
          )}
          <div className="fit-grid">
            {sorted.map((c) => (
              <article key={c.name} className="fit-card">
                <header>
                  <strong>{c.name}</strong>
                  <span className={`fit fit-${c.fit}`}>{FIT_LABEL[c.fit]}</span>
                </header>
                <p>{c.reasoning}</p>
                <footer>
                  {c.sources.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer" className="source-link">
                      {hostOf(url)} <ExternalIcon width={12} height={12} />
                    </a>
                  ))}
                  <button className="link-btn" onClick={() => onAsk(`What should I know about applying to ${c.name}?`)}>
                    <ChatIcon width={13} height={13} /> Ask advisor
                  </button>
                </footer>
              </article>
            ))}
          </div>
        </>
      )}

      {analysis.actions.length > 0 && (
        <>
          <h3 className="actions-head">Your action plan</h3>
          <ol className="action-list">
            {analysis.actions.map((a, i) => (
              <li key={`${a.title}-${i}`}>
                <span className="action-num">{i + 1}</span>
                <div className="action-body">
                  <div className="action-top">
                    <strong>{a.title}</strong>
                    {a.timeframe && <span className="timeframe">{a.timeframe}</span>}
                  </div>
                  {a.detail && <p>{a.detail}</p>}
                </div>
                <button className="icon-btn" onClick={() => onAsk(`Help me with this step: ${a.title}. ${a.detail}`)} title="Ask the advisor about this" aria-label={`Ask the advisor about ${a.title}`}>
                  <ChatIcon width={16} height={16} />
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
