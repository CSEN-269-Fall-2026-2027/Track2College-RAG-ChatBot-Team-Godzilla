import { useEffect, useRef, useState } from "react";
import { CHECKPOINT_COUNT, CHECKPOINTS } from "./logic";
import { PixelRunner, type RunnerPose } from "./PixelRunner";

interface JourneyPathProps {
  /** Active checkpoint index; use CHECKPOINT_COUNT for finish/summary (character at end). */
  checkpoint: number;
  /** Play a short run only when a checkpoint was just completed. */
  celebrate?: boolean;
  onCelebrateEnd?: () => void;
}

export function JourneyPath({ checkpoint, celebrate = false, onCelebrateEnd }: JourneyPathProps) {
  const display = Math.min(Math.max(checkpoint, 0), CHECKPOINT_COUNT - 1);
  const atFinish = checkpoint >= CHECKPOINT_COUNT;
  const markerIndex = atFinish ? CHECKPOINT_COUNT - 1 : display;
  const [pose, setPose] = useState<RunnerPose>("idle");
  const reduceRef = useRef(false);

  useEffect(() => {
    reduceRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (!celebrate) {
      setPose("idle");
      return;
    }
    if (reduceRef.current) {
      setPose("idle");
      onCelebrateEnd?.();
      return;
    }
    let frame = 0;
    setPose("jump");
    const id = window.setInterval(() => {
      frame += 1;
      if (frame === 1) setPose("run-a");
      else if (frame === 2) setPose("run-b");
      else if (frame === 3) setPose("run-a");
      else {
        setPose("idle");
        window.clearInterval(id);
        onCelebrateEnd?.();
      }
    }, 120);
    return () => window.clearInterval(id);
  }, [celebrate, onCelebrateEnd]);

  const pct = atFinish ? 100 : (markerIndex / (CHECKPOINT_COUNT - 1)) * 100;

  return (
    <div className="ob-journey" aria-label={`Step ${Math.min(display + 1, CHECKPOINT_COUNT)} of ${CHECKPOINT_COUNT}`}>
      <div className="ob-journey-meta">
        <span className="ob-step-count">Step {atFinish ? CHECKPOINT_COUNT : display + 1} of {CHECKPOINT_COUNT}</span>
        <span className="ob-step-label">{atFinish ? "Review" : CHECKPOINTS[display].label}</span>
      </div>

      <div className={`ob-path ${celebrate ? "is-animating" : ""}`}>
        <div className="ob-path-line" aria-hidden="true">
          <span className="ob-path-fill" style={{ width: `${pct}%` }} />
        </div>
        <ol className="ob-markers">
          {CHECKPOINTS.map((cp, i) => {
            const done = atFinish || i < display;
            const active = !atFinish && i === display;
            return (
              <li key={cp.id} className={`ob-marker ${done ? "done" : ""} ${active ? "active" : ""}`}>
                <span className="ob-marker-dot" aria-hidden="true">
                  {done ? "✓" : i + 1}
                </span>
                <span className="ob-marker-name">{cp.label}</span>
              </li>
            );
          })}
        </ol>
        <div
          className={`ob-runner-slot ${celebrate ? "is-moving" : "is-snap"}`}
          style={{ left: `calc(${pct}% - 20px)` }}
        >
          <PixelRunner pose={pose} />
        </div>
      </div>
    </div>
  );
}
