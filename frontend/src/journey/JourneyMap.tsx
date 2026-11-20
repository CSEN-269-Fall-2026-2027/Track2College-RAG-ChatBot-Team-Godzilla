import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePlanning } from "../planning";
import { academicHistoryStatus, completeness, useProfile } from "../profile";
import { readJSON, userKey, writeJSON } from "../storage";
import type { Profile, UcJourneyState } from "../types";
import { CheckIcon } from "../components/icons";
import { computeJourney, journeyOf, type Checkpoint, type CheckpointId } from "./logic";
import { daysUntilUcDeadline, nextUcEntryYear } from "../agent/logic";
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
  counselor: "Counselor",
  apply: "Apply",
};

/** Each chapter's campus building (pixel art), computed once. */
const ART = Object.fromEntries((Object.keys(MAP_LABEL) as CheckpointId[]).map((id) => [id, planetPixels(id)])) as Record<
  CheckpointId,
  ReturnType<typeof planetPixels>
>;

type Pt = { x: number; y: number };

export function JourneyMap({ userId }: { userId: string }) {
  const { profile, update } = useProfile();
  const { transcripts } = usePlanning();
  const sections = completeness(profile).sections;
  const academicStarted = academicHistoryStatus(profile, transcripts).started;
  const journey = useMemo(() => computeJourney(profile, sections, academicStarted), [profile, sections, academicStarted]);
  const { checkpoints, current, finished } = journey;

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

  // Browsing a stop only changes the task list below — never switches the chat mentor.
  const defaultFocus = checkpoints[finished ? checkpoints.length - 1 : current]?.id ?? "profile";
  const [focusId, setFocusId] = useState<CheckpointId>(defaultFocus);
  useEffect(() => {
    setFocusId(defaultFocus);
  }, [defaultFocus]);
  const active = focusId;

  // Wide: six campus buildings in a straight line from the start pad on the left to the flag
  // on the right. Narrow: a vertical list with labels beside each building.
  const [fitRef, box] = useBoxSize<HTMLDivElement>();
  const layout = mapLayout(box.width);
  // Seven buildings in the wide row: shrink sooner so they never overflow their columns.
  const planet = layout === "tall" ? 72 : box.width >= 760 ? 96 : box.width >= 560 ? 72 : 48;

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

  const focusIndex = Math.max(0, checkpoints.findIndex((c) => c.id === active));
  const focusCheckpoint = checkpoints[focusIndex];

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

          {layout === "wide" && <DeadlineSign profile={profile} />}

          <ol className="jm-stops" aria-label="Checkpoints">
            {checkpoints.map((c, i) => {
              const state = c.complete ? "complete" : i === current && !finished ? "current" : "upcoming";
              const person = mentorById(STAGE_GUIDE[c.id]);
              const isActive = active === c.id;
              const status = state === "complete" ? "Done" : state === "current" ? "You're here" : "";
              return (
                <li
                  key={c.id}
                  className={`jm-stop jm-stop-${state}${isActive ? " is-selected" : active ? " is-unselected" : ""}`}
                >
                  <button
                    type="button"
                    className="jm-planet-btn"
                    onClick={() => setFocusId(c.id)}
                    aria-pressed={isActive}
                    aria-label={`${MAP_LABEL[c.id]}, chapter ${i + 1}${status ? `: ${status}` : ""}. Show tasks${person.name ? ` (${person.name})` : ""}.`}
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
                        <PixelArt rows={HERE_MARK} fill="var(--cn-here)" />
                      </span>
                    )}
                    {state === "complete" && (
                      <span className="jm-done-badge" aria-hidden="true">
                        <PixelArt rows={CHECK_BADGE} fill="#6b7280" />
                      </span>
                    )}
                  </button>
                  <span className="jm-label">
                    <strong aria-hidden="true">{MAP_LABEL[c.id]}</strong>
                    {state === "current" && (
                      <small aria-hidden="true">
                        <span>{status}</span>
                      </small>
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
    <div className="jm jm-embedded">
      <div className="jm-scroll">
        <div className="jm-board-split">
          <div className="jm-board-map">{mapBoard}</div>
          {focusCheckpoint && (
            <StageTasksPanel
              checkpoint={focusCheckpoint}
              profile={profile}
              setJourney={setJourney}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** A small sign over the map: days left until the UC deadline. */
function DeadlineSign({ profile }: { profile: Profile }) {
  const days = daysUntilUcDeadline(profile);
  return (
    <div className="jm-sign" role="note" aria-label={days < 0 ? "The UC application deadline has passed" : days === 0 ? "UC application due today" : `${days} days left to apply`}>
      <div className={`jm-sign-board${days <= 7 && days >= 0 ? " is-urgent" : ""}`} aria-hidden="true">
        <span className="jm-sign-head">UC app · Fall {nextUcEntryYear()}</span>
        <span className="jm-sign-count">
          {days > 0 ? (
            <>
              <strong>{days}</strong> day{days === 1 ? "" : "s"} left
            </>
          ) : (
            <strong className="is-text">{days < 0 ? "Closed" : "Due today"}</strong>
          )}
        </span>
      </div>
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
const CHECK_BADGE = ["#######", "#ooooo#", "#oooow#", "#ooowo#", "#wowoo#", "#owooo#", "#######"];

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
  profile: Profile;
  setJourney: (change: (j: UcJourneyState) => UcJourneyState) => void;
}

/** Bottom half of the map: tasks for the focused stop. */
function StageTasksPanel({ checkpoint: c, profile, setJourney }: PanelProps) {
  const headingId = `jm-stage-${c.id}`;
  const submittedAt = journeyOf(profile).submittedAt;

  return (
    <section className="jm-stage-panel" aria-labelledby={headingId}>
      <header className="jm-stage-head">
        <h2 id={headingId}>{c.title}</h2>
      </header>

      <ul className="jm-tasks">
        {c.tasks
          .filter((t) => !t.optional)
          .map((t) => (
            <li key={t.id} className={t.done ? "done" : ""}>
              <span className="jm-check" aria-hidden="true">
                {t.done ? <CheckIcon width={17} height={17} /> : null}
              </span>
              <span className="jm-task-label">
                {t.label}
                <span className="jm-sr">{t.done ? " — done" : " — not done"}</span>
              </span>
            </li>
          ))}
      </ul>

      {c.id === "apply" && submittedAt !== null && (
        <div className="jm-stage-actions">
          <button className="jm-link" onClick={() => setJourney((j) => ({ ...j, submittedAt: null }))}>
            I haven't actually submitted
          </button>
        </div>
      )}
    </section>
  );
}
