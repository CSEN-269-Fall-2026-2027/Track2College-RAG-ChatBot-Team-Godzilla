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
): Promise<ChatResponse> {
  return post("/chat", { query, session_id: sessionId, profile_context: profileContext || null }, signal);
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
