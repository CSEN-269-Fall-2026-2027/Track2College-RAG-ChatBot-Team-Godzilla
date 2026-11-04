import type { AgArea, CourseLevel, CoursePlan, Fit, ProfileAnalysis, Transcript, TranscriptCourse } from "./types";

export const API_BASE = (import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

let accessToken: string | null = null;

/** Set by the auth provider so API calls carry the signed-in user's token (Supabase JWT when enabled). */
export function setAccessToken(token: string | null) {
  accessToken = token;
}

export interface ChatResponse {
  session_id: string;
  answer: string;
  sources: string[];
  raw_response: string;
  response_time_ms: number;
  timestamp_utc: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly offline = false,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(`Couldn't reach the Track2College server at ${API_BASE}. Make sure the API is running.`, true);
  }

  if (!response.ok) {
    let detail = `The server returned an error (${response.status}).`;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // Non-JSON error body; keep the status-based message.
    }
    throw new ApiError(detail);
  }

  return response.json();
}

export function sendChat(
  query: string,
  sessionId: string | null,
  profileContext: string | null,
  signal?: AbortSignal,
  persona: string | null = null,
  mode: string | null = null,
): Promise<ChatResponse> {
  return post("/chat", { query, session_id: sessionId, profile_context: profileContext || null, persona, mode }, signal);
}

