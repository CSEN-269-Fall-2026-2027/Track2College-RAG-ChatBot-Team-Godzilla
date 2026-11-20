import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ACTIVITY_DESC_LIMIT } from "../../journey/logic";
import type { ActivitySectionId, WaitlistItem } from "../../types";
import { PlusIcon, TrashIcon, XIcon } from "../icons";

const TYPES: { id: ActivitySectionId; label: string }[] = [
  { id: "activities", label: "Activity" },
  { id: "volunteering", label: "Volunteering" },
  { id: "job", label: "Job" },
  { id: "awards", label: "Honor or award" },
];

const LEVELS = ["School", "Regional", "State", "National", "International"];

interface Props {
  items: WaitlistItem[];
  newId: () => string;
  /** Save the edited waitlist (still not in the profile until Milo's Confirm). */
  onSave: (items: WaitlistItem[]) => void;
  /** Scan Google again and return the list with anything new added (null when Google isn't connected). */
  onRescan?: ((items: WaitlistItem[]) => Promise<WaitlistItem[]>) | null;
  onClose: () => void;
}

/** Milo's Edit: change, remove, or add to what Google found before it goes into the profile. */
export function ActivityWaitlistDialog({ items: initial, newId, onSave, onRescan, onClose }: Props) {
  const titleId = useId();
  const [items, setItems] = useState<WaitlistItem[]>(initial);
  const [rescan, setRescan] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });
  const searchAgain = async () => {
    if (!onRescan) return;
    setRescan({ busy: true, note: null });
    try {
      // Done: save (keeping any edits made here) and close; Milo's messages in the chat show the new list.
      const next = await onRescan(items);
      onSave(next.filter((i) => i.name.trim()));
    } catch (e) {
      setRescan({ busy: false, note: e instanceof Error ? e.message : "Couldn't search Google." });
    }
  };
  const listRef = useRef<HTMLOListElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const patch = (id: string, change: Partial<WaitlistItem>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...change } : i)));
  const remove = (id: string) => setItems((list) => list.filter((i) => i.id !== id));
  const add = () => {
    setItems((list) => [...list, { id: newId(), section: "activities", name: "", role: "", description: "", level: "" }]);
    // Focus the new row's name once it's on screen.
    window.setTimeout(() => listRef.current?.querySelector<HTMLInputElement>("li:last-child input")?.focus(), 0);
  };
  // Rows with no name are dropped on save.
  const save = () => onSave(items.filter((i) => i.name.trim()));

  return createPortal(
    <div className="map-modal-wrap" role="presentation">
      <button type="button" className="map-modal-scrim" aria-label="Close" onClick={onClose} />
      <div className="map-modal waitlist-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="map-modal-head">
          <h2 id={titleId}>Edit activities and honors</h2>
          <button type="button" className="map-modal-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="waitlist-body">
          {items.length === 0 ? (
            <p className="waitlist-empty">Nothing here yet. Add an activity or honor below.</p>
          ) : (
            <ol className="waitlist-list" ref={listRef}>
              {items.map((item) => {
                const award = item.section === "awards";
                return (
                  <li key={item.id} className="waitlist-item">
                    <div className="waitlist-row">
                      <label className="field">
                        <span className="field-label">Type</span>
                        <select value={item.section} onChange={(e) => patch(item.id, { section: e.target.value as ActivitySectionId })}>
                          {TYPES.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field waitlist-grow">
                        <span className="field-label">Name</span>
                        <input value={item.name} onChange={(e) => patch(item.id, { name: e.target.value })} placeholder={award ? "e.g. AP Scholar" : "e.g. Robotics Club"} />
                      </label>
                      {award ? (
                        <label className="field">
                          <span className="field-label">Level</span>
                          <select value={item.level} onChange={(e) => patch(item.id, { level: e.target.value })}>
                            <option value="">Select</option>
                            {LEVELS.map((l) => (
                              <option key={l} value={l.toLowerCase()}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <label className="field">
                          <span className="field-label">Role</span>
                          <input value={item.role} onChange={(e) => patch(item.id, { role: e.target.value })} placeholder="e.g. Captain" />
                        </label>
                      )}
                      <button type="button" className="waitlist-remove" onClick={() => remove(item.id)} aria-label={`Remove ${item.name || "this item"}`} title="Remove">
                        <TrashIcon width={16} height={16} />
                      </button>
                    </div>
                    <label className="field">
                      <span className="field-label">Description</span>
                      <textarea
                        rows={2}
                        value={item.description}
                        maxLength={ACTIVITY_DESC_LIMIT}
                        onChange={(e) => patch(item.id, { description: e.target.value })}
                      />
                    </label>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="waitlist-actions">
            <button type="button" className="btn-ghost" onClick={add}>
              <PlusIcon width={15} height={15} /> Add
            </button>
            {onRescan && (
              <button type="button" className="btn-ghost" onClick={() => void searchAgain()} disabled={rescan.busy}>
                {rescan.busy ? "Searching…" : "Search Google again"}
              </button>
            )}
            {rescan.note && (
              <span className="waitlist-note" role="status">
                {rescan.note}
              </span>
            )}
            <span className="waitlist-spacer" />
            <button type="button" className="btn-primary" onClick={save}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
