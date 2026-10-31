import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { COLLEGES } from "../colleges";
import { usePlanning } from "../planning";
import { academicHistoryStatus, completeness, useProfile } from "../profile";
import { navigate } from "../router";
import { readJSON, userKey, writeJSON } from "../storage";
import type { PiqStatus, Profile, UcJourneyState } from "../types";
import { ArrowRightIcon, CheckIcon, ExternalIcon, PixelMapIcon, XIcon } from "../components/icons";
import {
  ACTIVITY_DESC_LIMIT,
  computeJourney,
  FOLLOW_UPS,
  journeyOf,
  PIQ_PROMPTS,
  PIQ_REQUIRED,
  PIQ_WORD_LIMIT,
  REVIEW_MANUAL,
  setCampusMajor,
  setPiqStatus,
  toggleCampus,
  togglePiq,
  UC_APPLY_URL,
  type Checkpoint,
  type CheckpointId,
} from "./logic";
import { mentorById } from "../game/characters";
import { STAGE_GUIDE } from "./guides";
import { CONSTELLATIONS, fitConstellation, trailLegs } from "./constellation";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** How long the "stage completed" trail draw and platform glow last. */
const ARRIVE_MS = 1400;


/** Size of an element's content box, kept current with a ResizeObserver. */
function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function JourneyMap({
  userId,
  onBack,
  embedded = false,
  selected = null,
  onSelect,
}: {
  userId: string;
  onBack?: () => void;
  /** Story-mode side panel: same map and progress, no full-page chrome. */
  embedded?: boolean;
  /** The stop whose person the student chose to talk to (Story mode), shown as selected. */
  selected?: CheckpointId | null;
  /** Story mode: clicking a stop switches the chat on the right to that stop's person. */
  onSelect?: (id: CheckpointId) => void;
}) {
  const { profile, update } = useProfile();
  const { transcripts } = usePlanning();
  const sections = completeness(profile).sections;
  const academicStarted = academicHistoryStatus(profile, transcripts).started;
  const journey = useMemo(() => computeJourney(profile, sections, academicStarted), [profile, sections, academicStarted]);
  const { checkpoints, completeCount, current, finished } = journey;
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  // When a stage is completed since the student last looked, draw the new stretch of trail and
  // let the next platform glow briefly. Progress itself always comes from computeJourney.
  const seenKey = userKey(userId, "ucMapSeen");
  const reached = finished ? checkpoints.length : current;
  const [arrived, setArrived] = useState<{ from: number; to: number } | null>(null);
  const lastSeen = useRef(Math.min(readJSON(seenKey, reached), reached));
  useEffect(() => {
    writeJSON(seenKey, reached);
    const from = lastSeen.current;
    lastSeen.current = reached;
    if (reached <= from || reducedMotion()) return;
    setArrived({ from, to: reached });
    const done = window.setTimeout(() => setArrived(null), ARRIVE_MS);
    return () => window.clearTimeout(done);
  }, [reached, seenKey]);

  // The constellation is drawn in a fixed design space and scaled to fit this box.
  const [fitRef, box] = useBoxSize<HTMLDivElement>();
  const { layout, scale } = fitConstellation(box.width, embedded ? box.height : 0);
  const geo = CONSTELLATIONS[layout];
  const legs = useMemo(() => trailLegs(geo), [geo]);

  // The rocket parks beside the current stop, nose toward the next one (pointing up once done).
  const rocket = useMemo(() => {
    const at = Math.min(finished ? checkpoints.length - 1 : current, geo.stops.length - 1);
    const here = geo.stops[at];
    const next = geo.stops[at + 1];
    if (finished || !next) return { x: here.x * scale, y: here.y * scale - 34, angle: -90 };
    const dx = (next.x - here.x) * scale;
    const dy = (next.y - here.y) * scale;
    const len = Math.hypot(dx, dy) || 1;
    const gap = 38; // clear of the planet and its halo
    return { x: here.x * scale + (dx / len) * gap, y: here.y * scale + (dy / len) * gap, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
  }, [geo, scale, current, finished, checkpoints.length]);

  const setJourney = useCallback((change: (j: UcJourneyState) => UcJourneyState) => update((p) => ({ ...p, ucJourney: change(journeyOf(p)) })), [update]);

  const close = useCallback(() => {
    setOpen(null);
    opener.current?.focus();
  }, []);

  const openChapter = (i: number, from: HTMLButtonElement) => {
    opener.current = from;
    setOpen(i);
  };

  const progress = (
    <div className="jm-overall" aria-live="polite">
      <strong>{completeCount} of 5 checkpoints complete</strong>
      <span className="jm-bar" aria-hidden="true">
        <span style={{ width: `${(completeCount / 5) * 100}%` }} />
      </span>
    </div>
  );

  const mapBoard = (
    <div className={`jm-sky-fit jm-sky-${layout}`} ref={fitRef}>
      {box.width > 0 && (
        <div className="jm-sky" style={{ width: geo.w * scale, height: geo.h * scale }}>
          <svg className="jm-trail" viewBox={`0 0 ${geo.w} ${geo.h}`} aria-hidden="true">
            {legs.map((d, i) => (
              <path key={`base-${i}`} d={d} className="jm-trail-base" />
            ))}
            {legs.map((d, i) =>
              i < reached ? (
                <path
                  key={`lit-${i}`}
                  d={d}
                  pathLength={1}
                  className={`jm-trail-lit${arrived && i >= arrived.from && i < arrived.to ? " is-drawing" : ""}`}
                />
              ) : null,
            )}
          </svg>

          <div
            className="jm-rocket"
            style={{ transform: `translate(${rocket.x}px, ${rocket.y}px) rotate(${rocket.angle}deg)` }}
            aria-hidden="true"
          >
            <Rocket />
          </div>

          <ol className="jm-stops" aria-label="Checkpoints">
            {checkpoints.map((c, i) => {
              const state = c.complete ? "complete" : i === current && !finished ? "current" : "upcoming";
              const stop = geo.stops[i];
              const person = mentorById(STAGE_GUIDE[c.id]);
              const isSelected = selected === c.id;
              const arriving = !!arrived && i === arrived.to && !finished;
              const status = state === "complete" ? "Complete" : state === "current" ? "You are here" : "Coming up";
              // Cards open away from the nearer edge so they stay inside the map.
              const cardBelow = stop.y < geo.h / 2;
              return (
                <li
                  key={c.id}
                  className={`jm-stop jm-stop-${state}${isSelected ? " is-selected" : ""}${arriving ? " is-arriving" : ""}`}
                  style={{ left: stop.x * scale, top: stop.y * scale, animationDelay: `${i * -1.3}s` }}
                >
                  <button
                    type="button"
                    className="jm-planet-btn"
                    onClick={(e) => (onSelect ? onSelect(c.id) : openChapter(i, e.currentTarget))}
                    aria-pressed={onSelect ? isSelected : undefined}
                    aria-label={`${c.title}, chapter ${i + 1}: ${status}. ${onSelect ? `Talk to ${person.name}.` : "Open chapter."}`}
                  >
                    <Planet id={c.id} />
                    {state === "complete" && (
                      <span className="jm-stop-check" aria-hidden="true">
                        <CheckIcon width={10} height={10} />
                      </span>
                    )}
                  </button>
                  <div className={`jm-stop-card${cardBelow ? " is-below" : ""}`}>
                    <span className="jm-stop-title">{c.title}</span>
                    <span className={`jm-stop-status jm-stop-status-${state}`}>
                      {status} · {person.name}
                    </span>
                    {onSelect && (
                      <button type="button" className="jm-stop-open" onClick={(e) => openChapter(i, e.currentTarget)}>
                        Open chapter
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );

  return (
    <div className={`jm${embedded ? " jm-embedded" : ""}`}>
      {!embedded && (
        <header className="jm-top">
          <button className="btn-ghost jm-back" onClick={onBack}>
            <ArrowRightIcon width={16} height={16} style={{ transform: "rotate(180deg)" }} />
            Back
          </button>
          <div className="jm-title">
            <h1>UC Journey Map</h1>
            <p>Your University of California application, one stop at a time.</p>
          </div>
          {progress}
        </header>
      )}

      <div className="jm-scroll">
        {mapBoard}
        {finished && <p className="jm-finished">🎓 You've recorded your UC application as submitted. Keep an eye on your follow-ups in Review &amp; Apply.</p>}
      </div>

      {/* Portaled to <body> so it sits above everything; inside Story mode the map lives in a stacking context below the mode switch, which covered the close button. */}
      {open !== null &&
        createPortal(
          <CheckpointPanel
            checkpoint={checkpoints[open]}
            index={open}
            state={checkpoints[open].complete ? "Complete" : open === current ? "Current" : "Upcoming"}
            profile={profile}
            update={update}
            setJourney={setJourney}
            onClose={close}
          />,
          document.body,
        )}
    </div>
  );
}

/** The "you are here" rocket, drawn pointing right (rotated to face the next stop). */
function Rocket() {
  return (
    <svg viewBox="0 0 36 20" className="jm-rocket-art">
      <path d="M4 10 0.5 7.6 1.8 10 0.5 12.4z" className="jm-rocket-flame" />
      <path d="M9 6.2 5 2.5h4.6l3.4 3.7zM9 13.8 5 17.5h4.6l3.4-3.7z" className="jm-rocket-fin" />
      <path d="M6 10c0-2.9 2.2-4.6 6-4.6h11c4.4 0 8.6 1.9 11.5 4.6-2.9 2.7-7.1 4.6-11.5 4.6H12c-3.8 0-6-1.7-6-4.6z" className="jm-rocket-body" />
      <circle cx="22" cy="10" r="2.4" className="jm-rocket-window" />
      <path d="M29.5 7.2c1.8.7 3.5 1.7 5 2.8-1.5 1.1-3.2 2.1-5 2.8z" className="jm-rocket-nose" />
    </svg>
  );
}

/** A small planet per chapter, each with its own surface detail or symbol. Solid colours only. */
function Planet({ id }: { id: CheckpointId }) {
  switch (id) {
    case "profile": // sage world with a tilted ring
      return (
        <svg viewBox="0 0 44 44" className="jm-planet" aria-hidden="true">
          <ellipse cx="22" cy="22" rx="20" ry="6" transform="rotate(-18 22 22)" className="jm-ring-back" />
          <circle cx="22" cy="22" r="13" className="jm-p-profile" />
          <circle cx="22" cy="19.5" r="3" className="jm-p-glyph" />
          <path d="M16.6 28.2c1-3 3-4.4 5.4-4.4s4.4 1.4 5.4 4.4" className="jm-p-glyph-line" />
          <path d="M2.4 27.6A20 6 -18 0 0 41.6 16.4" transform="rotate(0)" className="jm-ring-front" />
        </svg>
      );
    case "ucs": // sand world with campus columns
      return (
        <svg viewBox="0 0 44 44" className="jm-planet" aria-hidden="true">
          <circle cx="22" cy="22" r="14" className="jm-p-ucs" />
          <path d="M15.5 19.5 22 15.5l6.5 4z" className="jm-p-glyph" />
          <path d="M17 20.5v6M20.3 20.5v6M23.7 20.5v6M27 20.5v6M15.5 27.5h13" className="jm-p-glyph-line" />
        </svg>
      );
    case "activities": // charcoal world with gold craters
      return (
        <svg viewBox="0 0 44 44" className="jm-planet" aria-hidden="true">
          <circle cx="22" cy="22" r="14" className="jm-p-activities" />
          <circle cx="17.5" cy="18.5" r="2.4" className="jm-p-crater" />
          <circle cx="26" cy="24.5" r="3.1" className="jm-p-crater" />
          <circle cx="19.5" cy="27.5" r="1.4" className="jm-p-crater" />
          <circle cx="27.5" cy="16.5" r="1.1" className="jm-p-crater" />
        </svg>
      );
    case "essays": // cream world with bands and a pen nib
      return (
        <svg viewBox="0 0 44 44" className="jm-planet" aria-hidden="true">
          <circle cx="22" cy="22" r="14" className="jm-p-essays" />
          <path d="M9.2 18h25.6M8.6 26h26.8" className="jm-p-band" />
          <path d="M22 15.5l3.4 6.2L22 29l-3.4-7.3z" className="jm-p-glyph" />
          <path d="M22 21.5v4" className="jm-p-nib" />
        </svg>
      );
    case "review": // muted-gold world with a double ring and a star
      return (
        <svg viewBox="0 0 44 44" className="jm-planet" aria-hidden="true">
          <circle cx="22" cy="22" r="19" className="jm-p-orbit" />
          <circle cx="22" cy="22" r="13.5" className="jm-p-review" />
          <path d="m22 15.6 1.9 4.1 4.4.5-3.3 3 .9 4.4-3.9-2.2-3.9 2.2.9-4.4-3.3-3 4.4-.5z" className="jm-p-glyph" />
        </svg>
      );
  }
}

interface PanelProps {
  checkpoint: Checkpoint;
  index: number;
  state: string;
  profile: Profile;
  update: (change: (p: Profile) => Profile) => void;
  setJourney: (change: (j: UcJourneyState) => UcJourneyState) => void;
  onClose: () => void;
}

function CheckpointPanel({ checkpoint: c, index, state, profile, update, setJourney, onClose }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const headingId = `jm-panel-${c.id}`;

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [c.id]);

  // Esc closes; Tab stays inside the dialog.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex='0']")].filter(
      (el) => !el.hasAttribute("disabled"),
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current.querySelector("h2"))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const go = (route: Parameters<typeof navigate>[0], param?: string) => navigate(route, param);
  const j = journeyOf(profile);

  return (
    <div className="jm-panel-wrap" onKeyDown={onKeyDown}>
      <button className="jm-scrim" onClick={onClose} tabIndex={-1} aria-label="Close checkpoint" />
      <div className="jm-panel" role="dialog" aria-modal="true" aria-labelledby={headingId} ref={ref}>
        <header className="jm-panel-head">
          <div>
            <span className="jm-panel-kicker">
              Checkpoint {index + 1} · {state}
            </span>
            <h2 id={headingId} tabIndex={-1}>
              {c.title}
            </h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <XIcon width={16} height={16} />
          </button>
        </header>

        <div className="jm-panel-body">
          <div className="jm-progress">
            <span>{c.summary}</span>
            <span className="jm-bar" aria-hidden="true">
              <span style={{ width: `${(c.done / c.total) * 100}%` }} />
            </span>
          </div>

          <ul className="jm-tasks">
            {/* Review's manual ticks are interactive below, so they aren't repeated here. */}
            {c.tasks
              .filter((t) => c.id !== "review" || !REVIEW_MANUAL.some((m) => m.id === t.id))
              .map((t) => (
                <li key={t.id} className={t.done ? "done" : ""}>
                  <span className="jm-check" aria-hidden="true">
                    {t.done ? <CheckIcon width={13} height={13} /> : null}
                  </span>
                  <span>
                    <span className="jm-task-label">
                      {t.label}
                      {t.optional && <em> (optional)</em>}
                      <span className="jm-sr">{t.done ? " — done" : " — not done"}</span>
                    </span>
                    {t.detail && <span className="jm-task-detail">{t.detail}</span>}
                  </span>
                </li>
              ))}
          </ul>

          {c.id === "profile" && (
            <>
              <p className="jm-note">Progress comes straight from your saved profile.</p>
              <button className="btn-primary jm-cta" onClick={() => go("profile", ["basics", "academics"].find((_, i) => !c.tasks[i].done) ?? "basics")}>
                Open your profile <ArrowRightIcon width={15} height={15} />
              </button>
            </>
          )}

          {c.id === "ucs" && <CampusPicker profile={profile} update={update} />}

          {c.id === "activities" && (
            <>
              <div className="jm-tip">
                <strong>Writing each description</strong>
                <span>
                  Say what your responsibilities were, what you contributed, and the impact you had: numbers, outcomes, who benefited. Keep it under{" "}
                  {ACTIVITY_DESC_LIMIT} characters.
                </span>
              </div>
              {profile.activities.length > 0 && (
                <ul className="jm-mini-list">
                  {profile.activities.map((a) => {
                    const len = a.description.length;
                    const issue =
                      !a.role.trim() || !a.hoursPerWeek.trim()
                        ? "Add role and hours"
                        : !a.description.trim()
                          ? "Add a description"
                          : len > ACTIVITY_DESC_LIMIT
                            ? `${len - ACTIVITY_DESC_LIMIT} characters over`
                            : null;
                    return (
                      <li key={a.id}>
                        <span>{a.name || "Untitled activity"}</span>
                        <span className={issue ? "jm-warn" : "jm-ok"}>{issue ?? `${len}/${ACTIVITY_DESC_LIMIT}`}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <button className="btn-primary jm-cta" onClick={() => go("profile", "activities")}>
                Edit activities &amp; awards <ArrowRightIcon width={15} height={15} />
              </button>
            </>
          )}

          {c.id === "essays" && <PiqPicker journey={j} setJourney={setJourney} onOpenTool={() => go("profile", "essays")} />}

          {c.id === "review" && <ReviewPanel journey={j} setJourney={setJourney} />}
        </div>
      </div>
    </div>
  );
}

function CampusPicker({ profile, update }: { profile: Profile; update: PanelProps["update"] }) {
  const listId = "jm-majors";
  return (
    <div className="jm-campuses">
      <p className="jm-note">Pick the campuses you'll apply to and your intended major at each. These save to your college list.</p>
      <datalist id={listId}>
        {profile.goals.majors.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <ul>
        {COLLEGES.map((college) => {
          const saved = profile.colleges.find((c) => c.name.toLowerCase() === college.name.toLowerCase());
          return (
            <li key={college.name} className={saved ? "on" : ""}>
              <label className="jm-campus-toggle">
                <input type="checkbox" checked={!!saved} onChange={() => update((p) => toggleCampus(p, college.name, () => crypto.randomUUID()))} />
                <span>
                  {college.name} <small>{college.city}</small>
                </span>
              </label>
              <a
                href={`https://www.${college.website}`}
                target="_blank"
                rel="noreferrer noopener"
                className="jm-ext"
                aria-label={`${college.name} website (opens in new tab)`}
              >
                <ExternalIcon width={13} height={13} />
              </a>
              {saved && (
                <input
                  className="jm-input"
                  list={listId}
                  value={saved.major ?? ""}
                  placeholder="Intended major"
                  aria-label={`Intended major at ${college.name}`}
                  onChange={(e) => update((p) => setCampusMajor(p, college.name, e.target.value))}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const STATUSES: { id: PiqStatus; label: string }[] = [
  { id: "not-started", label: "Not started" },
  { id: "drafting", label: "Drafting" },
  { id: "ready", label: "Ready" },
];

function PiqPicker({ journey, setJourney, onOpenTool }: { journey: UcJourneyState; setJourney: PanelProps["setJourney"]; onOpenTool: () => void }) {
  const chosen = Object.keys(journey.piqs);
  const full = chosen.length >= PIQ_REQUIRED;
  return (
    <div className="jm-piqs">
      <p className="jm-note">
        UC asks for <strong>four</strong> Personal Insight Question responses out of eight, up to {PIQ_WORD_LIMIT} words each. The same four go to every campus.{" "}
        {chosen.length}/4 chosen.
      </p>
      <ul>
        {PIQ_PROMPTS.map((q, i) => {
          const status = journey.piqs[q.id];
          const on = status !== undefined;
          return (
            <li key={q.id} className={on ? "on" : ""}>
              <label className="jm-piq-toggle">
                <input type="checkbox" checked={on} disabled={!on && full} onChange={() => setJourney((j) => togglePiq(j, q.id))} />
                <span>
                  <strong>
                    {i + 1}. {q.title}
                  </strong>
                  <small>{q.prompt}</small>
                </span>
              </label>
              {on && (
                <div className="jm-seg" role="radiogroup" aria-label={`${q.title} status`}>
                  {STATUSES.map((s) => (
                    <button
                      key={s.id}
                      role="radio"
                      aria-checked={status === s.id}
                      className={status === s.id ? "on" : ""}
                      onClick={() => setJourney((j) => setPiqStatus(j, q.id, s.id))}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <button className="btn-primary jm-cta" onClick={onOpenTool}>
        Open the essay tool <ArrowRightIcon width={15} height={15} />
      </button>
    </div>
  );
}

function ReviewPanel({ journey, setJourney }: { journey: UcJourneyState; setJourney: PanelProps["setJourney"] }) {
  const [confirming, setConfirming] = useState(false);
  const submitted = journey.submittedAt !== null;
  return (
    <div className="jm-review">
      <h3 className="jm-h3">Before you submit</h3>
      <ul className="jm-manual">
        {REVIEW_MANUAL.map((m) => (
          <li key={m.id}>
            <label>
              <input
                type="checkbox"
                checked={!!journey.checks[m.id]}
                onChange={(e) =>
                  setJourney((j) => ({
                    ...j,
                    checks: { ...j.checks, [m.id]: e.target.checked },
                  }))
                }
              />
              <span>
                {m.label}
                <small>{m.detail}</small>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="jm-tip">
        <strong>Financial aid is separate</strong>
        <span>The UC application doesn't apply you for aid. File the FAFSA or the California Dream Act Application too.</span>
      </div>

      <a className="btn-primary jm-cta" href={UC_APPLY_URL} target="_blank" rel="noreferrer noopener">
        Open the official UC application <ExternalIcon width={14} height={14} />
      </a>

      <h3 className="jm-h3">Submission</h3>
      {submitted ? (
        <>
          <p className="jm-submitted">
            <CheckIcon width={15} height={15} /> You recorded submitting on {new Date(journey.submittedAt!).toLocaleDateString()}.{" "}
            <button className="jm-link" onClick={() => setJourney((j) => ({ ...j, submittedAt: null }))}>
              Undo
            </button>
          </p>
          <h3 className="jm-h3">Follow-ups</h3>
          <ul className="jm-manual">
            {FOLLOW_UPS.map((f) => (
              <li key={f.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={!!journey.followUps[f.id]}
                    onChange={(e) =>
                      setJourney((j) => ({
                        ...j,
                        followUps: { ...j.followUps, [f.id]: e.target.checked },
                      }))
                    }
                  />
                  <span>{f.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      ) : confirming ? (
        <div className="jm-confirm">
          <p>Only confirm once you've submitted on the official UC site. This doesn't submit anything for you.</p>
          <button
            className="btn-primary"
            onClick={() => {
              setJourney((j) => ({ ...j, submittedAt: Date.now() }));
              setConfirming(false);
            }}
          >
            Yes, I submitted
          </button>
          <button className="btn-ghost" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <p className="jm-note">Finishing this checklist doesn't mark your application submitted. Record it yourself once it's done.</p>
          <button className="btn-ghost" onClick={() => setConfirming(true)}>
            I submitted my UC application…
          </button>
        </>
      )}
    </div>
  );
}

/** Header entry point used across the signed-in app. */
export function MapButton({ active = false }: { active?: boolean }) {
  return (
    <a className={`map-btn${active ? " on" : ""}`} href="#/map" aria-label="UC Journey Map" aria-current={active ? "page" : undefined}>
      <PixelMapIcon />
      <span>Map</span>
    </a>
  );
}
