import { useEffect, useMemo, useState, type FormEvent } from "react";
import { COLLEGES } from "../../colleges";
import { mentorById, type Mentor } from "../../game/characters";
import { useGame } from "../../game/GameProvider";
import { applyGuidedEffect, inputEffect, nextGuidedTurn, savedLabel, type GuidedChoice, type GuidedEffect } from "../../journey/guided";
import { isUc, PIQ_PROMPTS, PIQ_REQUIRED, PIQ_WORD_LIMIT } from "../../journey/logic";
import { usePiqDrafts } from "../../journey/usePiqDrafts";
import { JourneyMap } from "../../journey/JourneyMap";
import { completeness, useProfile } from "../../profile";
import { navigate } from "../../router";
import { newId } from "../../storage";
import { ModeSwitch } from "../ModeSwitch";
import { Character } from "./Character";

interface GuidedViewProps {
  visible: boolean;
  studentName: string;
  userId: string;
  /** Hand off to a guide in Manual chat with a starter question. */
  onAsk: (prompt: string, mentorId: Mentor["id"]) => void;
}

/** Story turns on the left (each chapter told by its guide); the Journey Map on the right updates live. */
export function GuidedView({ visible, studentName, userId, onAsk }: GuidedViewProps) {
  const { profile, update } = useProfile();
  const { updateSettings } = useGame();
  const sections = completeness(profile).sections;
  const [draft, setDraft] = useState("");
  const [skipIds, setSkipIds] = useState<Set<string>>(() => new Set());
  const turn = useMemo(
    () => nextGuidedTurn(profile, sections, studentName, skipIds),
    [profile, sections, studentName, skipIds],
  );

  const speaker = mentorById(turn.speaker);
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
      case "openManual":
        updateSettings({ storyMode: false });
        return;
      case "ask":
        onAsk(effect.prompt, effect.mentorId);
        return;
      case "openEssays":
        navigate("materials", "essays");
        return;
      case "generatePiqs": {
        const regenerating = effect.piqIds.some((id) => !!profile.piqWork?.[id]?.draft);
        piqDrafts.generate(effect.piqIds, { regenerate: regenerating }).then((ok) => {
          if (ok) setSaved(regenerating ? "Fresh draft saved in Materials → Essays" : "Your essay is in Materials → Essays");
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

      <div className="mode-switch-under-nav">
        <ModeSwitch className="mode-switch-lg" />
      </div>

      <div className="guided-layout">
        <div className="guided-main">
          <div className="guided-chapter">
            <span className="guided-chapter-tag">{turn.chapter}</span>
            {saved && (
              <span className="guided-saved" role="status">
                ✓ {saved}
              </span>
            )}
          </div>

          <div className="guided-dialog" key={turn.id}>
            <div className="guided-speaker">
              <Character mentor={speaker} mood="happy" size={56} className="guided-speaker-avatar" />
              <strong>{speaker.name}</strong>
              <span className="guided-speaker-title">{speaker.title}</span>
            </div>

            <div className="speech-bubble guided-prompt" role="status">
              {turn.prompt}
            </div>

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
                <button type="submit" className="guided-campus-submit" disabled={!pickedCampuses.length}>
                  Submit {pickedCampuses.length ? `(${pickedCampuses.length})` : ""}
                </button>
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
                <p className="guided-piq-count" aria-live="polite">
                  {pickedPiqs.length}/{PIQ_REQUIRED} selected · up to {PIQ_WORD_LIMIT} words each
                </p>
                <div className="guided-campus-list" role="group" aria-label="Personal Insight Questions">
                  {PIQ_PROMPTS.map((q, i) => {
                    const on = pickedPiqs.includes(q.id);
                    const lockedOut = !on && pickedPiqs.length >= PIQ_REQUIRED;
                    return (
                      <label key={q.id} className={`guided-campus-row guided-piq-row${on ? " on" : ""}${lockedOut ? " locked" : ""}`}>
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
                <button type="submit" className="guided-campus-submit" disabled={pickedPiqs.length !== PIQ_REQUIRED}>
                  Submit 4 questions
                </button>
              </form>
            ) : (
              <div className="guided-choices" role="group" aria-label="Your reply">
                {turn.choices.map((choice, i) => {
                  const busy = choice.effect.type === "generatePiqs" && choice.effect.piqIds.some(piqDrafts.isGenerating);
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      className={`guided-choice${choice.effect.type === "generatePiqs" ? " guided-choice-primary" : ""}`}
                      onClick={() => pick(choice)}
                      disabled={piqDrafts.busy}
                    >
                      <span className="guided-choice-key">{i + 1}</span>
                      <span>{busy ? "Writing your essay… this can take a few seconds" : choice.label}</span>
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
                <button type="submit" disabled={!draft.trim()}>
                  {turn.input.submitLabel}
                </button>
              </form>
            )}
          </div>
        </div>

        <aside className="guided-map-rail" aria-label="Journey map">
          <JourneyMap userId={userId} embedded />
        </aside>
      </div>
    </div>
  );
}
