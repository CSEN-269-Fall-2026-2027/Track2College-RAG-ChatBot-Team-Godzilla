import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { UcRun } from "../../api";
import type { ApplyIssue } from "../../agent/useBackgroundApply";
import { CloudBrowserPanel } from "../../agent/tasks";
import { AlertIcon, EyeIcon, XIcon } from "../icons";

/** Shared popup shell (same look as the other story popups). Escape and the backdrop close it. */
function Modal({ title, className, onClose, children }: { title: string; className: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return createPortal(
    <div className="map-modal-wrap" role="presentation">
      <button type="button" className="map-modal-scrim" aria-label="Close" onClick={onClose} />
      <div className={`map-modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="map-modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="map-modal-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The live cloud browser for "Help me apply". Opened from the chat's Watch button, or on its own when
 * the run needs the student (a code, a question only they can answer, or a failure). Closing the popup
 * leaves a working run going in the background.
 */
export function ApplyWatchDialog({
  run,
  issue,
  email,
  onSendCode,
  onRetry,
  onStop,
  onClose,
}: {
  run: UcRun | null;
  issue: ApplyIssue | null;
  /** Where UC sent the verification code. */
  email: string;
  onSendCode: (code: string) => Promise<void>;
  onRetry: (() => void) | null;
  /** Stop the run and close the cloud browser. */
  onStop: () => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const checking = run?.status === "checking_code";

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setCodeError(null);
    try {
      await onSendCode(code);
      setCode("");
    } catch (e) {
      setCodeError(e instanceof Error ? e.message : "Couldn't enter that code.");
    }
  };

  // UC's one-time code goes straight to the open window and is never saved.
  const codePopup = run?.open && issue?.kind === "code" && (
    <div className="cloud-browser-popup-backdrop">
      <form className="cloud-browser-popup" onSubmit={send} aria-label="Verification code">
        <h3>Enter your verification code</h3>
        <p>
          UC sent it to <strong>{email}</strong>. Check your spam folder if you don't see it.
        </p>
        {run.detail.startsWith("UC didn't accept") && (
          <p className="form-error" role="alert">
            {run.detail}
          </p>
        )}
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))}
          aria-label="Verification code"
          placeholder="e.g. 123456"
          autoComplete="one-time-code"
          maxLength={10}
          autoFocus
          disabled={checking}
        />
        <button type="submit" className="btn-primary" disabled={code.length < 4 || checking}>
          {checking ? "Checking your code…" : "Enter code"}
        </button>
        {codeError && (
          <p className="form-error" role="alert">
            {codeError}
          </p>
        )}
      </form>
    </div>
  );

  return (
    <Modal title="Your UC application" className="apply-watch-modal" onClose={onClose}>
      <div className="apply-watch-body">
        {issue && issue.kind !== "code" && (
          <p className="cep-error" role="alert">
            <AlertIcon width={16} height={16} aria-hidden="true" />
            <span>{issue.kind === "your-turn" ? `${issue.message} The assistant picks back up when you're done.` : issue.message}</span>
          </p>
        )}
        <CloudBrowserPanel
          startWatching
          popup={codePopup || undefined}
          run={run}
          onRetry={onRetry}
          onClose={onStop}
          closing={run?.detail === "Stopping…"}
        />
      </div>
    </Modal>
  );
}

const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** "Help me apply" needs a UC login first, or UC refused the one we had (then `message` says so). */
export function ApplyLoginDialog({
  message,
  email: initialEmail,
  onSave,
  onClose,
}: {
  /** Only when something went wrong (e.g. UC said the login is wrong); empty for a first login. */
  message: string;
  email: string;
  onSave: (login: { email: string; password: string }) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const ready = EMAIL_OK.test(email.trim()) && password.length >= 8 && password.length <= 30;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) onSave({ email: email.trim(), password });
  };

  return (
    <Modal title="Your UC login" className="cep-modal" onClose={onClose}>
      <form className="cep-body apply-login" onSubmit={submit}>
        {message && (
          <p className="cep-error" role="alert">
            <AlertIcon width={16} height={16} aria-hidden="true" />
            <span>{message}</span>
          </p>
        )}
        <label className="field">
          <span className="field-label">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="off" autoFocus={!email} />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <span className="apply-login-secret">
            <input
              type={shown ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              maxLength={30}
              autoFocus={!!email}
            />
            <button type="button" className="uc-icon-btn" onClick={() => setShown((s) => !s)} aria-label={shown ? "Hide password" : "Show password"}>
              <EyeIcon crossed={shown} width={15} height={15} />
            </button>
          </span>
          <span className="field-hint">8–30 characters</span>
        </label>
        <div className="apply-login-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!ready}>
            Start applying
          </button>
        </div>
      </form>
    </Modal>
  );
}
