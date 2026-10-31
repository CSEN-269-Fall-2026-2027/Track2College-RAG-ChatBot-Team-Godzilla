import type { ReactNode } from "react";

interface DialogueBoxProps {
  speaker: string;
  title: string;
  text: string;
  /** Portion revealed so far by the typewriter. */
  visible: string;
  done: boolean;
  hasMore: boolean;
  page: number;
  pages: number;
  badge?: ReactNode;
  onClick: () => void;
}

/** Speech-bubble dialogue next to the mentor. */
export function DialogueBox({ speaker, title, text, visible, done, hasMore, page, pages, badge, onClick }: DialogueBoxProps) {
  return (
    <div className="speech" role="group" aria-label={`${speaker} says`}>
      <div className="speech-meta">
        <strong>{speaker}</strong>
        <span>{title}</span>
        {badge}
      </div>
      <button className="speech-bubble" onClick={onClick} aria-label={done ? (hasMore ? "Next line" : "Dialogue") : "Show full line"}>
        <span className="speech-text" aria-hidden="true">
          <span>{visible}</span>
          <span className="dialogue-ghost">{text.slice(visible.length)}</span>
        </span>
        <span className="story-sr" aria-live="polite">
          {done ? text : ""}
        </span>
        <span className="speech-footer">
          {pages > 1 && (
            <span>
              {page + 1}/{pages}
            </span>
          )}
          {done && hasMore && <span className="dialogue-next" aria-hidden="true">▼</span>}
        </span>
      </button>
    </div>
  );
}
