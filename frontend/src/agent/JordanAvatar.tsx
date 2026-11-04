import { useEffect, useRef } from "react";
import { mouthFrame } from "./callState";

interface JordanAvatarProps {
  /** The SDK says Jordan's audio is playing (not just that a reply is on its way). */
  speaking: boolean;
  /** Current output level, 0–1, read every frame while speaking. */
  getLevel: () => number;
  /** Speaker muted: the level reads silent, so flap on a steady beat instead. */
  silentPlayback: boolean;
  reducedMotion: boolean;
}

/*
 * Jordan is the Counselor character (/mentors/counselor.png, 424 × 480). The sprite layers are the
 * same size, drawn over his face:
 * closed eyelids for blinking and two mouth frames. The base art has no mouth, so the closed
 * frame shows no overlay.
 */
/** Steady talking beat used when the level can't be read (speaker muted). */
const FLAP: (0 | 1 | 2)[] = [1, 2, 1, 0, 2, 1, 0];

/** Jordan in the call: idle blink and occasional nod (CSS), mouth frames from real audio level. */
export function JordanAvatar({ speaking, getLevel, silentPlayback, reducedMotion }: JordanAvatarProps) {
  const layersRef = useRef<HTMLDivElement>(null);
  const getLevelRef = useRef(getLevel);
  getLevelRef.current = getLevel;

  useEffect(() => {
    const el = layersRef.current;
    if (!el) return;
    const set = (frame: 0 | 1 | 2) => el.setAttribute("data-mouth", String(frame));
    if (!speaking) {
      set(0);
      return;
    }
    // Reduced motion: a still, slightly open mouth while Jordan talks; the label says "Speaking".
    if (reducedMotion) {
      set(1);
      return () => set(0);
    }
    let raf = 0;
    let level = 0;
    let last = -1;
    const started = performance.now();
    const tick = (now: number) => {
      let frame: 0 | 1 | 2;
      if (silentPlayback) {
        frame = FLAP[Math.floor((now - started) / 120) % FLAP.length];
      } else {
        let volume = 0;
        try {
          volume = getLevelRef.current();
        } catch {
          volume = 0;
        }
        level += (Math.min(1, volume * 2.2) - level) * 0.45;
        frame = mouthFrame(level);
      }
      if (frame !== last) {
        last = frame;
        set(frame);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      set(0);
    };
  }, [speaking, silentPlayback, reducedMotion]);

  return (
    <div ref={layersRef} className={`jordan${speaking ? " is-speaking" : ""}`} data-mouth="0" aria-hidden="true">
      <img src="/mentors/counselor.png" alt="" draggable={false} />
      <img className="jordan-lids" src="/mentors/counselor-blink.png" alt="" draggable={false} />
      <img className="jordan-mouth jordan-mouth-1" src="/mentors/counselor-mouth-1.png" alt="" draggable={false} />
      <img className="jordan-mouth jordan-mouth-2" src="/mentors/counselor-mouth-2.png" alt="" draggable={false} />
    </div>
  );
}
