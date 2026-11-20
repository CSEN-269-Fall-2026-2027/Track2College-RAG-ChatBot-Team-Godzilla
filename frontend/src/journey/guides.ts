import { useMemo } from "react";
import type { Mentor } from "../game/characters";
import { usePlanning } from "../planning";
import { academicHistoryStatus, completeness, useProfile } from "../profile";
import { computeJourney, type CheckpointId } from "./logic";

/**
 * Each guide owns a level of the UC journey. Story mode's chat is with the guide of the level
 * the student is on: Theo for choosing campuses, the Counselor for meeting your counselors, the
 * Application assistant for applying. Penny has no stop: after Apply the student is done and can
 * chat with any guide.
 * Basic Info has no guide of its own; Sage, the general admissions guide, covers it.
 */
export const STAGE_GUIDE: Record<CheckpointId, Mentor["id"]> = {
  profile: "sage",
  ucs: "theo",
  activities: "milo",
  essays: "quill",
  counselor: "counselor",
  apply: "assistant",
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

/** The whole journey is done (the application is in): from here the student can chat with any guide. */
export function useJourneyFinished(): boolean {
  const { profile } = useProfile();
  const { transcripts } = usePlanning();
  return useMemo(
    () => computeJourney(profile, completeness(profile).sections, academicHistoryStatus(profile, transcripts).started).finished,
    [profile, transcripts],
  );
}
