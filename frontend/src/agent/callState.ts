/**
 * Pure helpers for the video-call view of the Jordan voice call. They only describe what the
 * existing ElevenLabs session is doing; none of them start, steer or end the conversation.
 */

export type CallPhase = "idle" | "connecting" | "live" | "ended" | "error";

export interface PhaseInput {
  /** The call window is open. */
  joined: boolean;
  /** Mic check / token fetch in progress, before the SDK session starts. */
  starting: boolean;
  status: string;
  error: string | null;
  /** This join reached "connected" at least once. */
  hadSession: boolean;
}

export function callPhase({ joined, starting, status, error, hadSession }: PhaseInput): CallPhase {
  if (status === "connected") return "live";
  if (starting || status === "connecting") return "connecting";
  if (!joined) return "idle";
  // A call that connected and then dropped has ended (the overlay shows the error), not failed to start.
  if (hadSession) return "ended";
  return error ? "error" : "connecting";
}

export type Presence = "connecting" | "listening" | "thinking" | "speaking" | "ended" | "error" | "idle";

/**
 * What Jordan is doing right now. Speaking comes straight from the SDK's playback mode;
 * thinking is the gap between the student's finished turn and Jordan's reply.
 */
export function presence(phase: CallPhase, isSpeaking: boolean, thinking: boolean): Presence {
  if (phase !== "live") return phase;
  if (isSpeaking) return "speaking";
  if (thinking) return "thinking";
  return "listening";
}

export const PRESENCE_LABEL: Record<Presence, string> = {
  idle: "Not in a call",
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  ended: "Call ended",
  error: "Couldn't connect",
};

/** Mouth frame for the current output level: 0 closed, 1 half open, 2 open. */
export function mouthFrame(level: number): 0 | 1 | 2 {
  if (level < 0.035) return 0;
  return level < 0.16 ? 1 : 2;
}

/** Keep following new lines only while the reader is already near the bottom. */
export function nearBottom(scrollHeight: number, scrollTop: number, clientHeight: number, threshold = 72): boolean {
  return scrollHeight - scrollTop - clientHeight < threshold;
}

/**
 * Typed replies are added to the transcript when sent. If the server ever echoes one back as a
 * user transcript, `consume` swallows that echo so the line isn't shown or saved twice.
 */
export class TypedEchoFilter {
  private pending: string[] = [];

  add(text: string) {
    this.pending.push(normalize(text));
    if (this.pending.length > 8) this.pending.shift();
  }

  /** True when `text` is the echo of a typed reply (and forgets it). */
  consume(text: string): boolean {
    const i = this.pending.indexOf(normalize(text));
    if (i === -1) return false;
    this.pending.splice(i, 1);
    return true;
  }

  clear() {
    this.pending = [];
  }
}

function normalize(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * How long after Jordan finishes the goodbye line before the call hangs up on its own. Jordan has
 * no end_call tool, so this pause is the only hang-up; it stays under ElevenLabs' ~7 s silence
 * prompt ("Are you still there?").
 */
export const WRAP_UP_HANGUP_MS = 4000;

/**
 * Jordan's scripted goodbye (backend/voice.py, step 5). Spotting it lets the call hang up a
 * moment after Jordan finishes, before the agent's "Are you still there?" silence prompt.
 */
export function isWrapUpLine(text: string): boolean {
  return /thanks so much for talking with me today/i.test(text) && /go ahead with your uc application/i.test(text);
}
