export const API_BASE = (import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

export interface ChatResponse {
  session_id: string;
  answer: string;
  sources: string[];
  raw_response: string;
  response_time_ms: number;
  timestamp_utc: string;
}

export class ApiError extends Error {}

export async function sendChat(
  query: string,
  sessionId: string | null,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, session_id: sessionId }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(`Couldn't reach the Track2College server at ${API_BASE}. Make sure the API is running.`);
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
