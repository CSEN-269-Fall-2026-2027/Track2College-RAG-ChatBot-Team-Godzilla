import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { CallLine } from "../types";
import { PRESENCE_LABEL, nearBottom, type CallPhase, type Presence } from "./callState";
import { cleanTranscriptLine } from "./logic";
import { JordanAvatar } from "./JordanAvatar";
import { ArrowUpIcon, MicIcon, PhoneOffIcon, RetryIcon, TranscriptIcon, VolumeIcon, XIcon } from "../components/icons";

interface CallModalProps {
  phase: CallPhase;
  presence: Presence;
  /** This call's transcript, exactly as the session reported it. */
  lines: CallLine[];
  error: string | null;
  connectedAt: number | null;
  studentInitials: string;
  micMuted: boolean;
  speakerMuted: boolean;
  transcriptOpen: boolean;
  isSpeaking: boolean;
  reducedMotion: boolean;
  getOutputLevel: () => number;
  onToggleMic: () => void;
  onToggleSpeaker: () => void;
  onToggleTranscript: () => void;
  /** Hangs up through the existing session cleanup, then closes. Escape and ✕ use it too. */
  onLeave: () => void;
  /** Starts the call again (same as the old "Talk again"). */
  onRejoin: () => void;
  /** Shown under "The call has ended": whether this call's conversation was saved. */
  endedNote: string;
  /** Sends a typed reply into the live session. */
  onSendText: (text: string) => void;
  onTyping: () => void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The video-call window around the Jordan voice session. */
export function CallModal(props: CallModalProps) {
  const {
    phase,
    presence,
    lines,
    error,
    connectedAt,
    studentInitials,
    micMuted,
    speakerMuted,
    transcriptOpen,
    isSpeaking,
    reducedMotion,
    getOutputLevel,
    onToggleMic,
    onToggleSpeaker,
    onToggleTranscript,
    onLeave,
    onRejoin,
    endedNote,
    onSendText,
    onTyping,
  } = props;
  const titleId = useId();
  const transcriptId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const live = phase === "live";

  // Focus lands on the call's first control; the opener restores focus when it closes.
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>(".call-toolbar button")?.focus();
  }, []);

  // When an overlay button that had focus goes away (phase change), keep focus in the call.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      dialog.querySelector<HTMLElement>(".call-overlay button, .call-toolbar button:not([disabled])")?.focus();
    }
  }, [phase]);

  // No page scroll behind the call.
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, []);

  // Escape and the Tab trap listen on the document, so they still work when the focused control
  // disappears (e.g. "Try again" swapping to the connecting overlay drops focus to <body>).
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onLeaveRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return createPortal(
    <div className="call-backdrop">
      <div
        ref={dialogRef}
        className={`call${transcriptOpen ? "" : " is-transcript-hidden"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="call-head">
          <div className="call-title">
            <span className={`call-live-dot${live ? " is-on" : ""}`} aria-hidden="true" />
            <h2 id={titleId}>Counselor check-in</h2>
            {live && connectedAt && <CallTimer since={connectedAt} />}
          </div>
          <button type="button" className="call-icon-btn" onClick={onLeave} aria-label="Leave call and close">
            <XIcon width={18} height={18} />
          </button>
        </header>

        <div className="call-body">
          <section className={`call-stage is-${presence}`} aria-label="Jordan, AI counselor">
            <OfficeBackdrop />
            <div className="call-figure">
              <JordanAvatar
                speaking={live && isSpeaking}
                getLevel={getOutputLevel}
                silentPlayback={speakerMuted}
                reducedMotion={reducedMotion}
              />
            </div>
            <OfficeDesk />

            <div className="call-nameplate">
              <strong>Jordan</strong>
              <span>· AI counselor</span>
            </div>
            <div className={`call-presence is-${presence}`} role="status" aria-live="polite">
              <span className="call-presence-dot" aria-hidden="true" />
              {PRESENCE_LABEL[presence]}
              {live && micMuted && <span className="call-presence-note">· your mic is muted</span>}
            </div>

            <div className="call-self" aria-label="You, camera off">
              <span className="call-self-avatar" aria-hidden="true">
                {studentInitials}
              </span>
              <span className="call-self-label">
                You{micMuted && live ? <MicIcon off width={13} height={13} aria-label="Muted" /> : null}
              </span>
              <small>Camera off</small>
            </div>

            {phase === "connecting" && (
              <div className="call-overlay" aria-hidden="true">
                <span className="call-spinner" />
                <p>Connecting to Jordan…</p>
              </div>
            )}
            {phase === "error" && (
              <div className="call-overlay call-overlay-panel">
                <p className="call-overlay-title">Couldn't start the call</p>
                <p role="alert">{error}</p>
                <button type="button" className="btn-primary" onClick={onRejoin}>
                  <RetryIcon width={15} height={15} /> Try again
                </button>
              </div>
            )}
            {phase === "ended" && (
              <div className="call-overlay call-overlay-panel">
                <p className="call-overlay-title">The call has ended</p>
                <p>{error ?? endedNote}</p>
                <button type="button" className="btn-primary" onClick={onRejoin}>
                  Join again
                </button>
              </div>
            )}
          </section>

          <aside id={transcriptId} className="call-transcript" aria-label="Live transcript" hidden={!transcriptOpen}>
            <Transcript lines={lines} />
            <TypedReply enabled={live} onSend={onSendText} onTyping={onTyping} />
          </aside>
        </div>

        <footer className="call-toolbar" aria-label="Call controls">
          <div className="call-toolbar-group">
            <button
              type="button"
              className={`call-ctl${micMuted && live ? " is-off" : ""}`}
              onClick={onToggleMic}
              disabled={!live}
              aria-pressed={live ? micMuted : undefined}
              aria-label={micMuted ? "Unmute microphone" : "Mute microphone"}
              title={live ? (micMuted ? "Unmute microphone" : "Mute microphone") : "Available once the call connects"}
            >
              <MicIcon off={micMuted && live} width={20} height={20} />
              <span>{micMuted && live ? "Unmute" : "Mute"}</span>
            </button>
            <button
              type="button"
              className={`call-ctl${speakerMuted ? " is-off" : ""}`}
              onClick={onToggleSpeaker}
              aria-pressed={speakerMuted}
              aria-label={speakerMuted ? "Turn speaker on" : "Turn speaker off"}
            >
              <VolumeIcon muted={speakerMuted} width={20} height={20} />
              <span>{speakerMuted ? "Speaker off" : "Speaker"}</span>
            </button>
            <button
              type="button"
              className={`call-ctl${transcriptOpen ? " is-on" : ""}`}
              onClick={onToggleTranscript}
              aria-pressed={transcriptOpen}
              aria-controls={transcriptId}
              aria-label={transcriptOpen ? "Hide transcript" : "Show transcript"}
            >
              <TranscriptIcon width={20} height={20} />
              <span>Transcript</span>
            </button>
          </div>
          <button type="button" className="call-leave" onClick={onLeave}>
            <PhoneOffIcon width={20} height={20} />
            <span>Leave call</span>
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** mm:ss since the call connected. */
function CallTimer({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <span className="call-timer" aria-label={`Call time ${text}`}>
      {text}
    </span>
  );
}

/** The session's lines in order; follows new lines only while the reader is at the bottom. */
function Transcript({ lines }: { lines: CallLine[] }) {
  const scrollRef = useRef<HTMLOListElement>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = nearBottom(el.scrollHeight, el.scrollTop, el.clientHeight);
    setShowJump(!stickRef.current);
  };

  return (
    <div className="call-transcript-scroll-wrap">
      <div className="call-transcript-head">
        <h3>Live transcript</h3>
      </div>
      {lines.length === 0 ? (
        <p className="call-transcript-empty">What you and Jordan say will show up here.</p>
      ) : (
        <ol className="call-transcript-list" ref={scrollRef} onScroll={onScroll} role="log" aria-live="polite" tabIndex={0}>
          {lines.map((line, i) => (
            <li key={i} className={line.role === "student" ? "is-student" : "is-counselor"}>
              <span className="call-line-speaker">{line.role === "student" ? "You" : "Jordan"}</span>
              <p>{cleanTranscriptLine(line.text)}</p>
            </li>
          ))}
        </ol>
      )}
      {showJump && (
        <button
          type="button"
          className="call-jump"
          onClick={() => {
            stickRef.current = true;
            setShowJump(false);
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
          }}
        >
          Latest ↓
        </button>
      )}
    </div>
  );
}

/** Type instead of talking, into the same live session. */
function TypedReply({ enabled, onSend, onTyping }: { enabled: boolean; onSend: (text: string) => void; onTyping: () => void }) {
  const [value, setValue] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = value.trim();
    if (!text || !enabled) return;
    onSend(text);
    setValue("");
  };
  return (
    <form className="call-type" onSubmit={submit}>
      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (enabled) onTyping();
        }}
        placeholder={enabled ? "Type a reply to Jordan…" : "Typing opens once the call connects"}
        aria-label="Type a reply to Jordan"
        disabled={!enabled}
        maxLength={600}
      />
      <button type="submit" disabled={!enabled || !value.trim()} aria-label="Send reply">
        <ArrowUpIcon width={16} height={16} />
      </button>
    </form>
  );
}

/** Jordan's office: wall, window, shelf, plant and pennant, drawn in pixel blocks. */
function OfficeBackdrop() {
  return (
    <svg className="call-office" viewBox="0 0 320 180" preserveAspectRatio="xMidYMax slice" shapeRendering="crispEdges" aria-hidden="true">
      <rect width="320" height="180" className="o-wall" />
      <rect y="128" width="320" height="52" className="o-wainscot" />
      <rect y="126" width="320" height="3" className="o-rail" />
      {/* window */}
      <rect x="28" y="26" width="64" height="58" className="o-frame" />
      <rect x="32" y="30" width="27" height="24" className="o-sky" />
      <rect x="61" y="30" width="27" height="24" className="o-sky" />
      <rect x="32" y="56" width="27" height="24" className="o-sky" />
      <rect x="61" y="56" width="27" height="24" className="o-sky" />
      <rect x="34" y="68" width="12" height="12" className="o-tree" />
      <rect x="66" y="64" width="16" height="16" className="o-tree" />
      <rect x="24" y="84" width="72" height="4" className="o-frame" />
      {/* pennant */}
      <rect x="194" y="30" width="3" height="22" className="o-frame" />
      <polygon points="197,30 222,37 197,44" className="o-pennant" />
      {/* bookshelf */}
      <rect x="226" y="24" width="70" height="104" className="o-shelf" />
      <rect x="230" y="28" width="62" height="96" className="o-shelf-back" />
      <rect x="230" y="56" width="62" height="3" className="o-shelf" />
      <rect x="230" y="88" width="62" height="3" className="o-shelf" />
      {[
        [233, 36, 6, 20, "a"],
        [240, 40, 5, 16, "b"],
        [246, 34, 7, 22, "c"],
        [254, 38, 5, 18, "a"],
        [264, 42, 18, 14, "d"],
        [233, 70, 7, 18, "d"],
        [241, 66, 5, 22, "c"],
        [247, 68, 6, 20, "b"],
        [274, 72, 6, 16, "a"],
        [281, 69, 7, 19, "c"],
        [236, 104, 22, 20, "b"],
        [262, 100, 6, 24, "a"],
        [269, 102, 6, 22, "d"],
      ].map(([x, y, w, h, c], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} className={`o-book-${c}`} />
      ))}
      {/* plant */}
      <rect x="14" y="112" width="20" height="18" className="o-pot" />
      <rect x="18" y="98" width="4" height="14" className="o-leaf" />
      <rect x="24" y="92" width="4" height="20" className="o-leaf" />
      <rect x="12" y="102" width="6" height="4" className="o-leaf" />
      <rect x="28" y="100" width="7" height="4" className="o-leaf" />
    </svg>
  );
}

/** The front of the desk, drawn over Jordan's legs. */
function OfficeDesk() {
  return (
    <svg className="call-desk" viewBox="0 0 320 40" preserveAspectRatio="none" shapeRendering="crispEdges" aria-hidden="true">
      <rect width="320" height="6" className="o-desk-top" />
      <rect y="6" width="320" height="34" className="o-desk" />
      <rect y="6" width="320" height="2" className="o-desk-shadow" />
    </svg>
  );
}
