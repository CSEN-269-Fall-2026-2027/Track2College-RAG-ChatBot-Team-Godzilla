import { useCallback, useRef, useState } from "react";
import { ApiError, generatePiqDrafts } from "../api";
import { profileSummary, useProfile } from "../profile";
import { applyDrafts, canGeneratePiq, chosenPiqs, piqRequest, piqWorkOf } from "./piqs";

/** Generates PIQ drafts one essay (or several) at a time and saves them to the profile (shown in Materials → Essays). */
export function usePiqDrafts() {
  const { profile, update } = useProfile();
  /** PIQ ids currently being drafted. */
  const [generating, setGenerating] = useState<string[]>([]);
  const [error, setError] = useState<{ ids: string[]; message: string } | null>(null);
  /** Sync lock so a second click can't sneak through before React re-renders. */
  const busyRef = useRef(false);

  const generate = useCallback(
    async (ids: string[], opts?: { regenerate?: boolean }) => {
      if (busyRef.current) return false;

      const chosen = new Set(chosenPiqs(profile));
      const ready = ids.filter((id) => {
        if (!chosen.has(id)) return false;
        // Regenerate: keep going if this essay already has a draft (answers may have drifted).
        if (opts?.regenerate && piqWorkOf(profile, id).draft) return true;
        return canGeneratePiq(profile, id);
      });

      if (!ready.length) {
        setError({
          ids,
          message: opts?.regenerate
            ? "Couldn't regenerate that essay. Try again, or answer Quill's follow-ups first."
            : "Answer Quill's follow-up questions before generating this essay.",
        });
        return false;
      }

      busyRef.current = true;
      setGenerating(ready);
      setError(null);
      try {
        const drafts = await generatePiqDrafts(piqRequest(profile, ready), profileSummary(profile), undefined, {
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

  return {
    generate,
    busy: generating.length > 0,
    isGenerating: (id: string) => generating.includes(id),
    errorFor: (id: string) => (error?.ids.includes(id) ? error.message : null),
  };
}
