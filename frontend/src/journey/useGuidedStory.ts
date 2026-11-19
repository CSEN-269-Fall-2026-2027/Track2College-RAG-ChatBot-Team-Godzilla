import { useEffect, useMemo, useState } from "react";
import { ApiError, extractActivities } from "../api";
import type { Mentor } from "../game/characters";
import { completeness, useProfile } from "../profile";
import { navigate } from "../router";
import { newId } from "../storage";
import type { ActivitySectionId, Message } from "../types";
import { applyGuidedEffect, inputEffect, nextGuidedTurn, savedLabel, type GuidedChoice, type GuidedEffect } from "./guided";
import { activitySection, isUc, journeyOf } from "./logic";
import { activityNotesFrom, activityReportMessage, canFinishActivities } from "./piqs";
import { usePiqDrafts } from "./usePiqDrafts";

export interface GuidedStoryHandlers {
  onAsk: (prompt: string, mentorId?: Mentor["id"], display?: string) => void;
  onRestartAsk: (prompt: string, mentorId: Mentor["id"]) => void;
  onSendToProfile: (section: ActivitySectionId) => void;
  miloMessages: Message[];
}

/** Story-mode turn state + effect runner for in-chat guided bubbles. */
export function useGuidedStory(studentName: string, handlers: GuidedStoryHandlers) {
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
        handlers.onAsk(effect.prompt, effect.mentorId);
        return;
      case "setActivityCount":
        if (effect.count === activitySection(journeyOf(profile), effect.section).count) return;
        setActivityError(null);
        update((p) => applyGuidedEffect(p, effect, newId));
        if (effect.count >= 3) handlers.onSendToProfile(effect.section);
        else if (effect.count > 0) handlers.onRestartAsk(activityReportMessage(effect.section, effect.count), "milo");
        return;
      case "fillInProfile":
        update((p) => applyGuidedEffect(p, effect, newId));
        navigate("profile", "activities");
        return;
      case "finishActivities": {
        const notes = activityNotesFrom(handlers.miloMessages);
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

  const pick = (choice: GuidedChoice) => {
    if (choice.effect.type === "ask") {
      setDraft("");
      handlers.onAsk(choice.effect.prompt, choice.effect.mentorId, choice.label);
    } else run(choice.effect);
  };

  const submitDraft = () => {
    const effect = inputEffect(turn, draft.trim());
    if (effect) run(effect);
  };

  /** Composer dual-mode: apply guided text when the turn expects it for this speaker. */
  const tryGuidedText = (text: string, activeMentorId: Mentor["id"]): boolean => {
    if (!turn.input || turn.speaker !== activeMentorId) return false;
    const effect = inputEffect(turn, text.trim());
    if (!effect) return false;
    run(effect);
    return true;
  };

  return {
    turn,
    draft,
    setDraft,
    saved,
    pickedCampuses,
    setPickedCampuses,
    pickedPiqs,
    setPickedPiqs,
    piqDrafts,
    savingActivities,
    activityError,
    canFinish: canFinishActivities(handlers.miloMessages),
    run,
    pick,
    submitDraft,
    tryGuidedText,
  };
}
