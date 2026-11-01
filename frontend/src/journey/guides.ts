import { useMemo } from "react";
import type { Mentor } from "../game/characters";
import { usePlanning } from "../planning";
import { academicHistoryStatus, completeness, useProfile } from "../profile";
import { computeJourney, type CheckpointId } from "./logic";

/**
 * Each guide owns a level of the UC journey. Story mode's chat is with the guide of the level
 * the student is on: Sage for Review & Apply, Penny for Financial Aid at the end.
 * Basic Info has no guide of its own; Sage, the general admissions guide, covers it.
 */
export const STAGE_GUIDE: Record<CheckpointId, Mentor["id"]> = {
  profile: "sage",
  ucs: "penny",
  activities: "milo",
  essays: "quill",
  review: "sage",
  aid: "penny",
};

/** The level the student is on (the last one once everything is done), from the same rules as the map. */
export function useCurrentStage(): CheckpointId {
  const { profile } = useProfile();
  const { transcripts } = usePlanning();
  return useMemo(() => {
    const journey = computeJourney(profile, completeness(profile).sections, academicHistoryStatus(profile, transcripts).started);
    return journey.checkpoints[journey.finished ? journey.checkpoints.length - 1 : journey.current].id;
  }, [profile, transcripts]);
}

/**
 * The planet to select so the chat is with `mentorId`: null keeps the current chapter when its
 * guide already is that person, otherwise the first chapter that guide owns.
 */
export function stageFor(mentorId: Mentor["id"], current: CheckpointId): CheckpointId | null {
  if (STAGE_GUIDE[current] === mentorId) return null;
  const owned = (Object.keys(STAGE_GUIDE) as CheckpointId[]).find((id) => STAGE_GUIDE[id] === mentorId);
  return owned ?? null;
}
