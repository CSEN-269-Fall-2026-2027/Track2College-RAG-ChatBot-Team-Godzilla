import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, extractActivities } from "../../api";
import { COLLEGES } from "../../colleges";
import type { Mentor } from "../../game/characters";
import { applyGuidedEffect, inputEffect, nextGuidedTurn, reviewVisitKind, savedLabel, storyComplete, type GuidedChoice, type GuidedEffect } from "../../journey/guided";
import { activitySection, isUc, journeyOf, PIQ_PROMPTS, PIQ_REQUIRED, PIQ_WORD_LIMIT, type CheckpointId } from "../../journey/logic";
import { activityNotesFrom, activityReportMessage, canFinishActivities } from "../../journey/piqs";
import { usePiqDrafts } from "../../journey/usePiqDrafts";
import { JourneyMap } from "../../journey/JourneyMap";
import { completeness, useProfile } from "../../profile";
import { navigate } from "../../router";
import { newId } from "../../storage";
import { GuideSpotlight, ReviewPersonaPicker } from "./ReviewApply";
import { mentorById } from "../../game/characters";
import { STAGE_GUIDE, useCurrentStage } from "../../journey/guides";
import { FinancialAid } from "./FinancialAid";
import type { ActivitySectionId, AidMode, Message, ReviewMode } from "../../types";

interface GuidedViewProps {
  visible: boolean;
  studentName: string;
  userId: string;
  /** Ask a guide (the current level's by default) a starter question in the chat on the right. */
  onAsk: (prompt: string, mentorId?: Mentor["id"], display?: string) => void;
  /** Start that guide's chat over with this first message. */
  onRestartAsk: (prompt: string, mentorId: Mentor["id"]) => void;
  /** Milo tells the student to add this question's answers on the Profile page, starting his chat over. */
  onSendToProfile: (section: ActivitySectionId) => void;
  /** The chat with Milo, which holds what the student shares about their activities. */
  miloMessages: Message[];
  /** Chat with the current level's guide (conversation + message box), shown on the right. */
  chat: ReactNode;
  /** Name of that guide (Sage on the final step), for screen readers. */
  guideName: string;
  /** The map stop whose person the chat is with, when the student picked one. */
  selectedStage?: CheckpointId | null;
  /** Clicking a map stop: talk to that stop's person in the chat on the right. */
  onSelectStage?: (id: CheckpointId) => void;
  /** The student switched Review & Apply between Counselor and Application assistant. */
  onModeChange: (mode: ReviewMode) => void;
  /** The student switched Financial Aid between FAFSA and Scholarships. */
  onAidModeChange: (mode: AidMode) => void;
}

/**
 * Story mode: the Journey Map (top) and the current question with its answer bubbles
 * (bottom) on the left; a chat with the current level's guide (or the clicked planet's) on the right.
 */
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

