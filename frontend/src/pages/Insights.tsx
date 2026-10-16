import { useMemo, useState } from "react";
import { normalizeGrade, planningChecklist, type ChecklistGrade, type ChecklistItem, type ChecklistPhase } from "../checklist";
import { useProfile } from "../profile";
import { href } from "../router";
import type { TargetCollege } from "../types";
import { ArrowRightIcon, BookIcon, ChatIcon, CheckIcon, ChevronIcon, ExternalIcon, FileIcon } from "../components/icons";
import { CoursePlanTab } from "./CoursePlanTab";
import { EssayTab } from "./EssayTab";

const TABS = [
  { id: "readiness", label: "Checklist", Icon: CheckIcon, blurb: "Work through your college plan by grade, and keep your list next to it." },
  { id: "essays", label: "Essays", Icon: FileIcon, blurb: "Brainstorm topics or draft essays from a prompt using your profile." },
  { id: "plan", label: "Course plan", Icon: BookIcon, blurb: "A year-by-year high school course plan for the college you're aiming for." },
] as const;

const GRADE_FILTERS: { id: ChecklistGrade | "all"; label: string }[] = [
  { id: "all", label: "All grades" },
  { id: "9", label: "9th" },
  { id: "10", label: "10th" },
  { id: "11", label: "11th" },
  { id: "12", label: "12th" },
  { id: "gap", label: "Gap year" },
  { id: "transfer", label: "Transfer" },
];

const PHASE_LABEL: Record<ChecklistPhase, string> = {
  building: "Building your plan",
  applying: "Applying",
  submitted: "Submitted",
  decisions: "Decisions",
};

const STATUS_LABEL: Record<TargetCollege["status"], string> = {
  researching: "Researching",
  applying: "Applying",
  submitted: "Submitted",
  accepted: "Accepted",
  waitlisted: "Waitlisted",
  denied: "Denied",
};

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
          {tab.id === "essays" && <EssayTab onAsk={onAsk} />}
          {tab.id === "plan" && <CoursePlanTab onAsk={onAsk} />}
        </div>
      </div>
    </div>
  );
}

