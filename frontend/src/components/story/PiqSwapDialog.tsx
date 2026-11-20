import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PIQ_PROMPTS, PIQ_REQUIRED, PIQ_WORD_LIMIT } from "../../journey/logic";
import { XIcon } from "../icons";

interface PiqSwapDialogProps {
  /** Quill's picks, pre-checked so the student only swaps what they want. */
  initial: string[];
  onSubmit: (piqIds: string[]) => void;
  onClose: () => void;
}

/** "I want to swap": pick exactly four of the eight PIQs in a popup instead of the chat. */
export function PiqSwapDialog({ initial, onSubmit, onClose }: PiqSwapDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<string[]>(() => initial.slice(0, PIQ_REQUIRED));
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("input")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < PIQ_REQUIRED ? [...prev, id] : prev));

  return createPortal(
    <div className="map-modal-wrap" role="presentation">
      <button type="button" className="map-modal-scrim" aria-label="Close" onClick={onClose} />
      <div ref={panelRef} className="map-modal piq-swap-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="map-modal-head">
          <h2 id={titleId}>Choose 4 essays</h2>
          <button type="button" className="map-modal-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <form
          className="guided-campus-picker piq-swap-body"
          onSubmit={(e) => {
            e.preventDefault();
            if (picked.length !== PIQ_REQUIRED) return;
            // Keep official PIQ order for Quill's essay queue.
            onSubmit(PIQ_PROMPTS.filter((q) => picked.includes(q.id)).map((q) => q.id));
          }}
        >
          <div className="guided-campus-list guided-piq-list" role="group" aria-label="Personal Insight Questions">
            {PIQ_PROMPTS.map((q, i) => {
              const on = picked.includes(q.id);
              const lockedOut = !on && picked.length >= PIQ_REQUIRED;
              return (
                <label key={q.id} className={`guided-campus-row guided-piq-row${on ? " on" : ""}${lockedOut ? " locked" : ""}`} title={q.prompt}>
                  <input type="checkbox" checked={on} disabled={lockedOut} onChange={() => toggle(q.id)} />
                  <span>
                    <strong>
                      Essay #{i + 1}: {q.title}
                    </strong>
                    <small>{q.prompt}</small>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="guided-picker-footer">
            <p className="guided-piq-count" aria-live="polite">
              {picked.length}/{PIQ_REQUIRED} selected · up to {PIQ_WORD_LIMIT} words each
            </p>
            <button type="submit" className="guided-campus-submit" disabled={picked.length !== PIQ_REQUIRED}>
              Use these 4
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
