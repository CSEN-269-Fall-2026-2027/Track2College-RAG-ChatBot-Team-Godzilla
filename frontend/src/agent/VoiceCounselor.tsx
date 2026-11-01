import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConversationProvider,
  useConversationControls,
  useConversationInput,
  useConversationMode,
  useConversationStatus,
  type MessagePayload,
} from "@elevenlabs/react";
import { counselorCallProblem, startCounselorCall } from "../api";
import { cleanTranscriptLine } from "./logic";
import { CallModal } from "./CallModal";
import { TypedEchoFilter, WRAP_UP_HANGUP_MS, callPhase, isWrapUpLine, presence as presenceOf } from "./callState";
import { VideoIcon } from "../components/icons";
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
 * A voice call with Jordan, the ElevenLabs counselor, shown as a video call. Jordan runs
 * through what a school counselor asks in a senior meeting; the student can join and leave
 * whenever they like. The conversation itself (script, tools, saving) is unchanged: this
 * component only frames the one ElevenLabs session.
 */
export function VoiceCounselor(props: VoiceCounselorProps) {
  return (
    <ConversationProvider>
      <Call {...props} />
    </ConversationProvider>
  );
}

function Call({ studentName, profileSummary, ucDeadline, entryYear, lastCall, onEnd, onPersonalInfo }: VoiceCounselorProps) {
  const { startSession, endSession, sendUserMessage, sendUserActivity, setVolume, getOutputVolume } = useConversationControls();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const { isMuted: micMuted, setMuted: setMicMuted } = useConversationInput();
  const [lines, setLines] = useState<CallLine[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linesRef = useRef<CallLine[]>([]);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onPersonalInfoRef = useRef(onPersonalInfo);
  onPersonalInfoRef.current = onPersonalInfo;

  // Call window state (presentation only).
  const [joined, setJoined] = useState(false);
  const [hadSession, setHadSession] = useState(false);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  /** Jordan said the goodbye line; hang up once they finish saying it. */
  const [wrappedUp, setWrappedUp] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(() => !window.matchMedia("(max-width: 760px)").matches);
  const reducedMotion = useReducedMotion();
  /** Bumped by every join so a mic check or token fetch the student walked away from is dropped. */
  const attemptRef = useRef(0);
  const startingRef = useRef(false);
  const echoRef = useRef(new TypedEchoFilter());
  /** This call's ElevenLabs id, for asking the server why it was refused. */
  const conversationIdRef = useRef<string | null>(null);
  /** Jordan has said the goodbye line, so the call ending from here on is expected, not an error. */
  const saidGoodbyeRef = useRef(false);
  const joinBtnRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const connected = status === "connected";
  const live = connected || status === "connecting" || starting;
  const phase = callPhase({ joined, starting, status, error, hadSession });

  // Leaving the page hangs up.
  useEffect(() => () => endSession(), [endSession]);

  useEffect(() => {
    if (!connected) return;
    setHadSession(true);
    setConnectedAt((at) => at ?? Date.now());
  }, [connected]);

  // Speaker: the session's own output volume, re-applied when a call connects.
  useEffect(() => {
    if (connected) setVolume({ volume: speakerMuted ? 0 : 1 });
  }, [connected, speakerMuted, setVolume]);

  // Thinking ends once Jordan starts talking or the call ends; never left on forever.
  useEffect(() => {
    if (isSpeaking || !connected) setThinking(false);
  }, [isSpeaking, connected]);
  useEffect(() => {
    if (!thinking) return;
    const id = window.setTimeout(() => setThinking(false), 15000);
    return () => window.clearTimeout(id);
  }, [thinking]);

  // After the goodbye has finished playing, end the call through the normal session cleanup
  // (so the transcript saves) instead of waiting for the agent's "Are you still there?".
  useEffect(() => {
    if (!wrappedUp || !connected || isSpeaking) return;
    const id = window.setTimeout(() => endSession(), WRAP_UP_HANGUP_MS);
    return () => window.clearTimeout(id);
  }, [wrappedUp, connected, isSpeaking, endSession]);
  useEffect(() => {
    if (!connected) setWrappedUp(false);
  }, [connected]);

  /** The one place a transcript line is added, whether it was spoken or typed. */
  const addLine = useCallback((role: CallLine["role"], raw: string) => {
    const text = cleanTranscriptLine(raw);
    if (!text) return;
    linesRef.current = [...linesRef.current, { role, text }];
    setLines(linesRef.current);
    setThinking(role === "student");
    // The goodbye arms the auto hang-up; if the student speaks up after it, let them keep talking.
    setWrappedUp(role === "counselor" ? (wrapped) => wrapped || isWrapUpLine(text) : false);
    if (role === "counselor" && isWrapUpLine(text)) saidGoodbyeRef.current = true;
  }, []);

  const start = async () => {
    if (startingRef.current) return;
    const attempt = ++attemptRef.current;
    startingRef.current = true;
    setError(null);
    setStarting(true);
    setHadSession(false);
    setConnectedAt(null);
    setThinking(false);
    setWrappedUp(false);
    echoRef.current.clear();
    conversationIdRef.current = null;
    saidGoodbyeRef.current = false;
    linesRef.current = [];
    setLines([]);
    try {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => stream.getTracks().forEach((t) => t.stop()));
      } catch {
        if (attempt === attemptRef.current) setError("Allow microphone access in your browser to talk with Jordan.");
        return;
      }
      const conversationToken = await startCounselorCall();
      // The student left (or rejoined) while we were getting ready: don't start a stray call.
      if (attempt !== attemptRef.current) return;
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
          if (attempt !== attemptRef.current) return;
          // A typed reply is already in the transcript; skip it if the server echoes it back.
          if (role === "user" && echoRef.current.consume(cleanTranscriptLine(message))) return;
          addLine(role === "user" ? "student" : "counselor", message);
        },
        onConnect: ({ conversationId }: { conversationId: string }) => {
          conversationIdRef.current = conversationId;
        },
        onError: (message: string) => {
          // Once Jordan has said goodbye, the session closing is the normal end of the call.
          if (attempt !== attemptRef.current || saidGoodbyeRef.current) return;
          setError(message || "The call dropped. Try again.");
        },
        onDisconnect: (details?: { reason?: string }) => {
          if (linesRef.current.some((line) => line.role === "student")) onEndRef.current(linesRef.current);
          if (attempt !== attemptRef.current) return;
          // ElevenLabs hung up before Jordan said a word: the call was refused (e.g. out of
          // credits), so show it as "couldn't start" with the reason, not as a finished call.
          const id = conversationIdRef.current;
          if (details?.reason === "agent" && !linesRef.current.some((line) => line.role === "counselor")) {
            setHadSession(false);
            setError("Jordan couldn't take the call. Try again in a moment.");
            if (id) {
              counselorCallProblem(id)
                .then((problem) => {
                  if (problem && attempt === attemptRef.current) setError(problem);
                })
                .catch(() => undefined);
            }
          }
        },
      });
    } catch (e) {
      if (attempt === attemptRef.current) setError(e instanceof Error ? e.message : "Couldn't start the call. Try again.");
    } finally {
      if (attempt === attemptRef.current) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  };

  const join = () => {
    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? joinBtnRef.current;
    setSpeakerMuted(false);
    setJoined(true);
    void start();
  };

  /** Escape, ✕ and "Leave call": hang up through the session's own cleanup, then close. */
  const leave = () => {
    attemptRef.current++;
    startingRef.current = false;
    setStarting(false);
    setThinking(false);
    endSession();
    setJoined(false);
    setError(null);
    const target = returnFocusRef.current?.isConnected ? returnFocusRef.current : joinBtnRef.current;
    requestAnimationFrame(() => target?.focus());
  };

  const toggleMic = () => {
    if (!connected) return;
    try {
      setMicMuted(!micMuted);
    } catch {
      // No live session; nothing to mute.
    }
  };

  const sendText = (text: string) => {
    if (!connected) return;
    echoRef.current.add(cleanTranscriptLine(text));
    sendUserMessage(text);
    addLine("student", text);
  };

  const getOutputLevel = useCallback(() => getOutputVolume(), [getOutputVolume]);

  const lastTalked = lastCall
    ? `Last talked ${new Date(lastCall.endedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "You haven't talked with Jordan yet";
  const saved = lastCall?.lines ?? [];
  const initials = (studentName.trim()[0] ?? "Y").toUpperCase();

  return (
    <section className="voice" aria-label="Talk to a counselor">
      <p className="agent-lead">
        Jordan is an AI counselor who already knows your profile. They'll check in, ask when you want to start at UC, your birthday and
        where you were born, and talk through financial aid and the fee waiver. Leave whenever you like.
      </p>

      <div className="voice-stage">
        <div className="voice-portrait" aria-hidden="true">
          <img src="/apply/jordan.png" alt="" />
        </div>
        <div className="voice-invite">
          <strong>Jordan · AI counselor</strong>
          <span className="voice-state">{joined && live ? "In a call now" : lastTalked}</span>
        </div>
        <button ref={joinBtnRef} type="button" className="btn-primary voice-btn" onClick={join} disabled={joined}>
          <VideoIcon width={17} height={17} /> Join video call
        </button>
      </div>

      {saved.length > 0 && (
        <div className="voice-log-wrap">
          <span className="field-label">Your last conversation</span>
          <ol className="voice-log">
            {saved.map((line, i) => (
              <li key={i} className={line.role === "student" ? "is-student" : undefined}>
                <span>{line.role === "student" ? "You" : "Jordan"}</span>
                {cleanTranscriptLine(line.text)}
              </li>
            ))}
          </ol>
        </div>
      )}

      {joined && (
        <CallModal
          phase={phase}
          presence={presenceOf(phase, isSpeaking, thinking)}
          lines={lines}
          error={error}
          connectedAt={connectedAt}
          studentInitials={initials}
          micMuted={micMuted}
          speakerMuted={speakerMuted}
          transcriptOpen={transcriptOpen}
          isSpeaking={isSpeaking}
          reducedMotion={reducedMotion}
          getOutputLevel={getOutputLevel}
          onToggleMic={toggleMic}
          onToggleSpeaker={() => setSpeakerMuted((m) => !m)}
          onToggleTranscript={() => setTranscriptOpen((o) => !o)}
          onLeave={leave}
          onRejoin={() => void start()}
          endedNote={
            lines.some((line) => line.role === "student")
              ? "Your conversation is saved on the Counselor page."
              : "Nothing was saved because you didn't say anything."
          }
          onSendText={sendText}
          onTyping={sendUserActivity}
        />
      )}
    </section>
  );
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}