function ReadinessTab({ onAsk }: { onAsk: (text: string) => void }) {
  const { profile, update } = useProfile();
  const userGrade = normalizeGrade(profile.basics.gradeLevel);
  const [gradeFilter, setGradeFilter] = useState<ChecklistGrade | "all">(userGrade || "all");
  const [openId, setOpenId] = useState<string | null>(null);

  const checklist = useMemo(() => planningChecklist(profile, gradeFilter), [profile, gradeFilter]);
  const byPhase = (Object.keys(PHASE_LABEL) as ChecklistPhase[])
    .map((phase) => ({ phase, items: checklist.filter((i) => i.phase === phase) }))
    .filter((g) => g.items.length > 0);

  const statusCounts = {
    building: profile.colleges.filter((c) => c.status === "researching" || c.status === "applying").length,
    submitted: profile.colleges.filter((c) => c.status === "submitted").length,
    decisions: profile.colleges.filter((c) => ["accepted", "waitlisted", "denied"].includes(c.status)).length,
  };

  const toggleDone = (item: ChecklistItem) =>
    update((p) => ({
      ...p,
      checklistDone: { ...p.checklistDone, [item.id]: !item.done },
    }));

  return (
    <>
      <div className="two-col readiness-top">
        <section className="card readiness-status">
          <header className="card-head">
            <h2>List status</h2>
            <p>How your applications are moving</p>
          </header>
          <ul className="status-stack">
            <li>
              <strong>{statusCounts.building}</strong>
              <span>In progress</span>
            </li>
            <li>
              <strong>{statusCounts.submitted}</strong>
              <span>Submitted</span>
            </li>
            <li>
              <strong>{statusCounts.decisions}</strong>
              <span>Decisions</span>
            </li>
          </ul>
        </section>

        <section className="card readiness-colleges">
          <header className="card-head row-head">
            <div>
              <h2>My college list</h2>
              <p>Schools from Explore or Profile</p>
            </div>
            <a className="card-link" href={href("explore")}>
              Explore <ArrowRightIcon width={14} height={14} />
            </a>
          </header>
          <div className="readiness-colleges-scroll">
            {profile.colleges.length === 0 ? (
              <p className="list-empty">
                Nothing here yet. <a href={href("explore")}>Add colleges from Explore</a> or{" "}
                <a href={href("profile", "colleges")}>edit your list in Profile</a>.
              </p>
            ) : (
              <ul className="insight-college-list">
                {profile.colleges.map((college) => (
                  <li key={college.id}>
                    <div>
                      <strong>{college.name}</strong>
                      <span className="muted">{[college.plan, college.deadline].filter(Boolean).join(" · ") || "No deadline set"}</span>
                    </div>
                    <span className={`status-pill s-${college.status}`}>{STATUS_LABEL[college.status]}</span>
                    <button className="link-btn" onClick={() => onAsk(`What should I know about applying to ${college.name}?`)}>
                      <ChatIcon width={13} height={13} /> Ask
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <section className="card checklist-page">
        <header className="card-head">
          <h2>Checklist</h2>
          <p>
            Same plan for everyone — filter by grade to see what's most timely.
            {userGrade
              ? ` You're marked as ${GRADE_FILTERS.find((g) => g.id === userGrade)?.label ?? userGrade}.`
              : " Add your grade in Profile to highlight your year."}
          </p>
        </header>

        <div className="region-chips checklist-grades" role="tablist" aria-label="Grade filter">
          {GRADE_FILTERS.map((g) => (
            <button key={g.id} role="tab" aria-selected={gradeFilter === g.id} className={gradeFilter === g.id ? "on" : ""} onClick={() => setGradeFilter(g.id)}>
              {g.label}
            </button>
          ))}
        </div>

        {byPhase.map(({ phase, items }) => (
          <div key={phase} className="checklist-phase">
            <h3 className="checklist-phase-title">{PHASE_LABEL[phase]}</h3>
            <ul className="checklist readiness-checklist">
              {items.map((item) => {
                const open = openId === item.id;
                return (
                  <li key={item.id} className={`${item.done ? "done" : ""} ${open ? "open" : ""}`}>
                    <div className="checklist-row">
                      <button
                        type="button"
                        className="check-btn"
                        onClick={() => toggleDone(item)}
                        aria-pressed={item.done}
                        aria-label={item.done ? `Mark incomplete: ${item.label}` : `Mark done: ${item.label}`}
                      >
                        <span className="check">{item.done && <CheckIcon width={13} height={13} />}</span>
                      </button>
                      <button type="button" className="checklist-main" onClick={() => setOpenId(open ? null : item.id)} aria-expanded={open}>
                        <span className="checklist-label">
                          {item.label}
                          {item.relevant && gradeFilter === "all" && userGrade && <span className="tag soft">For your grade</span>}
                        </span>
                        {(item.detail || item.section) && <ChevronIcon width={16} height={16} className={`checklist-chevron ${open ? "up" : ""}`} />}
                      </button>
                    </div>
                    {open && (
                      <div className="checklist-detail">
                        {item.detail?.kind === "counselor" && (
                          <>
                            <h4>{item.detail.title}</h4>
                            <ul className="detail-list">
                              {item.detail.body?.map((line) =>
                                line === "" ? (
                                  <li key="gap" className="detail-gap" />
                                ) : line.endsWith(":") ? (
                                  <li key={line} className="detail-heading">
                                    {line}
                                  </li>
                                ) : (
                                  <li key={line}>{line.replace(/^•\s*/, "")}</li>
                                ),
                              )}
                            </ul>
                          </>
                        )}
                        {item.detail?.kind === "videos" && (
                          <>
                            <h4>{item.detail.title}</h4>
                            {item.detail.body?.map((line) => (
                              <p key={line}>{line}</p>
                            ))}
                            <ul className="video-list">
                              {item.detail.videos?.map((video) => (
                                <li key={video.url}>
                                  <a href={video.url} target="_blank" rel="noreferrer">
                                    {video.title} <ExternalIcon width={12} height={12} />
                                  </a>
                                  <span className="muted">{video.channel}</span>
                                </li>
                              ))}
                            </ul>
                            <a className="card-link" href={href("insights", "essays")}>
                              Open essay coach
                            </a>
                          </>
                        )}
                        {item.detail?.kind === "tips" && (
                          <>
                            <h4>{item.detail.title}</h4>
                            {item.detail.body?.map((line) => (
                              <p key={line}>{line}</p>
                            ))}
                          </>
                        )}
                        {item.section && (
                          <a className="card-link" href={href("profile", item.section)}>
                            Open in profile
                          </a>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </>
  );
}
