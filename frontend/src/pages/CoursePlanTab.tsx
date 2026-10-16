import { useState, type FormEvent } from "react";
import { AREA_LABEL, LEVEL_LABEL } from "../academics";
import { COLLEGE_NAMES } from "../colleges";
import { formatDate, hostOf } from "../format";
import { usePlanning } from "../planning";
import { useProfile } from "../profile";
import { href } from "../router";
import type { CoursePlan } from "../types";
import { BookIcon, ChatIcon, CheckIcon, ExternalIcon, RetryIcon, TrashIcon } from "../components/icons";

const GRADE_TITLE = { "9": "9th grade", "10": "10th grade", "11": "11th grade", "12": "12th grade" } as const;

export function CoursePlanTab({ onAsk }: { onAsk: (text: string) => void }) {
  const { profile } = useProfile();
  const { plans, planning, planError, buildPlan, removePlan, transcripts } = usePlanning();
  const [college, setCollege] = useState(profile.colleges[0]?.name ?? "");
  const [major, setMajor] = useState(profile.goals.majors.find((m) => m !== "Undecided") ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const plan = plans.find((p) => p.id === selectedId) ?? plans[0];
  const transcript = transcripts[0];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!college.trim() || planning) return;
    const created = await buildPlan(college.trim(), major.trim());
    if (created) setSelectedId(created.id);
  };

  const suggestions = [...new Set([...profile.colleges.map((c) => c.name), ...COLLEGE_NAMES])];

  return (
    <>
      <section className="card">
        <header className="card-head">
          <h2>Build a course plan</h2>
          <p>Choose a target college. The plan uses that school's official requirements and the courses you've already taken.</p>
        </header>
        <form className="plan-form" onSubmit={submit}>
          <div className="field">
            <label className="field-label" htmlFor="plan-college">
              Target college
            </label>
            <input id="plan-college" value={college} onChange={(e) => setCollege(e.target.value)} list="plan-colleges" placeholder="UC Davis" required />
            <datalist id="plan-colleges">
              {suggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="plan-major">
              Intended major
            </label>
            <input id="plan-major" value={major} onChange={(e) => setMajor(e.target.value)} placeholder="Optional" />
          </div>
          <button className="btn-primary" disabled={!college.trim() || !!planning}>
            <BookIcon width={15} height={15} />
            {planning ? "Building…" : "Build plan"}
          </button>
        </form>
        <p className="field-hint plan-hint">
          {transcript ? (
            <>
              <CheckIcon width={13} height={13} /> Using {transcript.courses.length} courses from {transcript.fileName}.
            </>
          ) : (
            <>
              No transcript yet. <a href={href("profile", "transcript")}>Upload one</a> so the plan accounts for what you've completed.
            </>
          )}
          {!profile.basics.gradeLevel && (
            <>
              {" "}
              <a href={href("profile", "basics")}>Add your grade</a> to get a plan that starts from this year.
            </>
          )}
        </p>
        {planError && (
          <p className="form-error" role="alert">
            {planError}
          </p>
        )}
      </section>

      {planning && (
        <section className="card">
          <div className="ai-loading" aria-live="polite">
            <p className="shimmer">Reading {planning} requirements and planning your courses…</p>
            <div className="skeleton-grid">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} />
              ))}
            </div>
          </div>
        </section>
      )}

      {plans.length > 1 && (
        <div className="region-chips plan-chips">
          {plans.map((p) => (
            <button key={p.id} className={p.id === plan?.id ? "on" : ""} onClick={() => setSelectedId(p.id)}>
              {p.college}
            </button>
          ))}
        </div>
      )}

      {plan && !planning && <PlanView plan={plan} onRemove={() => removePlan(plan.id)} onRebuild={() => buildPlan(plan.college, plan.major)} onAsk={onAsk} />}
    </>
  );
}

function PlanView({ plan, onRemove, onRebuild, onAsk }: { plan: CoursePlan; onRemove: () => void; onRebuild: () => void; onAsk: (text: string) => void }) {
  return (
    <section className="card plan-card">
      <header className="ai-head">
        <div>
          <h2 className="plan-title">{plan.college}</h2>
          <p className="plan-meta">{[plan.major, `Created ${formatDate(plan.createdAt)}`].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="transcript-actions">
          <button className="btn-ghost" onClick={onRebuild}>
            <RetryIcon width={14} height={14} /> Rebuild
          </button>
          <button className="icon-btn" onClick={onRemove} aria-label="Delete plan" title="Delete plan">
            <TrashIcon width={16} height={16} />
          </button>
        </div>
      </header>

      {plan.summary && <p className="ai-summary">{plan.summary}</p>}

      {plan.requirements.length > 0 && (
        <div className="requirements">
          <h3>What {plan.college} expects</h3>
          <ul>
            {plan.requirements.map((r) => (
              <li key={`${r.area}-${r.detail}`}>
                <strong>{r.area}</strong> {r.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="year-grid">
        {plan.years.map((year) => (
          <div key={year.grade} className="year-col">
            <h3>{GRADE_TITLE[year.grade]}</h3>
            <ul>
              {year.courses.map((course, i) => (
                <li key={`${course.name}-${i}`} className={course.status === "completed" ? "done" : ""}>
                  <div className="plan-course-top">
                    <span className="plan-course-name">
                      {course.status === "completed" && <CheckIcon width={13} height={13} />}
                      {course.name}
                    </span>
                    {course.level !== "regular" && <span className="level-badge">{LEVEL_LABEL[course.level]}</span>}
                  </div>
                  {course.area !== "none" && (
                    <span className="plan-course-area">
                      {course.area.toUpperCase()} · {AREA_LABEL[course.area]}
                    </span>
                  )}
                  {course.note && <span className="plan-course-note">{course.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {plan.tips.length > 0 && (
        <div className="pill-list strengths plan-tips">
          <h3>Tips</h3>
          <ul>
            {plan.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      <footer className="plan-foot">
        {plan.sources.map((url) => (
          <a key={url} href={url} target="_blank" rel="noreferrer" className="source-link">
            {hostOf(url)} <ExternalIcon width={12} height={12} />
          </a>
        ))}
        <button className="link-btn" onClick={() => onAsk(`I'm following a course plan for ${plan.college}. What should I prioritize this year?`)}>
          <ChatIcon width={13} height={13} /> Discuss with advisor
        </button>
      </footer>
      <p className="disclaimer plan-disclaimer">Always confirm course choices with your school counselor; offerings vary by high school.</p>
    </section>
  );
}