export function analyzeProfile(
  profileSummary: string,
  colleges: string[],
  majors: string[],
  signal?: AbortSignal,
): Promise<Omit<ProfileAnalysis, "generatedAt" | "profileHash">> {
  return post<{
    summary: string;
    strengths: string[];
    gaps: string[];
    colleges: { name: string; fit: Fit; reasoning: string; sources: string[] }[];
    actions: { title: string; detail: string; timeframe: string }[];
  }>("/profile/analysis", { profile_summary: profileSummary, colleges, majors }, signal);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

interface TranscriptResponse {
  student_name: string;
  school: string;
  reported_gpa: { unweighted: string; weighted: string };
  courses: { name: string; grade_level: TranscriptCourse["gradeLevel"]; term: string; grade: string; level: CourseLevel; area: AgArea; semesters: number }[];
  summary: string;
  strengths: string[];
  concerns: string[];
}

export async function analyzeTranscript(
  file: File,
  signal?: AbortSignal,
): Promise<Omit<Transcript, "id" | "fileName" | "uploadedAt" | "storagePath">> {
  const result = await post<TranscriptResponse>(
    "/transcript/analyze",
    { file_name: file.name, mime_type: file.type, content_base64: await fileToBase64(file) },
    signal,
  );
  return {
    studentName: result.student_name,
    school: result.school,
    reportedGpa: result.reported_gpa,
    courses: result.courses.map((c) => ({
      id: crypto.randomUUID(),
      name: c.name,
      gradeLevel: c.grade_level,
      term: c.term,
      grade: c.grade,
      level: c.level,
      area: c.area,
      semesters: c.semesters,
    })),
    summary: result.summary,
    strengths: result.strengths,
    concerns: result.concerns,
  };
}

export interface CoursePlanRequest {
  college: string;
  major: string;
  gradeLevel: string;
  completedCourses: { name: string; gradeLevel: string; level: CourseLevel; area: AgArea; grade: string }[];
  profileSummary: string;
}

export function buildCoursePlan(
  input: CoursePlanRequest,
  signal?: AbortSignal,
): Promise<Omit<CoursePlan, "id" | "createdAt" | "college" | "major">> {
  return post(
    "/plan/courses",
    {
      college: input.college,
      major: input.major,
      grade_level: input.gradeLevel,
      completed_courses: input.completedCourses.map((c) => ({
        name: c.name,
        grade_level: c.gradeLevel,
        level: c.level,
        area: c.area,
        grade: c.grade,
      })),
      profile_summary: input.profileSummary,
    },
    signal,
  );
}

export interface EssayResult {
  title: string;
  essay: string;
  ideas: { title: string; angle: string; why_it_fits: string }[];
  tips: string[];
}

export function generateEssay(
  prompt: string,
  profileSummary: string,
  mode: "draft" | "ideas",
  signal?: AbortSignal,
): Promise<EssayResult> {
  return post("/essay/generate", { prompt, profile_summary: profileSummary, mode }, signal);
}

export interface PiqDraftResult {
  id: string;
  question: string;
  essay: string;
  wordCount: number;
}

/** Drafts the chosen UC PIQs (≤350 words each) from the profile, activities, and any personal answers. */
export async function generatePiqDrafts(
  piqs: { id: string; answers: { question: string; answer: string }[] }[],
  profileSummary: string,
  activities: string,
  signal?: AbortSignal,
  opts?: { regenerate?: boolean },
): Promise<PiqDraftResult[]> {
  const result = await post<{ essays: { id: string; question: string; essay: string; word_count: number }[] }>(
    "/essay/piqs",
    { piqs, profile_summary: profileSummary, activities, regenerate: !!opts?.regenerate },
    signal,
  );
  return result.essays.map((e) => ({ id: e.id, question: e.question, essay: e.essay, wordCount: e.word_count }));
}

export interface FoundCounselor {
  name: string;
  title: string;
  email: string;
  /** Who they're assigned to, as the school's page says it (e.g. a last-name range). */
  serves: string;
  /** The model judged this counselor covers the student. */
  match: boolean;
  sourceUrl: string;
}

/** Searches the web for the counselors at the student's high school. */
export async function findCounselors(
  school: { highSchool: string; city: string; state: string; lastName: string },
  signal?: AbortSignal,
): Promise<FoundCounselor[]> {
  const result = await post<{ counselors: (Omit<FoundCounselor, "sourceUrl"> & { source_url: string })[] }>(
    "/agent/counselor/find",
    { high_school: school.highSchool, city: school.city, state: school.state, last_name: school.lastName },
    signal,
  );
  return result.counselors.map(({ source_url, ...c }) => ({ ...c, sourceUrl: source_url }));
}

/** Drafts the student's email to their counselor. Nothing is sent. */
export function draftCounselorEmail(
  counselorName: string,
  studentName: string,
  profileSummary: string,
  callTranscript = "",
  signal?: AbortSignal,
): Promise<{ subject: string; body: string }> {
  return post(
    "/agent/counselor/email",
    { counselor_name: counselorName, student_name: studentName, profile_summary: profileSummary, call_transcript: callTranscript },
    signal,
  );
}

/** A one-time token for a voice call with the practice counselor (ElevenLabs); the key stays on the server. */
export async function startCounselorCall(signal?: AbortSignal): Promise<string> {
  return (await post<{ conversation_token: string }>("/agent/counselor/voice", {}, signal)).conversation_token;
}

/** Why a counselor call ended before Jordan said anything (e.g. out of credits), or null. */
export async function counselorCallProblem(conversationId: string): Promise<string | null> {
  return (await post<{ problem: string | null }>("/agent/counselor/voice/problem", { conversation_id: conversationId })).problem;
}

export type UcRunStatus =
  | "opening"
  | "waiting"
  | "submitted"
  | "signing_in"
  | "login_failed"
  | "needs_code"
  | "checking_code"
  | "verified"
  | "setting_up"
  | "ready"
  | "signed_in"
  | "filling"
  | "needs_you"
  | "about_done"
  | "piq_done"
  | "closed"
  | "disconnected"
  | "error";

export interface UcRun {
  status: UcRunStatus;
  detail: string;
  mode: "login" | "create";
  /** Where the browser runs: a window on this computer, or a Browserbase session. */
  browser?: UcBrowser;
  /** Cloud only: Browserbase's live view, where the student sees and uses the UC window. */
  live_url?: string | null;
  /** The page the UC window is on (the cloud panel's address bar). */
  page_url?: string;
  /** The assistant filled every field it can; the student reviews and submits on UC. */
  finished?: boolean;
  /** The UC window is still open on the student's screen. */
  open: boolean;
  /** Milestones reached in this window, for saving to the profile. */
  created: boolean;
  verified: boolean;
  setup: boolean;
  /** UC's "About you" category is finished. */
  about: boolean;
  /** What filling "About you" did, in UC's own field labels. */
  about_report: { filled: { label: string; value: string }[]; missing: string[]; check: string[] };
  /** The student's personal insight answers were entered on UC. */
  piq: boolean;
  /** Personal insight questions entered this run, and ones left alone (with why). */
  piq_report: { entered: string[]; skipped: string[]; removed?: string[] };
}

/** A chosen personal insight question (UC's numbering, 1–8) and the student's saved answer. */
export interface UcPiq {
  number: number;
  title: string;
  text: string;
}

/** "local": a Chrome window on this computer. "cloud": a Browserbase browser the student uses through its live view. */
export type UcBrowser = "local" | "cloud";

/** Stops the UC run; in cloud mode the server releases the Browserbase session. */
export async function cancelUcAccount(runId: string): Promise<void> {
  await post(`/agent/uc-account/cancel/${encodeURIComponent(runId)}`, {});
}

/** The UC window that's open right now (e.g. from before the popup was closed), or null. */
export async function activeUcRun(): Promise<{ runId: string; run: UcRun } | null> {
  try {
    const response = await fetch(`${API_BASE}/agent/uc-account/active`);
    if (!response.ok) return null;
    const data = (await response.json()) as { run_id: string | null; run: UcRun | null };
    return data.run_id && data.run ? { runId: data.run_id, run: data.run } : null;
  } catch {
    return null;
  }
}

/** Stops any open run and closes every cloud browser this app left running. */
export async function closeCloudBrowsers(): Promise<{ stopped_run: boolean; closed_sessions: number }> {
  return post("/agent/uc-account/close-cloud", {});
}

/** Types the student's UC verification code into the open UC window. */
export async function submitUcCode(runId: string, code: string): Promise<void> {
  await post(`/agent/uc-account/code/${encodeURIComponent(runId)}`, { code });
}

/** Opens the UC application in a browser window on this computer and signs in or fills in sign-up. */
export async function startUcAccount(
  email: string,
  password: string,
  mode: "login" | "create",
  facts: Record<string, string> = {},
  aboutDone = false,
  /** UC already verified this account, so its emailed-code screen won't appear again. */
  verified = false,
  piqs: UcPiq[] = [],
  browser: UcBrowser = "local",
): Promise<string> {
  const result = await post<{ run_id: string }>("/agent/uc-account/start", {
    email,
    password,
    mode,
    facts,
    about_done: aboutDone,
    verified,
    piqs,
    browser,
  });
  return result.run_id;
}

export async function ucAccountStatus(runId: string, signal?: AbortSignal): Promise<UcRun> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/agent/uc-account/status/${encodeURIComponent(runId)}`, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(`Couldn't reach the Track2College server at ${API_BASE}.`, true);
  }
  if (!response.ok) throw new ApiError("Lost track of the UC window. Start again.");
  return response.json();
}

export async function clearSession(sessionId: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/chat/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  } catch {
    // Server-side memory is ephemeral; failing to clear it is harmless.
  }
}

export async function checkHealth(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/health`, { signal });
    return response.ok;
  } catch {
    return false;
  }
}
