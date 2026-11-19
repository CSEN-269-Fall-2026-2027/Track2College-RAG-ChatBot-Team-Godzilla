import { MENTORS, REVIEW_GUIDES, type Mentor } from "../../game/characters";
import { Character } from "./Character";

export interface MentorSwitcherProps {
  activeId: Mentor["id"];
  /** Review personas unlock after Apply steps are ready. */
  applyUnlocked: boolean;
  onSelect: (mentorId: Mentor["id"]) => void;
  busy?: boolean;
}

/** Compact avatar row to jump between guides (shown once Financial Aid unlocks free picking). */
export function MentorSwitcher({ activeId, applyUnlocked, onSelect, busy }: MentorSwitcherProps) {
  const guides: Mentor[] = [...MENTORS, ...(applyUnlocked ? REVIEW_GUIDES : [])];

  return (
    <div className="mentor-switcher" role="radiogroup" aria-label="Chat with a guide">
      {guides.map((guide) => {
        const on = guide.id === activeId;
        return (
          <button
            key={guide.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${guide.name}, ${guide.title}`}
            title={`${guide.name} — ${guide.title}`}
            className={`mentor-switcher-btn${on ? " on" : ""}`}
            disabled={busy && !on}
            onClick={() => {
              if (!on) onSelect(guide.id);
            }}
          >
            <Character mentor={guide} mood={on ? "happy" : "happy"} size={44} className="mentor-switcher-art" />
            <span className="mentor-switcher-name">{guide.name}</span>
          </button>
        );
      })}
    </div>
  );
}
