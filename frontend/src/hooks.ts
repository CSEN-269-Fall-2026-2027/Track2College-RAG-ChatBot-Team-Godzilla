import { useEffect, useState } from "react";

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Progressively reveals text for a streaming feel. The backend returns the full
 * answer at once, so this is purely presentational and capped to stay snappy.
 */
export function useReveal(text: string, enabled: boolean) {
  const [count, setCount] = useState(() => (enabled ? 0 : text.length));

  useEffect(() => {
    if (!enabled || prefersReducedMotion()) {
      setCount(text.length);
      return;
    }

    const duration = Math.min(1800, 250 + text.length * 3);
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 2);
      setCount(Math.round(text.length * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, enabled]);

  return { visible: text.slice(0, count), done: count >= text.length };
}

export function useElapsed(active: boolean) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) return;
    setSeconds(0);
    const start = Date.now();
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  return seconds;
}
