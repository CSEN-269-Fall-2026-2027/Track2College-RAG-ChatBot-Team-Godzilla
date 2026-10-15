import { useState, type FormEvent } from "react";
import { useAnalysis } from "../analysis";
import { useAuth } from "../auth";
import { planningChecklist } from "../checklist";
import { PROFILE_SECTIONS, completeness, displayName, upcomingDeadlines, useProfile } from "../profile";
import { href } from "../router";
import { ProgressRing } from "../components/Form";
import { ArrowRightIcon, ArrowUpIcon, CalendarIcon, CheckIcon, SparkIcon } from "../components/icons";
import { daysLabel, formatDeadline } from "../format";

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

const QUICK_PROMPTS = ["How do I apply for Cal Grant?", "What GPA do I need for UCLA?", "When are UC applications due?"];

export function Overview({ onAsk }: { onAsk: (text: string) => void }) {
  const { account } = useAuth();
  const { profile } = useProfile();
  const { analysis, stale } = useAnalysis();
  const [question, setQuestion] = useState("");

  const { overall, sections } = completeness(profile);
  const nextSection = PROFILE_SECTIONS.find((s) => sections[s.id] < 1);
  const todo = planningChecklist(profile).filter((i) => !i.done).slice(0, 4);
  const deadlines = upcomingDeadlines(profile).filter((d) => d.days >= 0).slice(0, 3);
  const name = displayName(profile, account?.name ?? "");
  const { gradeLevel, graduationYear, highSchool } = profile.basics;
  const meta = [graduationYear && `Class of ${graduationYear}`, highSchool, profile.goals.majors.slice(0, 2).join(" & ")].filter(Boolean);
  const isNew = overall === 0;

  const ask = (event: FormEvent) => {
    event.preventDefault();
    if (question.trim()) onAsk(question.trim());
  };

  return (
    <div className="page-scroll">
      <div className="page-inner">
        <header className="hero">
          <h1>
            {greeting()}, {name}
          </h1>
          <p>{meta.length ? meta.join(" · ") : isNew ? "Let's set up your college plan. Start with your profile." : "Here's where your college plan stands."}</p>
        </header>

        <form className="quick-ask" onSubmit={ask}>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask the advisor anything about college…" aria-label="Ask the advisor" />
          <button className="send-btn" disabled={!question.trim()} aria-label="Ask">
            <ArrowUpIcon />
          </button>
        </form>
        <div className="quick-prompts">
          {QUICK_PROMPTS.map((p) => (
            <button key={p} className="chip chip-ghost" onClick={() => onAsk(p)}>
              {p}
            </button>
          ))}
        </div>

        <div className="overview-grid">
          <section className="card profile-card">
            <div className="profile-card-top">
              <ProgressRing value={overall} size={64} stroke={6} />
              <div>
                <h2>{isNew ? "Build your profile" : overall === 1 ? "Profile complete" : "Your profile"}</h2>
                <p>
                  {Math.round(overall * 100)}% complete
                  {gradeLevel && ` · ${gradeLevel === "gap" ? "Gap year" : gradeLevel === "transfer" ? "Transfer" : `Grade ${gradeLevel}`}`}
                </p>
              </div>
            </div>
            <ul className="mini-sections">
              {PROFILE_SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={href("profile", s.id)}>
                    <span className="mini-bar">
                      <span style={{ width: `${sections[s.id] * 100}%` }} />
                    </span>
                    <span>{s.title}</span>
                  </a>
                </li>
              ))}
            </ul>
            {nextSection && (
              <a className="btn-primary" href={href("profile", nextSection.id)}>
                {isNew ? "Start with" : "Continue:"} {nextSection.title} <ArrowRightIcon width={16} height={16} />
              </a>
            )}
          </section>

          <section className="card">
            <header className="card-head row-head">
              <h2>Next steps</h2>
              <a href={href("insights")} className="card-link">
                All <ArrowRightIcon width={14} height={14} />
              </a>
            </header>
            {todo.length === 0 ? (
              <p className="list-empty">You've checked off everything on your planning list. Nice work.</p>
            ) : (
              <ul className="checklist">
                {todo.map((item) => (
                  <li key={item.id}>
                    <a href={href("profile", item.section)}>
                      <span className="check" />
                      <span>{item.label}</span>
                      <ArrowRightIcon width={14} height={14} className="check-go" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <header className="card-head row-head">
              <h2>Upcoming deadlines</h2>
              <CalendarIcon className="muted-icon" />
            </header>
            {deadlines.length === 0 ? (
              <p className="list-empty">
                {profile.colleges.length ? (
                  <a href={href("profile", "colleges")}>Add deadlines to your colleges</a>
                ) : (
                  <a href={href("profile", "colleges")}>Add colleges to your list</a>
                )}{" "}
                to see them here.
              </p>
            ) : (
              <ol className="timeline compact">
                {deadlines.map(({ college, date, days }) => (
                  <li key={college.id} className={days <= 14 ? "soon" : ""}>
                    <span className="timeline-dot" />
                    <span className="timeline-body">
                      <strong>{college.name}</strong>
                      <span>{formatDeadline(date)}</span>
                    </span>
                    <span className="timeline-days">{daysLabel(days)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="card insight-teaser">
            <header className="card-head row-head">
              <h2>
                <SparkIcon width={17} height={17} /> AI insights
              </h2>
              {analysis && stale && <span className="tag">Outdated</span>}
            </header>
            {analysis ? (
              <>
                <p className="teaser-summary">{analysis.summary}</p>
                <div className="fit-summary">
                  {(["reach", "target", "likely"] as const).map((fit) => {
                    const count = analysis.colleges.filter((c) => c.fit === fit).length;
                    return count ? (
                      <span key={fit} className={`fit fit-${fit}`}>
                        {count} {fit}
                      </span>
                    ) : null;
                  })}
                </div>
                <a className="card-link" href={href("insights")}>
                  See full analysis <ArrowRightIcon width={14} height={14} />
                </a>
              </>
            ) : (
              <>
                <p className="list-empty">Get an AI review of your strengths, gaps, and how each college on your list fits.</p>
                <a className="btn-ghost" href={href("insights")}>
                  <SparkIcon width={15} height={15} /> Go to insights
                </a>
              </>
            )}
            {analysis && analysis.actions[0] && (
              <div className="teaser-action">
                <CheckIcon width={14} height={14} />
                <span>
                  <strong>Top priority:</strong> {analysis.actions[0].title}
                </span>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
