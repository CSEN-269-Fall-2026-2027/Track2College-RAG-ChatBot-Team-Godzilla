import type { FormEvent, ReactNode } from "react";
import { COLLEGES } from "../../colleges";
import type { GuidedChoice, GuidedTurn } from "../../journey/guided";
import type { usePiqDrafts } from "../../journey/usePiqDrafts";

/** "3+" lines its 3 up with the numbers above it, with the + hanging off to the right. */
function choiceLabel(label: string): ReactNode {
  const open = /^(\d+)\+$/.exec(label);
  if (!open) return label;
  return (
    <span className="guided-choice-count">
      {open[1]}
      <span className="guided-choice-plus">+</span>
    </span>
  );
}

export interface GuidedTurnBubbleProps {
  turn: GuidedTurn;
  /** Only show interactive answers when this mentor is the turn's speaker (or review/aid specials). */
  active: boolean;
  saved: string | null;
  draft: string;
  setDraft: (v: string) => void;
  pickedCampuses: string[];
  setPickedCampuses: (v: string[] | ((prev: string[]) => string[])) => void;
  piqDrafts: ReturnType<typeof usePiqDrafts>;
  pick: (choice: GuidedChoice) => void;
  run: (effect: import("../../journey/guided").GuidedEffect) => void;
  submitDraft: () => void;
  /** Jump to the turn's speaker when the student is viewing someone else. */
  onContinueWithSpeaker?: () => void;
  speakerName?: string;
}

/**
 * In-thread guided question: same choices as the old left panel, rendered under the chat.
 */
export function GuidedTurnBubble({
  turn,
  active,
  saved,
  draft,
  setDraft,
  pickedCampuses,
  setPickedCampuses,
  piqDrafts,
  pick,
  run,
  submitDraft,
  onContinueWithSpeaker,
  speakerName,
}: GuidedTurnBubbleProps) {
  const fillChoices = turn.choices.length >= 2 && turn.choices.length <= 5;

  if (!active) {
    return (
      <div className="guided-turn-bubble is-other" role="status">
        <p className="guided-turn-handoff">
          {speakerName ? `${speakerName} has the next question for you.` : "Another guide has the next question."}
        </p>
        {onContinueWithSpeaker && (
          <button type="button" className="guided-choice guided-choice-primary" onClick={onContinueWithSpeaker}>
            Continue with {speakerName ?? "them"}
          </button>
        )}
      </div>
    );
  }

  const onSubmitText = (event: FormEvent) => {
    event.preventDefault();
    submitDraft();
  };

  return (
    <section
      className={`guided-turn-bubble${turn.id === "confirm-piq" ? " guided-turn-compact" : ""}`}
      key={turn.id}
      aria-label="Your reply"
    >
      <div className="guided-chapter">
        <span className="guided-chapter-tag">{turn.chapter}</span>
        {saved && (
          <span className="guided-saved" role="status">
            ✓ {saved}
          </span>
        )}
      </div>

      <p className={`guided-question${turn.prompt.length <= 90 ? " is-short" : ""}`} role="status">
        {turn.prompt}
      </p>

      {turn.campusPicker ? (
        <form
          className="guided-campus-picker"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pickedCampuses.length) return;
            run({ type: "setCampuses", campuses: pickedCampuses });
          }}
        >
          <div className="guided-campus-list" role="group" aria-label="UC campuses">
            {COLLEGES.map((college) => {
              const on = pickedCampuses.some((n) => n.toLowerCase() === college.name.toLowerCase());
              return (
                <label key={college.name} className={`guided-campus-row${on ? " on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setPickedCampuses((prev) =>
                        on ? prev.filter((n) => n.toLowerCase() !== college.name.toLowerCase()) : [...prev, college.name],
                      )
                    }
                  />
                  <span>
                    <strong>{college.name}</strong>
                    <small>{college.city}</small>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="guided-picker-footer">
            <p className="guided-piq-count" aria-live="polite">
              {pickedCampuses.length} selected
            </p>
            <button type="submit" className="guided-campus-submit" disabled={!pickedCampuses.length}>
              Submit {pickedCampuses.length ? `(${pickedCampuses.length})` : ""}
            </button>
          </div>
        </form>
      ) : (
        <div className={`guided-choices${turn.stackedChoices ? " guided-choices-stacked" : ""}${fillChoices ? " guided-choices-fill" : ""}`} role="group" aria-label="Your reply">
          {turn.choices.map((choice) => {
            const busy = choice.effect.type === "generatePiqs" && choice.effect.piqIds.some(piqDrafts.isGenerating);
            return (
              <button
                key={choice.id}
                type="button"
                className={`guided-choice${choice.effect.type === "generatePiqs" && !choice.highlight ? " guided-choice-primary" : ""}${choice.highlight ? " guided-choice-highlight" : ""}${choice.selected ? " on" : ""}`}
                aria-pressed={choice.selected}
                onClick={() => pick(choice)}
                disabled={piqDrafts.busy}
              >
                {busy ? "Generating…" : choiceLabel(choice.label)}
              </button>
            );
          })}
        </div>
      )}

      {turn.note && (
        <p className="guided-note">
          <span className="guided-note-mark" aria-hidden="true">
            *
          </span>
          {turn.note.replace(/^\*/, "")}
        </p>
      )}

      {turn.id.startsWith("generate-") &&
        (() => {
          const piqId = turn.id.slice("generate-".length);
          const message = piqDrafts.errorFor(piqId);
          return message ? (
            <p className="form-error" role="alert">
              {message}
            </p>
          ) : null;
        })()}

      {turn.input && (
        <form className={`guided-input${turn.input.multiline ? " guided-input-multi" : ""}`} onSubmit={onSubmitText}>
          {turn.input.multiline ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={turn.input.placeholder}
              aria-label={turn.input.placeholder}
              rows={3}
              maxLength={1500}
            />
          ) : (
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={turn.input.placeholder}
              aria-label={turn.input.placeholder}
            />
          )}
          <button type="submit" disabled={!draft.trim() && !turn.input.allowEmpty}>
            {turn.input.submitLabel}
          </button>
        </form>
      )}
    </section>
  );
}
