import { useEffect } from "react";
import { MENTORS, REVIEW_GUIDES, type Mentor } from "../../game/characters";
import { ArrowRightIcon } from "../icons";

export interface MentorSwitcherProps {
  activeId: Mentor["id"];
  onSelect: (mentorId: Mentor["id"]) => void;
  busy?: boolean;
}

/** Every guide, in journey order, then the Counselor and Application assistant. */
export const SWITCHER_GUIDES: Mentor[] = [...MENTORS, ...REVIEW_GUIDES];

/** The guide `step` places away from `activeId`, wrapping around both ends. */
export function stepGuide(activeId: Mentor["id"], step: 1 | -1): Mentor["id"] {
  const i = Math.max(0, SWITCHER_GUIDES.findIndex((g) => g.id === activeId));
  const n = SWITCHER_GUIDES.length;
  return SWITCHER_GUIDES[(i + step + n) % n].id;
}

/**
 * Once the journey is done: ‹ › arrows beside the character switch between the guides one at a time
 * (instead of showing them all). The left and right arrow keys work too.
 */
export function MentorSwitcher({ activeId, onSelect, busy }: MentorSwitcherProps) {
  const index = Math.max(0, SWITCHER_GUIDES.findIndex((g) => g.id === activeId));
  const prev = SWITCHER_GUIDES[(index - 1 + SWITCHER_GUIDES.length) % SWITCHER_GUIDES.length];
  const next = SWITCHER_GUIDES[(index + 1) % SWITCHER_GUIDES.length];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (busy || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      // Leave the arrow keys alone while typing.
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      onSelect(stepGuide(activeId, event.key === "ArrowLeft" ? -1 : 1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [activeId, busy, onSelect]);

  return (
    <div className="guide-arrows" aria-label="Switch guide">
      <button type="button" className="guide-arrow" onClick={() => onSelect(prev.id)} disabled={busy} aria-label={`Previous guide: ${prev.name}`} title={prev.name}>
        <ArrowRightIcon width={20} height={20} style={{ transform: "rotate(180deg)" }} />
      </button>
      <span className="guide-arrows-count" aria-live="polite">
        {index + 1} of {SWITCHER_GUIDES.length}
      </span>
      <button type="button" className="guide-arrow" onClick={() => onSelect(next.id)} disabled={busy} aria-label={`Next guide: ${next.name}`} title={next.name}>
        <ArrowRightIcon width={20} height={20} />
      </button>
    </div>
  );
}
