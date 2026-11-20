import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { agentOf, callLogMessage, setAgent } from "../../agent/logic";
import { VirtualCounselor } from "../../agent/tasks";
import { useProfile } from "../../profile";
import type { AgentState } from "../../types";
import { XIcon } from "../icons";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** The Jordan call window opens above this one; while it's up, it owns Escape and Tab. */
const callOpen = () => !!document.querySelector(".call-backdrop");

export function ReviewToolDialog({
  onClose,
  onCallLog,
}: {
  onClose: () => void;
  onCallLog: (text: string) => void;
}) {
  const { profile, update } = useProfile();
  const agent = agentOf(profile);
  const change = (fn: (a: AgentState) => AgentState) => update((p) => setAgent(p, fn));
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
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
        if (event.target === event.currentTarget && !callOpen()) onCloseRef.current();
      }}
    >
      <div ref={dialogRef} className="tool-dialog tool-dialog-call" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="tool-dialog-head">
          <div className="tool-dialog-heading">
            <span>
              <h2 id={titleId}>Meet with your virtual counselor</h2>
            </span>
          </div>
          <div className="tool-dialog-actions">
            <button type="button" className="tool-dialog-close" onClick={() => onCloseRef.current()} aria-label="Close">
              <XIcon width={20} height={20} />
            </button>
          </div>
        </header>

        <div className="tool-dialog-body">
          <div className="tool-dialog-main">
            <div className="tool-dialog-card agent-step">
                <VirtualCounselor
                  agent={agent}
                  change={change}
                  variant="popup"
                  onCallEnd={(lines) => onCallLog(callLogMessage(lines))}
                  details={
                    <>
                      <p className="tool-dialog-from">Jordan can help you:</p>
                      <ol className="tool-dialog-steps" aria-label="What Jordan can help with">
                        {["Answer any general questions you have", "Apply to the UCs"].map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    </>
                  }
                />
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
