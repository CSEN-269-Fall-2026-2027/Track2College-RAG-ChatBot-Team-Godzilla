import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, analyzeProfile } from "./api";
import { getStore } from "./data";
import { profileHash, profileSummary, useProfile } from "./profile";
import type { ProfileAnalysis } from "./types";

interface AnalysisContextValue {
  analysis: ProfileAnalysis | null;
  running: boolean;
  error: string | null;
  stale: boolean;
  run: () => void;
  cancel: () => void;
}

const AnalysisContext = createContext<AnalysisContextValue | null>(null);

export function AnalysisProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { profile } = useProfile();
  const [analysis, setAnalysis] = useState<ProfileAnalysis | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  useEffect(() => {
    let cancelled = false;
    getStore()
      .then((store) => store.analyses.get(userId))
      .then((stored) => {
        if (!cancelled && stored) setAnalysis((current) => current ?? stored);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      controllerRef.current?.abort();
    };
  }, [userId]);

  const run = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const snapshot = profileRef.current;
    setRunning(true);
    setError(null);
    try {
      const result = await analyzeProfile(
        profileSummary(snapshot),
        snapshot.colleges.map((c) => c.name),
        snapshot.goals.majors,
        controller.signal,
      );
      const saved: ProfileAnalysis = { ...result, generatedAt: Date.now(), profileHash: profileHash(snapshot) };
      setAnalysis(saved);
      (await getStore()).analyses.save(userId, saved).catch(() => {});
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof ApiError ? err.message : "The analysis couldn't be generated. Please try again.");
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setRunning(false);
      }
    }
  }, [userId]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setRunning(false);
  }, []);

  const currentHash = useMemo(() => profileHash(profile), [profile]);
  const stale = analysis !== null && analysis.profileHash !== currentHash;

  const value = useMemo(
    () => ({ analysis, running, error, stale, run, cancel }),
    [analysis, running, error, stale, run, cancel],
  );
  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}

export function useAnalysis(): AnalysisContextValue {
  const value = useContext(AnalysisContext);
  if (!value) throw new Error("useAnalysis must be used inside <AnalysisProvider>");
  return value;
}
