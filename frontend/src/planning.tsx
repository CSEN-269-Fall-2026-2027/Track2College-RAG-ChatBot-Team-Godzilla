import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, analyzeTranscript, buildCoursePlan } from "./api";
import { getStore } from "./data";
import { profileSummary, useProfile } from "./profile";
import { newId } from "./storage";
import type { CoursePlan, Transcript } from "./types";

export const TRANSCRIPT_TYPES = ".pdf,.txt,.csv,.md,application/pdf,text/plain,text/csv,text/markdown";
export const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024;

interface PlanningContextValue {
  transcripts: Transcript[];
  uploading: string | null;
  uploadError: string | null;
  upload: (file: File) => Promise<Transcript | null>;
  /** Create or focus a blank manual course list (upload never required). */
  ensureManualTranscript: () => Promise<Transcript>;
  updateTranscript: (transcript: Transcript) => void;
  removeTranscript: (transcript: Transcript) => void;
  plans: CoursePlan[];
  planning: string | null;
  planError: string | null;
  buildPlan: (college: string, major: string) => Promise<CoursePlan | null>;
  removePlan: (id: string) => void;
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
  const [plans, setPlans] = useState<CoursePlan[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [planning, setPlanning] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const transcriptsRef = useRef(transcripts);
  transcriptsRef.current = transcripts;

  useEffect(() => {
    let cancelled = false;
    getStore().then(async (store) => {
      const [storedTranscripts, storedPlans] = await Promise.all([
        store.transcripts.list(userId).catch(() => []),
        store.coursePlans.list(userId).catch(() => []),
      ]);
      if (cancelled) return;
      setTranscripts((current) => [...current, ...storedTranscripts.filter((t) => !current.some((c) => c.id === t.id))]);
      setPlans((current) => [...current, ...storedPlans.filter((p) => !current.some((c) => c.id === p.id))]);
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
    try {
      await (await getStore()).transcripts.save(userId, draft);
    } catch {
      // Local list still usable; autosave retries on edit.
    }
    return draft;
  }, [userId]);

  const updateTranscript = useCallback(
    (transcript: Transcript) => {
      setTranscripts((current) => current.map((t) => (t.id === transcript.id ? transcript : t)));
      getStore().then((store) => store.transcripts.save(userId, transcript)).catch(() => {});
    },
    [userId],
  );

  const removeTranscript = useCallback(
    (transcript: Transcript) => {
      setTranscripts((current) => current.filter((t) => t.id !== transcript.id));
      getStore().then((store) => store.transcripts.remove(userId, transcript)).catch(() => {});
    },
    [userId],
  );

  const buildPlan = useCallback(
    async (college: string, major: string) => {
      const p = profileRef.current;
      const latest = transcriptsRef.current[0];
      setPlanning(college);
      setPlanError(null);
      try {
        const result = await buildCoursePlan({
          college,
          major,
          gradeLevel: p.basics.gradeLevel,
          completedCourses: (latest?.courses ?? []).map(({ name, gradeLevel, level, area, grade }) => ({ name, gradeLevel, level, area, grade })),
          profileSummary: profileSummary(p),
        });
        const plan: CoursePlan = { ...result, id: newId(), college, major, createdAt: Date.now() };
        setPlans((current) => [plan, ...current.filter((x) => x.college.toLowerCase() !== college.toLowerCase())]);
        const store = await getStore();
        const replaced = plans.filter((x) => x.college.toLowerCase() === college.toLowerCase());
        await Promise.all([store.coursePlans.save(userId, plan), ...replaced.map((x) => store.coursePlans.remove(userId, x.id))]).catch(() => {});
        return plan;
      } catch (error) {
        setPlanError(errorMessage(error, "The course plan couldn't be generated. Please try again."));
        return null;
      } finally {
        setPlanning(null);
      }
    },
    [userId, plans],
  );

  const removePlan = useCallback(
    (id: string) => {
      setPlans((current) => current.filter((p) => p.id !== id));
      getStore().then((store) => store.coursePlans.remove(userId, id)).catch(() => {});
    },
    [userId],
  );

  const value = useMemo(
    () => ({
      transcripts,
      uploading,
      uploadError,
      upload,
      ensureManualTranscript,
      updateTranscript,
      removeTranscript,
      plans,
      planning,
      planError,
      buildPlan,
      removePlan,
    }),
    [
      transcripts,
      uploading,
      uploadError,
      upload,
      ensureManualTranscript,
      updateTranscript,
      removeTranscript,
      plans,
      planning,
      planError,
      buildPlan,
      removePlan,
    ],
  );
  return <PlanningContext.Provider value={value}>{children}</PlanningContext.Provider>;
}

export function usePlanning(): PlanningContextValue {
  const value = useContext(PlanningContext);
  if (!value) throw new Error("usePlanning must be used inside <PlanningProvider>");
  return value;
}
