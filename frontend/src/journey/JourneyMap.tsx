import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { COLLEGES } from "../colleges";
import { usePlanning } from "../planning";
import { academicHistoryStatus, completeness, useProfile } from "../profile";
import { navigate } from "../router";
import { readJSON, userKey, writeJSON } from "../storage";
import type { PiqStatus, Profile, UcJourneyState } from "../types";
type Pose = "idle" | "run-a" | "run-b" | "jump";
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
} from "./logic";
import { LAYOUTS, MapScene, type Layout } from "./MapScene";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const WALK_MS = 900;

function useLayout(): Layout {
  const query = "(max-width: 720px)";
  const [tall, setTall] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setTall(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return tall ? "tall" : "wide";
}

export function JourneyMap({
  userId,
  onBack,
  embedded = false,
}: {
  userId: string;
  onBack?: () => void;
  /** Story-mode side panel: same map (player, labels, progress), no full-page chrome. */
  embedded?: boolean;
}) {
  const { profile, update } = useProfile();
  const { transcripts } = usePlanning();
  const responsive = useLayout();
  const layout: Layout = embedded ? "wide" : responsive;
  const sections = completeness(profile).sections;
  const academicStarted = academicHistoryStatus(profile, transcripts).started;
  const journey = useMemo(() => computeJourney(profile, sections, academicStarted), [profile, sections, academicStarted]);
  const { checkpoints, completeCount, current, finished } = journey;
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  // Walk the player from the last checkpoint they saw to the current one.
  const seenKey = userKey(userId, "ucMapSeen");
  const [shown, setShown] = useState(() => Math.min(readJSON(seenKey, current), current));
  const [pose, setPose] = useState<Pose>("idle");
  useEffect(() => {
    writeJSON(seenKey, current);
    if (shown === current) return;
    if (reducedMotion()) {
      setShown(current);
      return;
    }
    let frame = 0;
    const id = window.setInterval(() => setPose(++frame % 2 ? "run-a" : "run-b"), 140);
    const raf = requestAnimationFrame(() => setShown(current));
    const done = window.setTimeout(() => {
      window.clearInterval(id);
      setPose("jump");
      window.setTimeout(() => setPose("idle"), 260);
    }, WALK_MS);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(id);
      window.clearTimeout(done);
    };
  }, [current, seenKey]);

  const { w, h, nodes } = LAYOUTS[layout];
  const pct = (x: number, y: number) => ({
    left: `${(x / w) * 100}%`,
    top: `${(y / h) * 100}%`,
  });
  const [px, py] = nodes[Math.min(shown, nodes.length - 1)] ?? nodes[0];

  const setJourney = useCallback((change: (j: UcJourneyState) => UcJourneyState) => update((p) => ({ ...p, ucJourney: change(journeyOf(p)) })), [update]);

  const close = useCallback(() => {
    setOpen(null);
    opener.current?.focus();
  }, []);

  const progress = (
    <div className="jm-overall" aria-live="polite">
      <strong>{completeCount} of 5 checkpoints complete</strong>
      <span className="jm-bar" aria-hidden="true">
        <span style={{ width: `${(completeCount / 5) * 100}%` }} />
      </span>
    </div>
  );

  const mapBoard = (
    <div className={`jm-map jm-map-${layout}`} style={{ aspectRatio: `${w} / ${h}` }}>
      <MapScene layout={layout} ids={checkpoints.map((c) => c.id)} lit={checkpoints.map((c) => c.complete)} />
      <div className={`jm-player jm-pose-${pose}`} style={pct(px - 9, py)} aria-hidden="true">
        <img src="/journey/player.png" alt="" width={28} height={44} draggable={false} />
      </div>
      <ol className="jm-nodes" aria-label="Checkpoints">
        {checkpoints.map((c, i) => {
          const state = c.complete ? "complete" : i === current ? "current" : "upcoming";
          const [x, y] = nodes[i];
          return (
            <li key={c.id} className={`jm-node jm-node-${state} jm-label-${layout === "tall" ? (x < w / 2 ? "right" : "left") : "below"}`} style={pct(x, y)}>
              <button
                onClick={(e) => {
                  opener.current = e.currentTarget;
                  setOpen(i);
                }}
                aria-label={`Checkpoint ${i + 1}: ${c.title}. ${state === "complete" ? "Complete" : state === "current" ? "Current" : "Upcoming"}. ${c.summary}.`}
              >
                <span className="jm-node-dot" aria-hidden="true">
                  {state === "complete" ? <CheckIcon width={14} height={14} /> : state === "current" ? "★" : i + 1}
                </span>
                <span className="jm-node-text">
                  <span className="jm-node-title">{c.title}</span>
                  <span className="jm-node-meta">
                    <span className={`jm-state jm-state-${state}`}>
                      {state === "complete" ? "Complete" : state === "current" ? "You are here" : "Upcoming"}
                    </span>
                    {c.summary}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
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
        {embedded && <div className="jm-embedded-head">{progress}</div>}
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

          {c.id === "essays" && <PiqPicker journey={j} setJourney={setJourney} onOpenTool={() => go("materials", "essays")} />}

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
