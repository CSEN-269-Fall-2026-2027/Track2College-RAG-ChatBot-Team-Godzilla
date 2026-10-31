import { mentorById, type Mentor } from "./characters";

/**
 * Story-mode preferences (chosen mentor, view mode, sound, read-aloud).
 * Persisted per user in the `game_progress` table; there is no XP or scoring.
 */
export interface GameState {
  version: 1;
  mentorId: Mentor["id"];
  storyMode: boolean;
  sound: boolean;
  /** Read answers aloud with the browser's speech synthesis. */
  speech: boolean;
  updatedAt: number;
}

export function initialGameState(): GameState {
  return { version: 1, mentorId: "sage", storyMode: true, sound: true, speech: false, updatedAt: 0 };
}

/** Fills gaps in stored state from the defaults; fields from older versions (XP, quests…) are dropped. */
export function hydrateGameState(stored: Partial<GameState> | null | undefined): GameState {
  const base = initialGameState();
  if (!stored || typeof stored !== "object") return base;
  return {
    version: 1,
    mentorId: mentorById(stored.mentorId).id,
    storyMode: typeof stored.storyMode === "boolean" ? stored.storyMode : base.storyMode,
    sound: typeof stored.sound === "boolean" ? stored.sound : base.sound,
    speech: typeof stored.speech === "boolean" ? stored.speech : base.speech,
    updatedAt: typeof stored.updatedAt === "number" ? stored.updatedAt : 0,
  };
}
