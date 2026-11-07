import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, analyzeTranscript } from "./api";
import { getStore } from "./data";
import { useProfile } from "./profile";
import { newId } from "./storage";
import type { Transcript } from "./types";

export const TRANSCRIPT_TYPES = ".pdf,.txt,.csv,.md,application/pdf,text/plain,text/csv,text/markdown";
export const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024;

interface PlanningContextValue {
  transcripts: Transcript[];
  uploading: string | null;
  uploadError: string | null;
  /** Cleared on the next successful save; set when an edit/delete fails to reach Supabase. */
  saveError: string | null;
  upload: (file: File) => Promise<Transcript | null>;
  /** Create or focus a blank manual course list (upload never required). */
  ensureManualTranscript: () => Promise<Transcript>;
  updateTranscript: (transcript: Transcript) => void;
  removeTranscript: (transcript: Transcript) => void;
}

const PlanningContext = createContext<PlanningContextValue | null>(null);

const errorMessage = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);

export function validateTranscriptFile(file: File): string | null {
  if (!/\.(pdf|txt|csv|md)$/i.test(file.name)) return "Upload a PDF, TXT, CSV, or Markdown (.md) file. Photos of transcripts aren't supported yet.";
  if (file.size > MAX_TRANSCRIPT_BYTES) return "That file is larger than 5 MB.";
  if (file.size === 0) return "That file is empty.";
  return null;
}

export function PlanningProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { profile } = useProfile();
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const transcriptsRef = useRef(transcripts);
  transcriptsRef.current = transcripts;

  useEffect(() => {
    let cancelled = false;
    getStore().then(async (store) => {
      const storedTranscripts = await store.transcripts.list(userId).catch(() => []);
      if (cancelled) return;
      setTranscripts((current) => [...current, ...storedTranscripts.filter((t) => !current.some((c) => c.id === t.id))]);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const upload = useCallback(
    async (file: File) => {
      const invalid = validateTranscriptFile(file);
      if (invalid) {
        setUploadError(invalid);
        return null;
      }
      setUploading(file.name);
      setUploadError(null);
      setSaveError(null);
      try {
        const extracted = await analyzeTranscript(file);
        const draft: Transcript = { ...extracted, id: newId(), fileName: file.name, uploadedAt: Date.now(), storagePath: null };
        let saved: Transcript;
        try {
          saved = await (await getStore()).transcripts.save(userId, draft, file);
        } catch (error) {
          setUploadError(errorMessage(error, "Transcript was read, but saving to your account failed. Please try again."));
          return null;
        }
        setTranscripts((current) => [saved, ...current]);
        return saved;
      } catch (error) {
        setUploadError(errorMessage(error, "We couldn't read that transcript. Please try again."));
        return null;
      } finally {
        setUploading(null);
      }
    },
    [userId],
  );

  const ensureManualTranscript = useCallback(async () => {
    const existing = transcriptsRef.current.find((t) => t.fileName === "Manual entry") ?? transcriptsRef.current[0];
    if (existing) return existing;
    const draft: Transcript = {
      id: newId(),
      fileName: "Manual entry",
      uploadedAt: Date.now(),
      storagePath: null,
      studentName: "",
      school: profileRef.current.basics.highSchool || "",
      reportedGpa: { unweighted: "", weighted: "" },
      courses: [],
      summary: "",
      strengths: [],
      concerns: [],
    };
    setTranscripts((current) => [draft, ...current]);
    setSaveError(null);
    try {
      await (await getStore()).transcripts.save(userId, draft);
    } catch (error) {
      setSaveError(errorMessage(error, "Couldn't save the course list to your account. Edits may be lost if you leave."));
    }
    return draft;
  }, [userId]);

  const updateTranscript = useCallback(
    (transcript: Transcript) => {
      setTranscripts((current) => current.map((t) => (t.id === transcript.id ? transcript : t)));
      setSaveError(null);
      getStore()
        .then((store) => store.transcripts.save(userId, transcript))
        .catch((error) => {
          setSaveError(errorMessage(error, "Couldn't save transcript changes to your account. Please try again."));
        });
    },
    [userId],
  );

  const removeTranscript = useCallback(
    (transcript: Transcript) => {
      setTranscripts((current) => current.filter((t) => t.id !== transcript.id));
      setSaveError(null);
      getStore()
        .then((store) => store.transcripts.remove(userId, transcript))
        .catch((error) => {
          setSaveError(errorMessage(error, "Couldn't delete that transcript from your account. Please try again."));
        });
    },
    [userId],
  );

  const value = useMemo(
    () => ({
      transcripts,
      uploading,
      uploadError,
      saveError,
      upload,
      ensureManualTranscript,
      updateTranscript,
      removeTranscript,
    }),
    [transcripts, uploading, uploadError, saveError, upload, ensureManualTranscript, updateTranscript, removeTranscript],
  );
  return <PlanningContext.Provider value={value}>{children}</PlanningContext.Provider>;
}

export function usePlanning(): PlanningContextValue {
  const value = useContext(PlanningContext);
  if (!value) throw new Error("usePlanning must be used inside <PlanningProvider>");
  return value;
}
