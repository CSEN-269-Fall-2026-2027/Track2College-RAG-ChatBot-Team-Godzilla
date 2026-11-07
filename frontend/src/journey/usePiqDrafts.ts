import { createContext, createElement, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, generatePiqDrafts } from "../api";
import { profileSummary, useProfile } from "../profile";
import { activitiesSummary, applyDrafts, canGeneratePiq, chosenPiqs, limitWords, piqRequest, piqWorkOf } from "./piqs";

interface PiqDrafts {
  generate: (ids: string[], opts?: { regenerate?: boolean }) => Promise<boolean>;
  /** Writes one essay without saving it, so Quill can show it in the chat. Null if it was cancelled. */
  write: (id: string, opts?: { regenerate?: boolean; signal?: AbortSignal }) => Promise<{ text: string } | { error: string } | null>;
  /** The essay to open for editing in Profile → Essays. */
  editRequest: string | null;
  requestEdit: (id: string | null) => void;
  busy: boolean;
  /** Being written and saved by Generate. */
  isGenerating: (id: string) => boolean;
  /** Being written into Quill's chat by Brainstorm. */
  isBrainstorming: (id: string) => boolean;
  errorFor: (id: string) => string | null;
}

const PiqDraftsContext = createContext<PiqDrafts | null>(null);

/**
 * Generates PIQ drafts and saves them to the profile (shown in Profile → Essays). Shared app-wide so the
 * story, Quill's chat and the Essays tab see one "writing…" state. Essays are only written when the student asks.
 */
export function PiqDraftsProvider({ children }: { children: ReactNode }) {
  const { profile, update } = useProfile();
  /** PIQ ids currently being drafted. */
  const [generating, setGenerating] = useState<string[]>([]);
  const [brainstorming, setBrainstorming] = useState<string | null>(null);
  const [error, setError] = useState<{ ids: string[]; message: string } | null>(null);
  const [editRequest, requestEdit] = useState<string | null>(null);
  /** Sync lock so a second click can't sneak through before React re-renders. */
  const busyRef = useRef(false);

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
            : "Pick this question first, then try again.",
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

  const write = useCallback<PiqDrafts["write"]>(
    async (id, opts) => {
      if (busyRef.current) return null;
      busyRef.current = true;
      setBrainstorming(id);
      try {
        const [draft] = await generatePiqDrafts(piqRequest(profile, [id]), profileSummary(profile), activitiesSummary(profile), opts?.signal, {
          regenerate: !!opts?.regenerate,
        });
        return { text: limitWords(draft.essay) };
      } catch (err) {
        if (opts?.signal?.aborted) return null;
        return { error: err instanceof ApiError ? err.message : "Couldn't write that essay. Please try again." };
      } finally {
        busyRef.current = false;
        setBrainstorming(null);
      }
    },
    [profile],
  );

  const value = useMemo<PiqDrafts>(
    () => ({
      generate,
      write,
      editRequest,
      requestEdit,
      busy: generating.length > 0 || brainstorming !== null,
      isGenerating: (id) => generating.includes(id),
      isBrainstorming: (id) => brainstorming === id,
      errorFor: (id) => (error?.ids.includes(id) ? error.message : null),
    }),
    [generate, write, editRequest, generating, brainstorming, error],
  );

  return createElement(PiqDraftsContext.Provider, { value }, children);
}

export function usePiqDrafts(): PiqDrafts {
  const value = useContext(PiqDraftsContext);
  if (!value) throw new Error("usePiqDrafts must be used inside <PiqDraftsProvider>");
  return value;
}
