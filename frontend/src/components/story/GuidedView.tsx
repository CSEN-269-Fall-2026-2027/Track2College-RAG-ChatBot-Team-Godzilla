import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ucDeadlineDate } from "../../agent/logic";
import { COLLEGES } from "../../colleges";
import type { Mentor } from "../../game/characters";
import { applyGuidedEffect, inputEffect, nextGuidedTurn, savedLabel, type GuidedChoice, type GuidedEffect } from "../../journey/guided";
import { isUc, PIQ_PROMPTS, PIQ_REQUIRED, PIQ_WORD_LIMIT, type CheckpointId } from "../../journey/logic";
import { ucFacts } from "../../journey/facts";
import { usePiqDrafts } from "../../journey/usePiqDrafts";
import { JourneyMap } from "../../journey/JourneyMap";
import { completeness, useProfile } from "../../profile";
import { navigate } from "../../router";
import { newId } from "../../storage";
import { FactQuiz } from "./FactQuiz";

interface GuidedViewProps {
  visible: boolean;
  studentName: string;
  userId: string;
  /** Ask a guide (the current level's by default) a starter question in the chat on the right. */
  onAsk: (prompt: string, mentorId?: Mentor["id"]) => void;
  /** Chat with the current level's guide (conversation + message box), shown on the right. */
  chat: ReactNode;
  /** Name of that guide (Sage on the final step), for screen readers. */
  guideName: string;
  /** The map stop whose person the chat is with, when the student picked one. */
  selectedStage?: CheckpointId | null;
  /** Clicking a map stop: talk to that stop's person in the chat on the right. */
  onSelectStage?: (id: CheckpointId) => void;
}

/**
 * Story mode: the Journey Map (top) and the current question with its answer bubbles
 * (bottom) on the left; a chat with the current level's guide (or the clicked planet's) on the right.
 */
