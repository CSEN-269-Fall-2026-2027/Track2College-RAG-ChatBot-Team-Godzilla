import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { JourneyMap } from "../../journey/JourneyMap";
import { XIcon } from "../icons";

interface MapDrawerProps {
  userId: string;
  open: boolean;
  onClose: () => void;
}

/** Centered journey-map popup with an X — opened from the character box Map button. */
export function MapDrawer({ userId, open, onClose }: MapDrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("button, [href], input")?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="map-modal-wrap" role="presentation">
      <button type="button" className="map-modal-scrim" aria-label="Close journey map" onClick={onClose} />
      <div
        ref={panelRef}
        className="map-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="map-modal-head">
          <h2 id={titleId}>Journey map</h2>
          <button type="button" className="map-modal-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="map-modal-body">
          <JourneyMap userId={userId} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
