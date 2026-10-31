import { useEffect, useRef, useState } from "react";
import {
  ConversationProvider,
  useConversationControls,
  useConversationMode,
  useConversationStatus,
  type MessagePayload,
} from "@elevenlabs/react";
import { startCounselorCall } from "../api";
import { cleanTranscriptLine } from "./logic";
import { StopIcon } from "../components/icons";
import type { CallLine, PersonalInfo } from "../types";

interface VoiceCounselorProps {
  studentName: string;
  profileSummary: string;
  /** UC's deadline, spoken by the counselor (e.g. "November 30, 2026"). */
  ucDeadline: string;
  /** Year the student would start at UC, for the start-term question. */
  entryYear: number;
  lastCall?: { endedAt: number; lines: CallLine[] };
  /** Called when a call ends in which the student said something. */
  onEnd: (lines: CallLine[]) => void;
  /** Called when Jordan saves the student's birthday or birthplace. */
  onPersonalInfo: (info: PersonalInfo) => void;
}

const BIRTH_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A voice call with Jordan, the ElevenLabs counselor. Jordan runs through what a school
 * counselor asks in a senior meeting; the student can start and stop whenever they like.
 */
export function VoiceCounselor(props: VoiceCounselorProps) {
  return (
    <ConversationProvider>
      <Call {...props} />
    </ConversationProvider>
  );
}

function Call({ studentName, profileSummary, ucDeadline, entryYear, lastCall, onEnd, onPersonalInfo }: VoiceCounselorProps) {
  const { startSession, endSession, getInputVolume, getOutputVolume } = useConversationControls();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const [lines, setLines] = useState<CallLine[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linesRef = useRef<CallLine[]>([]);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onPersonalInfoRef = useRef(onPersonalInfo);
  onPersonalInfoRef.current = onPersonalInfo;
  const logRef = useRef<HTMLOListElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);

  const connected = status === "connected";
  const live = connected || status === "connecting" || starting;

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  // Leaving the page hangs up.
  useEffect(() => () => endSession(), [endSession]);

  // The orb follows whoever is talking. Written straight to a CSS variable so it doesn't re-render.
  useEffect(() => {
    const orb = orbRef.current;
    if (!connected || !orb) return;
    let frame = 0;
    let level = 0;
    const tick = () => {
      const volume = isSpeaking ? getOutputVolume() : getInputVolume();
      level += (Math.min(1, volume * 2.5) - level) * 0.25;
      orb.style.setProperty("--level", level.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      orb.style.setProperty("--level", "0");
    };
  }, [connected, isSpeaking, getInputVolume, getOutputVolume]);

  const start = async () => {
    setError(null);
    setStarting(true);
    linesRef.current = [];
    setLines([]);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => stream.getTracks().forEach((t) => t.stop()));
    } catch {
      setStarting(false);
      setError("Allow microphone access in your browser to talk with Jordan.");
      return;
    }
    try {
      const conversationToken = await startCounselorCall();
      startSession({
        conversationToken,
        connectionType: "webrtc",
        dynamicVariables: {
          student_name: studentName || "there",
          student_profile: profileSummary || "(nothing yet)",
          uc_deadline: ucDeadline,
          entry_year: String(entryYear),
        },
        // Jordan calls these (see backend/voice.py) once the student has answered.
        clientTools: {
          save_birth_date: ({ birth_date }: { birth_date?: string }) => {
            const birthDate = String(birth_date ?? "").trim();
            if (BIRTH_DATE_RE.test(birthDate)) onPersonalInfoRef.current({ birthDate });
          },
          save_birthplace: ({ birth_country, birth_city }: { birth_country?: string; birth_city?: string }) => {
            const birthCountry = String(birth_country ?? "").trim();
            const birthCity = String(birth_city ?? "").trim();
            if (birthCountry || birthCity) onPersonalInfoRef.current({ birthCountry, birthCity });
          },
        },
        onMessage: ({ message, role }: MessagePayload) => {
          const text = cleanTranscriptLine(message);
          if (!text) return;
          linesRef.current = [...linesRef.current, { role: role === "user" ? "student" : "counselor", text }];
          setLines(linesRef.current);
        },
        onError: (message: string) => setError(message || "The call dropped. Try again."),
        onDisconnect: () => {
          if (linesRef.current.some((line) => line.role === "student")) onEndRef.current(linesRef.current);
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the call. Try again.");
    } finally {
      setStarting(false);
    }
  };

  const state = !live
    ? lastCall
      ? `Last talked ${new Date(lastCall.endedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
      : "Ready when you are"
    : starting || status === "connecting"
      ? "Connecting…"
      : isSpeaking
        ? "Jordan is talking"
        : "Listening to you…";
  const shown = live ? lines : (lastCall?.lines ?? []);

  return (
    <section className={`voice${live ? " is-live" : ""}`} aria-label="Talk to a counselor">
      <p className="agent-lead">
        Jordan is an AI counselor who already knows your profile. They'll check in, ask when you want to start at UC, your birthday and
        where you were born, and talk through financial aid and the fee waiver. Stop whenever you like.
      </p>

      <div className="voice-stage">
        <div
          ref={orbRef}
          className={`voice-orb${live ? " is-live" : ""}${connected && isSpeaking ? " is-speaking" : ""}`}
          aria-hidden="true"
        >
          <span className="voice-ring" />
          <span className="voice-ring" />
          <span className="voice-core">
            <img src="/apply/jordan.png" alt="" />
          </span>
        </div>
        <p className="voice-state" aria-live="polite">
          {state}
        </p>
        {live ? (
          <button type="button" className="btn-ghost voice-btn" onClick={endSession} disabled={starting}>
            <StopIcon width={16} height={16} /> Stop
          </button>
        ) : (
          <button type="button" className="btn-primary voice-btn" onClick={start}>
            {lastCall ? "Talk again" : "Start"}
          </button>
        )}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {shown.length > 0 && (
        <div className="voice-log-wrap">
          <span className="field-label">{live ? "Conversation" : "Your last conversation"}</span>
          <ol className="voice-log" ref={logRef}>
            {shown.map((line, i) => (
              <li key={i} className={line.role === "student" ? "is-student" : undefined}>
                <span>{line.role === "student" ? "You" : "Jordan"}</span>
                {cleanTranscriptLine(line.text)}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
