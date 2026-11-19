import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getGoogleStatus, suggestGoogleActivities, type GoogleActivitySuggestion } from "./api";

type ScanStatus = "idle" | "scanning" | "ready" | "error";

interface GoogleActivitiesContextValue {
  suggestions: GoogleActivitySuggestion[];
  status: ScanStatus;
  error: string | null;
  /** Run a scan. Default is once per sign-in session; `force` refreshes from Google. */
  scan: (opts?: { force?: boolean }) => Promise<GoogleActivitySuggestion[]>;
}

const GoogleActivitiesContext = createContext<GoogleActivitiesContextValue | null>(null);

function storageKey(userId: string) {
  return `t2c.googleActivities.${userId}`;
}

function loadSession(userId: string): { scanned: boolean; suggestions: GoogleActivitySuggestion[] } {
  try {
    const raw = sessionStorage.getItem(storageKey(userId));
    if (!raw) return { scanned: false, suggestions: [] };
    const parsed = JSON.parse(raw) as { scanned?: boolean; suggestions?: GoogleActivitySuggestion[] };
    return {
      scanned: !!parsed.scanned,
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    };
  } catch {
    return { scanned: false, suggestions: [] };
  }
}

function saveSession(userId: string, suggestions: GoogleActivitySuggestion[]) {
  try {
    sessionStorage.setItem(storageKey(userId), JSON.stringify({ scanned: true, suggestions }));
  } catch {
    /* private mode / quota */
  }
}

export function GoogleActivitiesProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const cached = useMemo(() => loadSession(userId), [userId]);
  const [suggestions, setSuggestions] = useState<GoogleActivitySuggestion[]>(cached.suggestions);
  const [status, setStatus] = useState<ScanStatus>(cached.scanned ? "ready" : "idle");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const autoStarted = useRef(false);

  const scan = useCallback(async (opts?: { force?: boolean }) => {
    if (inFlight.current) return loadSession(userId).suggestions;
    inFlight.current = true;
    setStatus("scanning");
    setError(null);
    try {
        const google = await getGoogleStatus();
        if (!google.connected) {
          // Don't mark the session scanned — retry after Connect Google.
          setSuggestions([]);
          setStatus("ready");
          return [];
        }
      const items = await suggestGoogleActivities();
      setSuggestions(items);
      saveSession(userId, items);
      setStatus("ready");
      return items;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't scan Google.";
      setError(message);
      setStatus("error");
      if (opts?.force) saveSession(userId, []);
      return [];
    } finally {
      inFlight.current = false;
    }
  }, [userId]);

  // Once per sign-in session (sessionStorage), when Google is connected.
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    const existing = loadSession(userId);
    if (existing.scanned) {
      setSuggestions(existing.suggestions);
      setStatus("ready");
      return;
    }
    void scan();
  }, [userId, scan]);

  const value = useMemo(
    () => ({ suggestions, status, error, scan }),
    [suggestions, status, error, scan],
  );

  return <GoogleActivitiesContext.Provider value={value}>{children}</GoogleActivitiesContext.Provider>;
}

export function useGoogleActivities() {
  const ctx = useContext(GoogleActivitiesContext);
  if (!ctx) throw new Error("useGoogleActivities requires GoogleActivitiesProvider");
  return ctx;
}
