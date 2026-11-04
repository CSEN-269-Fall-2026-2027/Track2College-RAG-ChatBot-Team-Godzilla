import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getStore } from "../data";
import { readJSON, userKey, writeJSON } from "../storage";
import { mentorById, type Mentor } from "./characters";
import { hydrateGameState, type GameState } from "./progress";

type Settings = Pick<GameState, "mentorId" | "sound" | "speech">;

interface GameContextValue {
  state: GameState;
  mentor: Mentor;
  updateSettings: (change: Partial<Settings>) => void;
}

const GameContext = createContext<GameContextValue | null>(null);
const SAVE_DELAY_MS = 800;

/** Holds Story-mode preferences: chosen mentor, sound and read-aloud. */
export function GameProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const localKey = userKey(userId, "game");
  // Local copy renders instantly and covers projects that haven't run the game_progress migration yet.
  const [state, setState] = useState<GameState>(() => hydrateGameState(readJSON(localKey, null)));
  const [loaded, setLoaded] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const savedAt = useRef(state.updatedAt);

  useEffect(() => {
    let cancelled = false;
    getStore()
      .then((store) => store.game.get(userId))
      .catch(() => null)
      .then((remote) => {
        if (cancelled) return;
        if (remote && (remote.updatedAt ?? 0) > stateRef.current.updatedAt) {
          const next = hydrateGameState(remote);
          savedAt.current = next.updatedAt;
          setState(next);
        }
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    writeJSON(localKey, state);
    if (!loaded || state.updatedAt === savedAt.current) return;
    const id = window.setTimeout(() => {
      savedAt.current = state.updatedAt;
      getStore()
        .then((store) => store.game.save(userId, state))
        .catch(() => {
          // Table missing or offline; localStorage keeps settings until the next save.
        });
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [userId, localKey, loaded, state]);

  const updateSettings = useCallback((change: Partial<Settings>) => {
    setState((prev) => ({ ...prev, ...change, updatedAt: Date.now() }));
  }, []);

  const value = useMemo<GameContextValue>(
    () => ({ state, mentor: mentorById(state.mentorId), updateSettings }),
    [state, updateSettings],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const value = useContext(GameContext);
  if (!value) throw new Error("useGame must be used inside <GameProvider>");
  return value;
}
