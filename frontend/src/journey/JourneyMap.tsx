import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
import { GRID, mapLayout, planetPixels, routeLegs } from "./planets";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** How long the "stage completed" route draw lasts. */
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

/** Short map labels, in journey order. */
const MAP_LABEL: Record<CheckpointId, string> = {
  profile: "Basic info",
  ucs: "Choose UCs",
  activities: "Activities list",
  essays: "Four essays",
  review: "Review & apply",
  aid: "Financial aid",
};

/** Each chapter's campus building (pixel art), computed once. */
const ART = Object.fromEntries((Object.keys(MAP_LABEL) as CheckpointId[]).map((id) => [id, planetPixels(id)])) as Record<
  CheckpointId,
  ReturnType<typeof planetPixels>
>;

type Pt = { x: number; y: number };

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

  // When a stage is completed since the student last looked, draw the new stretch of route.
  // Progress itself always comes from computeJourney.
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

  // Story mode always shows whose chat is open: the clicked stop, else the current chapter's.
  const active = onSelect ? (selected ?? checkpoints[finished ? checkpoints.length - 1 : current].id) : null;

  // Wide: six campus buildings in a straight line from the start pad on the left to the flag
  // on the right. Narrow: a vertical list with labels beside each building.
  const [fitRef, box] = useBoxSize<HTMLDivElement>();
  const layout = mapLayout(box.width);
  const planet = layout === "tall" ? 72 : box.width >= 640 ? 96 : box.width >= 480 ? 72 : 48;

  // The route runs through the buildings' measured centres, from the start pad to the flag.
  const skyRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<Pt[]>([]);
  useLayoutEffect(() => {
    const sky = skyRef.current;
    if (!sky) return;
    const origin = sky.getBoundingClientRect();
    const next = [...sky.querySelectorAll<HTMLElement>("[data-anchor]")].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2 - origin.left), y: Math.round(r.top + r.height / 2 - origin.top) };
    });
    setPoints((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [layout, planet, box.width, box.height]);
  const legs = useMemo(() => routeLegs(points), [points]);

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
      <strong>
        {completeCount} of {checkpoints.length} checkpoints complete
      </strong>
      <span className="jm-bar" aria-hidden="true">
        <span style={{ width: `${(completeCount / checkpoints.length) * 100}%` }} />
      </span>
    </div>
  );

  const mapBoard = (
    <div className="jm-sky-fit" data-layout={layout} ref={fitRef}>
      {box.width > 0 && (
        <span className="jm-stars" aria-hidden="true">
          {DETAILS.map(([left, top, kind], i) => (
            <span key={i} data-kind={kind} style={{ left: `${left}%`, top: `${top}%`, "--px": `${planet / GRID}px` } as CSSProperties}>
              <PixelArt rows={DETAIL_ART[kind]} fill={DETAIL_FILL[kind]} />
            </span>
          ))}
        </span>
      )}
      {box.width > 0 && (
        <div
          className="jm-sky"
          ref={skyRef}
          style={{ "--planet": `${planet}px`, "--px": `${planet / GRID}px` } as CSSProperties}
        >
          <svg className="jm-route" aria-hidden="true">
            {/* Leg i runs from building i to building i + 1; Basic info is the start. */}
            {legs.map((d, i) => (
              <path key={`base-${i}`} d={d} className="jm-route-base" />
            ))}
            {legs.map((d, i) =>
              i < reached ? (
                <path
                  key={`lit-${i}`}
                  d={d}
                  pathLength={1}
                  className={`jm-route-lit${arrived && i >= arrived.from && i < arrived.to ? " is-drawing" : ""}`}
                />
              ) : null,
            )}
          </svg>

          <ol className="jm-stops" aria-label="Checkpoints">
            {checkpoints.map((c, i) => {
              const state = c.complete ? "complete" : i === current && !finished ? "current" : "upcoming";
              const person = mentorById(STAGE_GUIDE[c.id]);
              const isActive = active === c.id;
              const status = state === "complete" ? "Done" : state === "current" ? "You're here" : i === current + 1 ? "Up next" : "Later";
              return (
                <li
                  key={c.id}
                  className={`jm-stop jm-stop-${state}${isActive ? " is-selected" : ""}`}
                >
                  <button
                    type="button"
                    className="jm-planet-btn"
                    onClick={(e) => (onSelect ? onSelect(c.id) : openChapter(i, e.currentTarget))}
                    aria-pressed={onSelect ? isActive : undefined}
                    aria-label={`${MAP_LABEL[c.id]}, chapter ${i + 1}: ${status}. ${onSelect ? `Talk to ${person.name}.` : "Open chapter."}`}
                  >
                    <span className="jm-orbit" aria-hidden="true" />
                    <span className="jm-planet-art" data-anchor>
                      <svg viewBox={`0 0 ${GRID} ${GRID}`} shapeRendering="crispEdges" className="jm-planet" aria-hidden="true">
                        {ART[c.id].map((r) => (
                          <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
                        ))}
                      </svg>
                    </span>
                    {state === "current" && (
                      <span className="jm-here" aria-hidden="true">
                        <PixelArt rows={HERE_MARK} fill="var(--cn-gold)" />
                      </span>
                    )}
                    {state === "complete" && (
                      <span className="jm-done-badge" aria-hidden="true">
                        <PixelArt rows={CHECK_BADGE} />
                      </span>
                    )}
                  </button>
                  <span className="jm-label">
                    <strong aria-hidden="true">{MAP_LABEL[c.id]}</strong>
                    <small aria-hidden="true">
                      <span>{status}</span>
                      <span className="jm-label-sep"> · </span>
                      <span>{person.name}</span>
                    </small>
                    {/* Story mode: the selected chapter offers its full to-do list. */}
                    {onSelect && isActive && (
                      <button type="button" className="jm-explore" onClick={(e) => openChapter(i, e.currentTarget)}>
                        See tasks
                        <span className="jm-sr"> for {MAP_LABEL[c.id]}</span>
                        <ArrowRightIcon width={12} height={12} aria-hidden="true" />
                      </button>
                    )}
                  </span>
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
        {finished && (
          <p className="jm-finished">
            You've submitted your UC application and your financial aid application. Keep an eye on your follow-ups in Review &amp; Apply.
          </p>
        )}
      </div>

      {/* Portaled to <body> so it sits above everything, including Story mode's stacking contexts. */}
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

/** Small pixel sprites: "#" is outline ink, "o" the fill colour, "g" green, "w" cream. */
const HERE_MARK = ["#######", "#ooooo#", ".#ooo#.", "..#o#..", "...#..."];
/** Background details: faint sparkles in the sky band, grass tufts along the bottom. */
/** Background details: barely-there leaves, book outlines, and tiny sparkles near the edges. */
const DETAIL_ART = {
  sparkle: [".o.", "ooo", ".o."],
  dot: ["o"],
  leaf: ["..oo", ".ooo", "ooo.", "o..."],
  book: [".oo.oo.", "o..o..o", "o..o..o", "ooooooo"],
};
const DETAIL_FILL: Record<keyof typeof DETAIL_ART, string> = {
  sparkle: "var(--cn-gold)",
  dot: "var(--cn-gold)",
  leaf: "var(--cn-sage-deep)",
  book: "var(--cn-route-deep)",
};
/** Positions (% of the map box), kept to the corners and edges, clear of the buildings and labels. */
const DETAILS: [number, number, keyof typeof DETAIL_ART][] = [
  [3, 7, "leaf"],
  [17, 5, "dot"],
  [41, 8, "sparkle"],
  [66, 5, "book"],
  [93, 9, "dot"],
  [2, 94, "book"],
  [31, 94, "sparkle"],
  [73, 93, "leaf"],
  [95, 86, "dot"],
];
const CHECK_BADGE = ["#######", "#ggggg#", "#ggggw#", "#gggwg#", "#wgwgg#", "#gwggg#", "#######"];

function PixelArt({ rows, fill = "var(--cn-sage-deep)" }: { rows: string[]; fill?: string }) {
  const colour: Record<string, string> = { "#": "#232a3a", o: fill, g: "#3f7a55", w: "#fbf6e8" };
  return (
    <svg viewBox={`0 0 ${rows[0].length} ${rows.length}`} shapeRendering="crispEdges" style={{ width: `calc(var(--px) * ${rows[0].length})` }}>
      {rows.flatMap((row, y) =>
        [...row].map((ch, x) => (colour[ch] ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={colour[ch]} /> : null)),
      )}
    </svg>
  );
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
