import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { UcBrowser } from "../../api";
import { agentOf, callLogMessage, setAgent } from "../../agent/logic";
import { mentorById, REVIEW_GUIDES, type Mentor } from "../../game/characters";
import type { ReviewTool } from "../../game/openers";
import { SchoolCounselor, UcAccountTask, UcLogin, VirtualCounselor, type UcLoginDraft } from "../../agent/tasks";
import { useProfile } from "../../profile";
import type { AgentState, ReviewMode } from "../../types";
import { XIcon } from "../icons";
import { Character } from "./Character";

/**
 * Story mode's Review & Apply step, left side: pick who you chat with, Counselor or Application
 * assistant. Switching any time restarts the chat with the new persona (see Advisor).
 */
export function ReviewPersonaPicker({
  onModeChange,
  only,
  onBack,
}: {
  onModeChange: (mode: ReviewMode) => void;
  /** Another planet's guide is in the chat: show just that person, plus a way back. */
  only?: Mentor;
  onBack?: () => void;
}) {
  const { profile, update } = useProfile();
  const mode: ReviewMode = agentOf(profile).reviewMode ?? "counselor";

  if (only) {
    return (
      <div className="review-personas">
        <p className="guided-question">Who do you want to chat with?</p>
        <div className="review-persona-list is-single">
          <div className="review-persona on is-only" aria-label={`Chatting with ${only.name}`}>
            <strong className="review-persona-name">{only.name}</strong>
            <Character mentor={only} mood="happy" size={220} className="review-persona-art" />
          </div>
        </div>
        {onBack && (
          <button type="button" className="review-persona-back" onClick={onBack}>
            Back to Counselor or Application assistant
          </button>
        )}
      </div>
    );
  }

  const pick = (next: ReviewMode) => {
    if (next === mode) return;
    update((p) => setAgent(p, (a) => ({ ...a, reviewMode: next })));
    onModeChange(next);
  };

  return (
    <div className="review-personas">
      <p className="guided-question">Who do you want to chat with?</p>
      <div className="review-persona-list" role="radiogroup" aria-label="Chat personality">
        {REVIEW_GUIDES.map((guide) => {
          const on = guide.id === mode;
          return (
            <button
              key={guide.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`review-persona${on ? " on" : ""}`}
              onClick={() => pick(guide.id as ReviewMode)}
            >
              <strong className="review-persona-name">{guide.name}</strong>
              <Character mentor={guide} mood="happy" size={220} className="review-persona-art" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface ToolCopy {
  title: string;
  guide: "counselor" | "assistant";
  /** What happens, shown beside the tool. */
  steps: string[];
  note: string;
}

const TOOL_COPY: Record<ReviewTool, ToolCopy> = {
  email: {
    title: "Email your school counselor",
    guide: "counselor",
    steps: ["Find your counselor on your school's website", "Review and edit the draft", "Open it in Gmail and click Send"],
    note: "Nothing is sent until you click Send in Gmail.",
  },
  call: {
    title: "Meet with your virtual counselor",
    guide: "counselor",
    steps: [
      "Jordan checks in on how your application is going",
      "Asks when you'd start at UC, your birthday, and where you were born",
      "Talks through financial aid and the fee waiver",
    ],
    note: "",
  },
  apply: {
    title: "Your UC application",
    guide: "assistant",
    steps: ["Create your UC account, or sign in to it", "We fill out your application"],
    note: "",
  },
};

const BROWSERS: { id: UcBrowser; label: string }[] = [
  { id: "local", label: "Local" },
  { id: "cloud", label: "Cloud" },
];

/**
 * Where the Application Assistant's browser runs. A radio group styled as a sliding switch:
 * Tab reaches the chosen side, arrow keys move between them. Locked while a run is going, so a
 * change always applies to the next run.
 */
function BrowserSwitch({ value, onChange, locked }: { value: UcBrowser; onChange: (next: UcBrowser) => void; locked: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = BROWSERS.findIndex((b) => b.id === value);
    const next =
      event.key === "Home" ? 0 : event.key === "End" ? BROWSERS.length - 1 : (index + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + BROWSERS.length) % BROWSERS.length;
    onChange(BROWSERS[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div className="browser-switch-wrap">
      <div
        className={`browser-switch${locked ? " is-locked" : ""}`}
        role="radiogroup"
        aria-label="Where the browser runs"
        aria-disabled={locked || undefined}
        data-value={value}
        onKeyDown={locked ? undefined : onKeyDown}
      >
        <span className="browser-switch-thumb" aria-hidden="true" />
        {BROWSERS.map((b, i) => (
          <button
            key={b.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={value === b.id}
            tabIndex={value === b.id ? 0 : -1}
            disabled={locked}
            className="browser-switch-option"
            onClick={() => onChange(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** The Jordan call window opens above this one; while it's up, it owns Escape and Tab. */
const callOpen = () => !!document.querySelector(".call-backdrop");

/**
 * An application tool (agent/tasks) in a full-screen pop-up, opened from a button in the Review & Apply
 * chat: the counselor search and email, the call with Jordan, or the UC application script.
 * ✕, Escape, or the backdrop closes it.
 */
export function ReviewToolDialog({ tool, onClose, onCallLog }: { tool: ReviewTool; onClose: () => void; onCallLog: (text: string) => void }) {
  const { profile, update } = useProfile();
  const agent = agentOf(profile);
  const change = (fn: (a: AgentState) => AgentState) => update((p) => setAgent(p, fn));
  const copy = TOOL_COPY[tool];
  const guide = mentorById(copy.guide);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Application Assistant only: where the next autofill run's browser starts.
  const [browser, setBrowser] = useState<UcBrowser>("cloud");
  const [running, setRunning] = useState(false);
  const onBusyChange = useCallback((busy: boolean) => setRunning(busy), []);
  // The login typed in the side panel. It's only saved to the profile once UC accepts it.
  const [ucLogin, setUcLogin] = useState<UcLoginDraft | null>(() =>
    agent.ucAccount ? { email: agent.ucAccount.email, password: agent.ucAccount.password ?? "" } : null,
  );

  // Focus moves into the pop-up and returns to the chat button that opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>(".tool-dialog-close")?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // No page scroll behind the pop-up.
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, []);

  // Escape closes; Tab stays inside. Both step aside while the call window is open on top.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog || callOpen()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
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
    <div
      className="tool-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !callOpen()) onClose();
      }}
    >
      <div ref={dialogRef} className={`tool-dialog tool-dialog-${tool}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="tool-dialog-head">
          <div className="tool-dialog-heading">
            <span>
              <h2 id={titleId}>{copy.title}</h2>
            </span>
          </div>
          <div className="tool-dialog-actions">
            {tool === "apply" && <BrowserSwitch value={browser} onChange={setBrowser} locked={running} />}
            <button type="button" className="tool-dialog-close" onClick={onClose} aria-label="Close">
              <XIcon width={20} height={20} />
            </button>
          </div>
        </header>

        <div className="tool-dialog-body">
          {tool !== "call" && (
            <aside className="tool-dialog-aside" aria-label="What happens">
              <Character mentor={guide} mood="happy" size={150} className="tool-dialog-guide" />
              <p className="tool-dialog-from">
                <strong>{guide.name}</strong> will help you through:
              </p>
              <ol className="tool-dialog-steps">
                {copy.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {tool === "apply" ? (
                <UcLogin agent={agent} change={change} locked={running} login={ucLogin} onLogin={setUcLogin} />
              ) : (
                <p className="tool-dialog-note">{copy.note}</p>
              )}
            </aside>
          )}

          <div className="tool-dialog-main">
            <div className={`tool-dialog-card agent-step${tool === "apply" && browser === "cloud" ? " is-cloud" : ""}`}>
              {tool === "email" && <SchoolCounselor agent={agent} change={change} />}
              {tool === "call" && (
                <VirtualCounselor
                  agent={agent}
                  change={change}
                  variant="popup"
                  onCallEnd={(lines) => onCallLog(callLogMessage(lines))}
                  details={
                    <>
                      <ol className="tool-dialog-steps" aria-label="What happens">
                        {copy.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                      {copy.note && <p className="tool-dialog-note">{copy.note}</p>}
                    </>
                  }
                />
              )}
              {tool === "apply" && (
                <UcAccountTask agent={agent} change={change} login={ucLogin} browser={browser} onBusyChange={onBusyChange} onRunBrowser={setBrowser} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
