import { useEffect, useMemo, useState } from "react";
import type { Mentor } from "../game/characters";
import { completeness, useProfile } from "../profile";
import { navigate } from "../router";
import { newId } from "../storage";
import { applyGuidedEffect, inputEffect, nextGuidedTurn, savedLabel, type GuidedChoice, type GuidedEffect } from "./guided";
import { isUc } from "./logic";
import { usePiqDrafts } from "./usePiqDrafts";

export interface GuidedStoryHandlers {
  onAsk: (prompt: string, mentorId?: Mentor["id"], display?: string) => void;
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
    piqDrafts,
    run,
    pick,
    submitDraft,
    tryGuidedText,
  };
}