export function GuidedView({ visible, studentName, userId, onAsk, chat, guideName, selectedStage, onSelectStage }: GuidedViewProps) {
  const { profile, update } = useProfile();
  // Review & Apply: the reply area becomes a UC fun-facts quiz (deadline matches the Apply page).
  const deadline = new Date(`${ucDeadlineDate(profile)}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const facts = useMemo(() => ucFacts(deadline), [deadline]);
  const sections = completeness(profile).sections;
  const [draft, setDraft] = useState("");
  const [skipIds, setSkipIds] = useState<Set<string>>(() => new Set());
  const turn = useMemo(
    () => nextGuidedTurn(profile, sections, studentName, skipIds),
    [profile, sections, studentName, skipIds],
  );

  const [saved, setSaved] = useState<string | null>(null);
  const [pickedCampuses, setPickedCampuses] = useState<string[]>([]);
  const [pickedPiqs, setPickedPiqs] = useState<string[]>([]);
  const piqDrafts = usePiqDrafts();

  useEffect(() => {
    if (!saved) return;
    const id = window.setTimeout(() => setSaved(null), 3200);
    return () => window.clearTimeout(id);
  }, [saved]);

  useEffect(() => {
    if (!turn.campusPicker) return;
    setPickedCampuses(profile.colleges.filter(isUc).map((c) => c.name));
  }, [turn.id, turn.campusPicker, profile.colleges]);

  useEffect(() => {
    if (!turn.piqPicker) return;
    setPickedPiqs(Object.keys(profile.ucJourney?.piqs ?? {}));
  }, [turn.id, turn.piqPicker, profile.ucJourney?.piqs]);

  const run = (effect: GuidedEffect) => {
    setDraft("");
    switch (effect.type) {
      case "noop":
        setSkipIds((prev) => new Set(prev).add(turn.id));
        return;
      case "resume":
        setSkipIds(new Set());
        return;
      case "focusChat":
        document.querySelector<HTMLTextAreaElement>(".guided-chat .composer textarea")?.focus();
        return;
      case "ask":
        onAsk(effect.prompt, effect.mentorId);
        return;
      case "openEssays":
        navigate("profile", "essays");
        return;
      case "generatePiqs": {
        const regenerating = effect.piqIds.some((id) => !!profile.piqWork?.[id]?.draft);
        piqDrafts.generate(effect.piqIds, { regenerate: regenerating }).then((ok) => {
          if (ok) setSaved(regenerating ? "Fresh draft saved in Profile → Essays" : "Your essay is in Profile → Essays");
        });
        return;
      }
      default:
        update((p) => applyGuidedEffect(p, effect, newId));
        setSaved(savedLabel(effect));
    }
  };

  const pick = (choice: GuidedChoice) => run(choice.effect);

  const submitText = (event: FormEvent) => {
    event.preventDefault();
    const effect = inputEffect(turn, draft.trim());
    if (effect) run(effect);
  };

  return (
    <div className={`story story-guided${visible ? "" : " is-hidden"}`}>
      <div className="scene scene-plain" aria-hidden="true" />

      <div className="guided-layout">
        <div className="guided-left">
          <section className="guided-map-pane" aria-label="Journey map">
            <JourneyMap userId={userId} embedded selected={selectedStage ?? null} onSelect={onSelectStage} />
          </section>

          <section className="guided-select" key={turn.id} aria-label="Your reply">
            <div className="guided-chapter">
              <span className="guided-chapter-tag">{turn.chapter}</span>
              {saved && (
                <span className="guided-saved" role="status">
                  ✓ {saved}
                </span>
              )}
            </div>

            {turn.checkpointId !== "review" && (
              <p className="guided-question" role="status">
                {turn.prompt}
              </p>
            )}

            {turn.checkpointId === "review" ? (
              <FactQuiz facts={facts} />
            ) : turn.campusPicker ? (
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
            ) : turn.piqPicker ? (
              <form
                className="guided-campus-picker"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (pickedPiqs.length !== PIQ_REQUIRED) return;
                  run({ type: "setPiqs", piqIds: pickedPiqs });
                }}
              >
                <div className="guided-campus-list guided-piq-list" role="group" aria-label="Personal Insight Questions">
                  {PIQ_PROMPTS.map((q, i) => {
                    const on = pickedPiqs.includes(q.id);
                    const lockedOut = !on && pickedPiqs.length >= PIQ_REQUIRED;
                    return (
                      <label
                        key={q.id}
                        className={`guided-campus-row guided-piq-row${on ? " on" : ""}${lockedOut ? " locked" : ""}`}
                        title={q.prompt}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={lockedOut}
                          onChange={() =>
                            setPickedPiqs((prev) => (on ? prev.filter((id) => id !== q.id) : prev.length < PIQ_REQUIRED ? [...prev, q.id] : prev))
                          }
                        />
                        <span>
                          <strong>
                            {i + 1}. {q.title}
                          </strong>
                          <small>{q.prompt}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="guided-picker-footer">
                  <p className="guided-piq-count" aria-live="polite">
                    {pickedPiqs.length}/{PIQ_REQUIRED} selected · up to {PIQ_WORD_LIMIT} words each
                  </p>
                  <button type="submit" className="guided-campus-submit" disabled={pickedPiqs.length !== PIQ_REQUIRED}>
                    Submit 4 questions
                  </button>
                </div>
              </form>
            ) : (
              <div className="guided-choices" role="group" aria-label="Your reply">
                {turn.choices.map((choice) => {
                  const busy = choice.effect.type === "generatePiqs" && choice.effect.piqIds.some(piqDrafts.isGenerating);
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      className={`guided-choice${choice.effect.type === "generatePiqs" ? " guided-choice-primary" : ""}`}
                      onClick={() => pick(choice)}
                      disabled={piqDrafts.busy}
                    >
                      {busy ? "Writing your essay… this can take a few seconds" : choice.label}
                    </button>
                  );
                })}
              </div>
            )}

            {(turn.id.startsWith("generate-") || turn.id.startsWith("piq-ready-")) &&
              (() => {
                const piqId = turn.id.startsWith("generate-")
                  ? turn.id.slice("generate-".length)
                  : turn.id.slice("piq-ready-".length);
                const message = piqDrafts.errorFor(piqId);
                return message ? (
                  <p className="form-error" role="alert">
                    {message}
                  </p>
                ) : null;
              })()}

            {turn.input && (
              <form className={`guided-input${turn.input.multiline ? " guided-input-multi" : ""}`} onSubmit={submitText}>
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
        </div>

        <section className="guided-chat story-chat-thread" aria-label={`Chat with ${guideName}`}>
          {chat}
        </section>
      </div>
    </div>
  );
}
