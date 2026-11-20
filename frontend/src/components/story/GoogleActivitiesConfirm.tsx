import { useState } from "react";
import type { GoogleActivitySuggestion } from "../../api";
import { applyGoogleActivitySuggestions, withGoogleActivitiesReviewed } from "../../journey/googleActivities";
import { useProfile } from "../../profile";
import { newId } from "../../storage";

interface Props {
  suggestions: GoogleActivitySuggestion[];
  onDone: () => void;
}

/** Profile “Grab again” confirm — keep/skip checkboxes for scanned activities. */
export function GoogleActivitiesConfirm({ suggestions, onDone }: Props) {
  const { update } = useProfile();
  const [picked, setPicked] = useState<Set<number>>(() => new Set(suggestions.map((_, i) => i)));
  const [saving, setSaving] = useState(false);

  const toggle = (i: number) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const save = () => {
    setSaving(true);
    const chosen = suggestions.filter((_, i) => picked.has(i));
    update((p) => applyGoogleActivitySuggestions(p, chosen, newId));
    setSaving(false);
    onDone();
  };

  const skip = () => {
    update(withGoogleActivitiesReviewed);
    onDone();
  };

  return (
    <section className="guided-turn-bubble google-activities-confirm" aria-label="Activities from Google">
      <div className="guided-chapter">
        <span className="guided-chapter-tag">Activities · Google</span>
      </div>
      <p className="guided-question is-short" role="status">
        Keep the ones that look right, then we can add more in Profile.
      </p>
      <div className="guided-campus-list google-activities-list" role="group" aria-label="Suggested activities">
        {suggestions.map((item, i) => {
          const on = picked.has(i);
          return (
            <label key={`${item.name}-${i}`} className={`guided-campus-row${on ? " on" : ""}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(i)} />
              <span>
                <strong>{item.name}</strong>
                <small>{[item.role, item.description].filter(Boolean).join(" · ")}</small>
              </span>
            </label>
          );
        })}
      </div>
      <div className="guided-picker-footer">
        <button type="button" className="guided-campus-submit" disabled={saving || picked.size === 0} onClick={save}>
          {saving ? "Saving…" : `Keep ${picked.size || ""}`}
        </button>
        <button type="button" className="btn-ghost" onClick={skip} disabled={saving}>
          None of these / skip
        </button>
      </div>
    </section>
  );
}