export function GuidedView({ visible, studentName, userId, onAsk, onRestartAsk, onSendToProfile, miloMessages, chat, guideName, selectedStage, onSelectStage, onModeChange, onAidModeChange }: GuidedViewProps) {
  const { profile, update } = useProfile();
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
  const [savingActivities, setSavingActivities] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

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
        update((p) => applyGuidedEffect(p, { type: "unskipPiqs" }, newId));
        return;
      case "focusChat":
        document.querySelector<HTMLTextAreaElement>(".guided-chat .composer textarea")?.focus();
        return;
      case "ask":
        onAsk(effect.prompt, effect.mentorId);
        return;
      case "setActivityCount":
        if (effect.count === activitySection(journeyOf(profile), effect.section).count) return;
        setActivityError(null);
        update((p) => applyGuidedEffect(p, effect, newId));
        if (effect.count >= 3) onSendToProfile(effect.section);
        else if (effect.count > 0) onRestartAsk(activityReportMessage(effect.section, effect.count), "milo");
        return;
      case "fillInProfile":
        update((p) => applyGuidedEffect(p, effect, newId));
        navigate("profile", "activities");
        return;
      case "finishActivities": {
        const notes = activityNotesFrom(miloMessages);
        setSavingActivities(true);
        setActivityError(null);
        extractActivities(notes, effect.section)
          .then((items) => {
            const save: GuidedEffect = { type: "saveActivitySection", section: effect.section, notes, items };
            update((p) => applyGuidedEffect(p, save, newId));
            setSaved(savedLabel(save));
          })
          .catch((error) => setActivityError(error instanceof ApiError ? error.message : "Couldn't save that. Please try again."))
          .finally(() => setSavingActivities(false));
        return;
      }
      case "pasteEssay":
        piqDrafts.requestEdit(effect.piqId);
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

  // A button's question shows in the chat as its label; the model gets the full prompt.
  const pick = (choice: GuidedChoice) => {
    if (choice.effect.type === "ask") {
      setDraft("");
      onAsk(choice.effect.prompt, choice.effect.mentorId, choice.label);
    } else run(choice.effect);
  };
  // Financial Aid (once the "do you need aid?" question is answered): FAFSA or Scholarships.
  const aidModes = turn.checkpointId === "aid" && turn.id !== "aid-needs";

  // Another stop on the map is selected: the chat is with its guide, so this panel shows that guide
  // and a way back, not the current step's question.
  const currentStage = useCurrentStage();
  const homeStage = turn.checkpointId === "done" ? currentStage : turn.checkpointId;
  const viewingOther = selectedStage && selectedStage !== homeStage && selectedStage !== currentStage ? selectedStage : null;
  // Apply tools unlock only after Basic Info, UCs, Activities, and Essays are done.
  const applyUnlocked = storyComplete(profile, sections);
  const reviewVisit = viewingOther === "review" ? reviewVisitKind(currentStage, applyUnlocked) : null;
  const revisitingApply = reviewVisit === "revisit";
  const applyLockedEarly = reviewVisit === "locked";
  const viewedGuide =
    viewingOther && viewingOther !== "review"
      ? mentorById(STAGE_GUIDE[viewingOther])
      : null;

  // A few answers share the panel as tall rows instead of leaving it half empty. Long lists stay as bubbles.
  const fillChoices = turn.choices.length >= 2 && turn.choices.length <= 5;

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

          {revisitingApply ? (
            <section className="guided-select" aria-label="Who you're chatting with">
              <ReviewPersonaPicker onModeChange={onModeChange} />
              <button type="button" className="review-persona-back" onClick={() => onSelectStage?.(homeStage)}>
                Back to Financial Aid
              </button>
            </section>
          ) : applyLockedEarly ? (
            <section className="guided-select" aria-label="Review & Apply locked">
              <p className="guided-question" role="status">
                Finish Basic Info, Choose UCs, your activities list, and your four essays before using Review &amp; Apply.
              </p>
              <button type="button" className="review-persona-back" onClick={() => onSelectStage?.(homeStage)}>
                Back to current step
              </button>
            </section>
          ) : viewedGuide ? (
            <section className="guided-select" aria-label="Who you're chatting with">
              <GuideSpotlight
                guide={viewedGuide}
                backLabel={homeStage === "review" ? "Back to Counselor or Application assistant" : "Back to current step"}
                onBack={() => onSelectStage?.(homeStage)}
              />
            </section>
          ) : (
          <section className="guided-select" key={turn.id} aria-label="Your reply">
            <div className="guided-chapter">
              <span className="guided-chapter-tag">{turn.chapter}</span>
              {saved && (
                <span className="guided-saved" role="status">
                  ✓ {saved}
                </span>
              )}
            </div>

            {turn.checkpointId !== "review" && !aidModes && (
              <p className={`guided-question${turn.prompt.length <= 90 ? " is-short" : ""}`} role="status">
                {turn.prompt}
              </p>
            )}

            {turn.checkpointId === "review" ? (
              <ReviewPersonaPicker onModeChange={onModeChange} />
            ) : aidModes ? (
              <FinancialAid turn={turn} onPick={pick} onModeChange={onAidModeChange} />
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
              <div className={`guided-choices${turn.stackedChoices ? " guided-choices-stacked" : ""}${fillChoices ? " guided-choices-fill" : ""}`} role="group" aria-label="Your reply">
                {turn.choices.map((choice) => {
                  const busy = choice.effect.type === "generatePiqs" && choice.effect.piqIds.some(piqDrafts.isGenerating);
                  const savingThis = savingActivities && choice.effect.type === "finishActivities";
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      className={`guided-choice${choice.effect.type === "generatePiqs" && !choice.highlight ? " guided-choice-primary" : ""}${choice.highlight ? " guided-choice-highlight" : ""}${choice.selected ? " on" : ""}`}
                      aria-pressed={choice.selected}
                      onClick={() => pick(choice)}
                      disabled={piqDrafts.busy || savingActivities || (choice.effect.type === "finishActivities" && !canFinishActivities(miloMessages))}
                    >
                      {busy ? "Generating…" : savingThis ? "Saving…" : choiceLabel(choice.label)}
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

            {activityError && turn.choices.some((c) => c.effect.type === "finishActivities") && (
              <p className="form-error" role="alert">
                {activityError} Your chat with Milo is still here, so hit Done to try again.
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
          )}
        </div>

        <section className="guided-chat story-chat-thread" aria-label={`Chat with ${guideName}`}>
          {chat}
        </section>
      </div>
    </div>
  );
}
