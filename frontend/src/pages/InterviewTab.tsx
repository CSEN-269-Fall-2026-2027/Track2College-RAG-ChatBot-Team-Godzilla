import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";
import { TextField } from "../components/Form";
import { getStore } from "../data";
import type { SaveState } from "../profile";
import type { PersonalInfo } from "../types";

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  saving: "",
  saved: "",
  error: "Couldn’t save — we’ll retry on your next edit",
};

/** How many of Jordan's three saved answers are on file (for the nav ring). */
export function interviewProgress(info: PersonalInfo | null | undefined): { done: boolean; value: number } {
  const parts = [info?.birthDate, info?.birthCountry, info?.birthCity].filter((v) => !!v?.trim());
  return { done: parts.length === 3, value: parts.length / 3 };
}

function formatBirthDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso.trim();
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Answers Jordan collected in the virtual counselor call (birthday and birthplace).
 * Edits write straight to the personal_info row in Supabase — same store the UC agent reads.
 */
export function InterviewTab({ onChange }: { onChange?: (info: PersonalInfo) => void } = {}) {
  const { account } = useAuth();
  const userId = account?.id;
  const [info, setInfo] = useState<PersonalInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const draft = useRef<PersonalInfo>({});
  const timer = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!userId) {
      setInfo(null);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setLoadError(null);
    getStore()
      .then((store) => store.personalInfo.get(userId))
      .then((row) => {
        if (!live) return;
        const next = row ?? {};
        setInfo(next);
        draft.current = next;
        // Open the form when nothing is saved yet so the student can fill it in.
        if (![next.birthDate, next.birthCountry, next.birthCity].some((v) => v?.trim())) setEditing(true);
      })
      .catch((e) => {
        if (!live) return;
        setLoadError(e instanceof Error ? e.message : "Couldn't load your interview answers.");
        setInfo({});
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [userId]);

  // Flush a pending save if the student leaves mid-edit.
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const persist = useCallback(
    async (next: PersonalInfo) => {
      if (!userId) return;
      setSaveState("saving");
      try {
        await (await getStore()).personalInfo.save(userId, next);
        setSaveState("saved");
        window.setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1200);
      } catch (e) {
        console.error("[interview] Couldn't save personal info:", e);
        setSaveState("error");
      }
    },
    [userId],
  );

  const change = (patch: Partial<PersonalInfo>) => {
    const next: PersonalInfo = { ...draft.current, ...patch };
    // Drop blank strings so the UC agent doesn't get empty facts.
    for (const key of ["birthDate", "birthCountry", "birthCity"] as const) {
      const v = (next[key] ?? "").trim();
      if (v) next[key] = v;
      else delete next[key];
    }
    draft.current = next;
    setInfo(next);
    onChangeRef.current?.(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void persist(next), 400);
  };

  if (!userId) {
    return (
      <section className="pf-panel">
        <header className="pf-panel-head">
          <div className="pf-panel-title">
            <h2>Counselor interview</h2>
          </div>
        </header>
        <div className="pf-panel-body">
          <p className="pf-empty">Sign in to see answers from your call with Jordan.</p>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="pf-panel">
        <header className="pf-panel-head">
          <div className="pf-panel-title">
            <h2>Counselor interview</h2>
          </div>
        </header>
        <div className="pf-panel-body">
          <p className="pf-empty">Loading…</p>
        </div>
      </section>
    );
  }

  const birthDate = info?.birthDate?.trim() ?? "";
  const birthCountry = info?.birthCountry?.trim() ?? "";
  const birthCity = info?.birthCity?.trim() ?? "";

  return (
    <section className={`pf-panel ${editing ? "is-editing" : ""}`}>
      <header className="pf-panel-head">
        <div className="pf-panel-title">
          <h2>Counselor interview</h2>
        </div>
        {!editing && (
          <div className="pf-foot-actions">
            <button type="button" className="pf-edit" onClick={() => setEditing(true)}>
              <PencilIcon /> Edit
            </button>
          </div>
        )}
      </header>
      <div className="pf-panel-body">
        {loadError && (
          <p className="pf-empty" role="alert">
            {loadError}
          </p>
        )}
        {editing ? (
          <div className="form-grid">
            <TextField
              label="Birthday"
              type="date"
              value={birthDate}
              onChange={(v) => change({ birthDate: v })}
              autoComplete="bday"
            />
            <TextField
              label="Birth country"
              value={birthCountry}
              onChange={(v) => change({ birthCountry: v })}
              placeholder="United States"
              autoComplete="country-name"
            />
            <TextField
              label="Birth city"
              value={birthCity}
              onChange={(v) => change({ birthCity: v })}
              placeholder="Fremont"
              autoComplete="address-level2"
            />
          </div>
        ) : (
          <dl className="pf-facts">
            <div>
              <dt>Birthday</dt>
              <dd className={birthDate ? "" : "is-empty"}>{birthDate ? formatBirthDate(birthDate) : "Not added"}</dd>
            </div>
            <div>
              <dt>Birth country</dt>
              <dd className={birthCountry ? "" : "is-empty"}>{birthCountry || "Not added"}</dd>
            </div>
            <div>
              <dt>Birth city</dt>
              <dd className={birthCity ? "" : "is-empty"}>{birthCity || "Not added"}</dd>
            </div>
          </dl>
        )}
      </div>
      {editing && (
        <footer className="pf-panel-foot">
          <span className={`pf-save ${saveState}`} aria-live="polite">
            {SAVE_LABEL[saveState]}
          </span>
          <div className="pf-foot-actions">
            <button type="button" className="btn-primary pf-done-btn" onClick={() => setEditing(false)}>
              Done
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
