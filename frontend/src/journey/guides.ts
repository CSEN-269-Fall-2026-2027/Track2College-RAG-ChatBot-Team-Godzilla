import { useMemo } from "react";
import type { Mentor } from "../game/characters";
import { usePlanning } from "../planning";
import { academicHistoryStatus, completeness, useProfile } from "../profile";
import { computeJourney, type CheckpointId } from "./logic";

/**
 * Each guide owns a level of the UC journey. Story mode's chat is with the guide of the level
 * the student is on, so on the final step (Review & Apply) they're talking to Sage.
 * Build Your Profile has no guide of its own; Sage, the general admissions guide, covers it.
 */
export const STAGE_GUIDE: Record<CheckpointId, Mentor["id"]> = {
  profile: "sage",
  ucs: "penny",
  activities: "milo",
  essays: "quill",
  review: "sage",
};

/** The level the student is on (Review & Apply once everything is done), from the same rules as the map. */
export function useCurrentStage(): CheckpointId {
  const { profile } = useProfile();
  const { transcripts } = usePlanning();
  return useMemo(() => {
    const journey = computeJourney(profile, completeness(profile).sections, academicHistoryStatus(profile, transcripts).started);
    return journey.finished ? "review" : journey.checkpoints[journey.current].id;
  }, [profile, transcripts]);
}
