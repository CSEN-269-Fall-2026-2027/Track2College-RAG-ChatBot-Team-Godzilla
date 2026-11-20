import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversationControls, useConversationInput, useConversationMode, useConversationStatus, type MessagePayload } from "@elevenlabs/react";
import { ApiError, counselorCallProblem, startCounselorCall } from "../api";
import { cleanTranscriptLine } from "./logic";
import { CallModal } from "./CallModal";
import {
  ELEVENLABS_CREDITS_MESSAGE,
  TypedEchoFilter,
  WRAP_UP_HANGUP_MS,
  callPhase,
  isCreditsError,
  isWrapUpLine,
  presence as presenceOf,
  shouldSaveCounselorCall,
} from "./callState";
import type { CallLine, PersonalInfo } from "../types";

interface VoiceCounselorProps {
  studentName: string;
  profileSummary: string;
  /** UC's deadline, spoken by the counselor (e.g. "November 30, 2026"). */
  ucDeadline: string;
  /** Year the student would start at UC, for the start-term question. */
  entryYear: number;
  /** Called when a finished call ends (student spoke + Jordan's wrap-up). Incomplete calls are not saved. */
  onEnd: (lines: CallLine[]) => void;
  /** Called when Jordan saves the student's birthday or birthplace (may reject if Supabase save fails). */
  onPersonalInfo: (info: PersonalInfo) => void | Promise<void>;
  /** Leave call / hang up: return to the chatbot. */
  onClose: () => void;
}

const BIRTH_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Jordan's voice check-in. Meet opens the meeting-room popup and starts immediately
 * (no join / steps / history screen). Leave / hang-up returns to the chat with the transcript.
 */
export function VoiceCounselor(props: VoiceCounselorProps) {
  return (
    <ConversationProvider>
      <Call {...props} />
    </ConversationProvider>
  );
}

