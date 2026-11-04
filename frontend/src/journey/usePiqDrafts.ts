import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, generatePiqDrafts } from "../api";
import { profileSummary, useProfile } from "../profile";
import { activitiesSummary, applyDrafts, canGeneratePiq, chosenPiqs, piqRequest, piqsToAutoDraft, piqWorkOf } from "./piqs";

interface PiqDrafts {
  generate: (ids: string[], opts?: { regenerate?: boolean }) => Promise<boolean>;
  busy: boolean;
  isGenerating: (id: string) => boolean;
  errorFor: (id: string) => string | null;
}

const PiqDraftsContext = createContext<PiqDrafts | null>(null);

/**
 * Generates PIQ drafts and saves them to the profile (shown in Profile → Essays). Shared app-wide so the
 * story, the Essays tab and auto-drafting see one "writing…" state. Once the activities step is done, every
 * chosen PIQ that has what it needs is drafted automatically — no essay questions asked.
 */
export function PiqDraftsProvider({ children }: { children: ReactNode }) {
  const { profile, update } = useProfile();
  /** PIQ ids currently being drafted. */
  const [generating, setGenerating] = useState<string[]>([]);
  const [error, setError] = useState<{ ids: string[]; message: string } | null>(null);
  /** Sync lock so a second click can't sneak through before React re-renders. */
  const busyRef = useRef(false);
  /** Auto-draft tries each PIQ once per session; after a failure the student retries by hand. */
  const autoTried = useRef(new Set<string>());

  const generate = useCallback(
    async (ids: string[], opts?: { regenerate?: boolean }) => {
      if (busyRef.current) return false;

      const chosen = new Set(chosenPiqs(profile));
      const ready = ids.filter((id) => {
        if (!chosen.has(id)) return false;
        // Regenerate: keep going if this essay already has a draft.
        if (opts?.regenerate && piqWorkOf(profile, id).draft) return true;
        return canGeneratePiq(profile, id);
      });

      if (!ready.length) {
        setError({
          ids,
          message: opts?.regenerate
            ? "Couldn't regenerate that essay. Please try again."
            : "Answer Quill's question for this prompt first — even a blank answer works.",
        });
        return false;
      }

      busyRef.current = true;
      setGenerating(ready);
      setError(null);
      try {
        const drafts = await generatePiqDrafts(piqRequest(profile, ready), profileSummary(profile), activitiesSummary(profile), undefined, {
          regenerate: !!opts?.regenerate,
        });
        update((p) => applyDrafts(p, drafts));
        return true;
      } catch (err) {
        setError({ ids: ready, message: err instanceof ApiError ? err.message : "Couldn't generate that essay. Please try again." });
        return false;
      } finally {
        busyRef.current = false;
        setGenerating([]);
      }
    },
    [profile, update],
  );

  // `generating` is a dependency so PIQs that became ready mid-request are picked up when it finishes.
  useEffect(() => {
    if (busyRef.current) return;
    const ids = piqsToAutoDraft(profile).filter((id) => !autoTried.current.has(id));
    if (!ids.length) return;
    ids.forEach((id) => autoTried.current.add(id));
    void generate(ids);
  }, [profile, generate, generating]);

  const value = useMemo<PiqDrafts>(
    () => ({
      generate,
      busy: generating.length > 0,
      isGenerating: (id) => generating.includes(id),
      errorFor: (id) => (error?.ids.includes(id) ? error.message : null),
    }),
    [generate, generating, error],
  );

  return createElement(PiqDraftsContext.Provider, { value }, children);
}

export function usePiqDrafts(): PiqDrafts {
  const value = useContext(PiqDraftsContext);
  if (!value) throw new Error("usePiqDrafts must be used inside <PiqDraftsProvider>");
  return value;
}