function Call({ studentName, profileSummary, ucDeadline, entryYear, onEnd, onPersonalInfo, onClose }: VoiceCounselorProps) {
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
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [hadSession, setHadSession] = useState(false);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const [wrappedUp, setWrappedUp] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(() => !window.matchMedia("(max-width: 760px)").matches);
  const reducedMotion = useReducedMotion();
  const attemptRef = useRef(0);
  const startingRef = useRef(false);
  const echoRef = useRef(new TypedEchoFilter());
  const conversationIdRef = useRef<string | null>(null);
  const saidGoodbyeRef = useRef(false);
  const closedRef = useRef(false);
  /** True once Jordan has actually been speaking the wrap-up line (or we gave up waiting for TTS). */
  const heardWrapSpeechRef = useRef(false);
  /** One-shot hang-up after the wrap-up finishes — not cleared if Jordan starts talking again. */
  const hangupTimerRef = useRef<number | null>(null);

  const connected = status === "connected";
  const phase = callPhase({ joined: true, starting, status, error, hadSession });

  useEffect(() => () => endSession(), [endSession]);

  useEffect(() => {
    if (!connected) return;
    setHadSession(true);
    setConnectedAt((at) => at ?? Date.now());
  }, [connected]);

  useEffect(() => {
    if (connected) setVolume({ volume: speakerMuted ? 0 : 1 });
  }, [connected, speakerMuted, setVolume]);

  useEffect(() => {
    if (isSpeaking || !connected) setThinking(false);
  }, [isSpeaking, connected]);
  useEffect(() => {
    if (!thinking) return;
    const id = window.setTimeout(() => setThinking(false), 15000);
    return () => window.clearTimeout(id);
  }, [thinking]);

  // After the goodbye line finishes playing, hang up in WRAP_UP_HANGUP_MS (3s). Wait for TTS to
  // actually speak it first so we don't cut mid-line; once the timer starts, keep it even if the
  // agent tries another line ("Are you still there?").
  useEffect(() => {
    if (!wrappedUp || !connected) return;
    if (isSpeaking) {
      heardWrapSpeechRef.current = true;
      return;
    }
    if (hangupTimerRef.current != null) return;

    if (!heardWrapSpeechRef.current) {
      // Transcript can arrive before playback starts — give TTS a moment.
      const grace = window.setTimeout(() => {
        heardWrapSpeechRef.current = true;
        if (hangupTimerRef.current != null || !saidGoodbyeRef.current) return;
        hangupTimerRef.current = window.setTimeout(() => {
          hangupTimerRef.current = null;
          endSession();
        }, WRAP_UP_HANGUP_MS);
      }, 1200);
      return () => window.clearTimeout(grace);
    }

    hangupTimerRef.current = window.setTimeout(() => {
      hangupTimerRef.current = null;
      endSession();
    }, WRAP_UP_HANGUP_MS);
  }, [wrappedUp, connected, isSpeaking, endSession]);
  useEffect(() => {
    if (!connected) {
      setWrappedUp(false);
      heardWrapSpeechRef.current = false;
      if (hangupTimerRef.current != null) {
        window.clearTimeout(hangupTimerRef.current);
        hangupTimerRef.current = null;
      }
    }
  }, [connected]);

  const finishToChat = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    const lines = linesRef.current;
    if (shouldSaveCounselorCall(lines)) onEndRef.current(lines);
    onCloseRef.current();
  }, []);

  const addLine = useCallback((role: CallLine["role"], raw: string) => {
    const text = cleanTranscriptLine(raw);
    if (!text) return;
    linesRef.current = [...linesRef.current, { role, text }];
    setLines(linesRef.current);
    setThinking(role === "student");
    setWrappedUp(role === "counselor" ? (wrapped) => wrapped || isWrapUpLine(text) : false);
    if (role === "counselor" && isWrapUpLine(text)) saidGoodbyeRef.current = true;
  }, []);

  /** Show a clear out-of-credits (or other) failure on Jordan and in the live transcript. */
  const showCallFailure = useCallback((message: string) => {
    const text = isCreditsError(message) ? ELEVENLABS_CREDITS_MESSAGE : message;
    setHadSession(false);
    setError(text);
    const notice: CallLine = { role: "counselor", text };
    linesRef.current = [notice];
    setLines([notice]);
  }, []);

  const start = useCallback(async () => {
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
    heardWrapSpeechRef.current = false;
    if (hangupTimerRef.current != null) {
      window.clearTimeout(hangupTimerRef.current);
      hangupTimerRef.current = null;
    }
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
        clientTools: {
          save_birth_date: async ({ birth_date }: { birth_date?: string }) => {
            const birthDate = String(birth_date ?? "").trim();
            if (!BIRTH_DATE_RE.test(birthDate)) return;
            try {
              await onPersonalInfoRef.current({ birthDate });
            } catch {
              setError("Couldn't save your birthday to your account. You can tell Jordan again, or add it later.");
            }
          },
          save_birthplace: async ({ birth_country, birth_city }: { birth_country?: string; birth_city?: string }) => {
            const birthCountry = String(birth_country ?? "").trim();
            const birthCity = String(birth_city ?? "").trim();
            if (!birthCountry && !birthCity) return;
            try {
              await onPersonalInfoRef.current({ birthCountry, birthCity });
            } catch {
              setError("Couldn't save your birthplace to your account. You can tell Jordan again, or add it later.");
            }
          },
        },
        onMessage: ({ message, role }: MessagePayload) => {
          if (attempt !== attemptRef.current) return;
          if (role === "user" && echoRef.current.consume(cleanTranscriptLine(message))) return;
          addLine(role === "user" ? "student" : "counselor", message);
        },
        onConnect: ({ conversationId }: { conversationId: string }) => {
          conversationIdRef.current = conversationId;
        },
        onError: (message: string) => {
          if (attempt !== attemptRef.current || saidGoodbyeRef.current) return;
          if (isCreditsError(message)) showCallFailure(ELEVENLABS_CREDITS_MESSAGE);
          else setError(message || "The call dropped. Try again.");
        },
        onDisconnect: (details?: { reason?: string }) => {
          if (attempt !== attemptRef.current) return;
          const id = conversationIdRef.current;
          if (details?.reason === "agent" && !linesRef.current.some((line) => line.role === "student")) {
            showCallFailure("Jordan couldn't take the call. Try again in a moment.");
            if (id) {
              counselorCallProblem(id)
                .then((problem) => {
                  if (problem && attempt === attemptRef.current) showCallFailure(problem);
                })
                .catch(() => undefined);
            }
            return;
          }
          // Goodbye hang-up or a finished call: return to the chatbot with the transcript.
          if (saidGoodbyeRef.current || linesRef.current.some((line) => line.role === "student")) {
            finishToChat();
          }
        },
      });
    } catch (e) {
      if (attempt !== attemptRef.current) return;
      const message =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Couldn't start the call. Try again.";
      showCallFailure(isCreditsError(message) ? ELEVENLABS_CREDITS_MESSAGE : message);
    } finally {
      if (attempt === attemptRef.current) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  }, [addLine, entryYear, finishToChat, profileSummary, showCallFailure, startSession, studentName, ucDeadline]);

  // Meet with Jordan: start immediately (no join popup).
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    void startRef.current();
  }, []);

  const leave = () => {
    attemptRef.current++;
    startingRef.current = false;
    setStarting(false);
    setThinking(false);
    endSession();
    setError(null);
    finishToChat();
  };

  const toggleMic = () => {
    if (!connected) return;
    try {
      setMicMuted(!micMuted);
    } catch {
      // No live session.
    }
  };

  const sendText = (text: string) => {
    if (!connected) return;
    echoRef.current.add(cleanTranscriptLine(text));
    sendUserMessage(text);
    addLine("student", text);
  };

  const getOutputLevel = useCallback(() => getOutputVolume(), [getOutputVolume]);
  const initials = (studentName.trim()[0] ?? "Y").toUpperCase();

  return (
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
      onRejoin={() => {
        closedRef.current = false;
        void start();
      }}
      endedNote={
        shouldSaveCounselorCall(lines)
          ? "Your conversation is saved in this chat."
          : lines.some((line) => line.role === "student")
            ? "This call wasn't finished, so it wasn't saved."
            : "Nothing was saved because you didn't say anything."
      }
      onSendText={sendText}
      onTyping={sendUserActivity}
    />
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
