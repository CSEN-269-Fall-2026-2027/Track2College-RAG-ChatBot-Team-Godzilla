import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { CounselorEmailProblem } from "../../agent/counselorEmailAuto";
import { AlertIcon, XIcon } from "../icons";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface Props {
  problem: CounselorEmailProblem;
  busy: boolean;
  /** Write the email to this counselor and open Gmail. */
  onSubmit: (counselor: { name: string; email: string }) => void;
  onClose: () => void;
}

/** Shown only when "Email my counselor" can't finish on its own: says what went wrong, asks just for name + email. */
export function CounselorEmailProblemDialog({ problem, busy, onSubmit, onClose }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(problem.name);
  const [email, setEmail] = useState(problem.email);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // A new problem (e.g. drafting failed after a manual try) refreshes the prefill.
  useEffect(() => {
    setName(problem.name);
    setEmail(problem.email);
  }, [problem]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.querySelector<HTMLElement>("a, input, button.cep-pick")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const valid = name.trim() !== "" && EMAIL_RE.test(email.trim());
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid && !busy) onSubmit({ name: name.trim(), email: email.trim() });
  };

  return createPortal(
    <div className="map-modal-wrap" role="presentation">
      <button type="button" className="map-modal-scrim" aria-label="Close" onClick={onClose} />
      <div ref={panelRef} className="map-modal cep-modal" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="map-modal-head">
          <h2 id={titleId}>Couldn't email your counselor</h2>
          <button type="button" className="map-modal-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="cep-body">
          <p className="cep-error" role="alert">
            <AlertIcon width={16} height={16} aria-hidden="true" />
            <span>{problem.message}</span>
          </p>

          {problem.gmailUrl ? (
            <div className="cep-actions">
              <a className="btn-primary" href={problem.gmailUrl} target="_blank" rel="noreferrer" onClick={onClose}>
                Open in Gmail
              </a>
            </div>
          ) : (
            <form onSubmit={submit} className="cep-form">
              {problem.candidates.length > 0 && (
                <div className="cep-picks" role="group" aria-label="Counselors we found">
                  {problem.candidates.map((c) => (
                    <button
                      key={c.email}
                      type="button"
                      className={`cep-pick${email === c.email ? " on" : ""}`}
                      onClick={() => {
                        setName(c.name);
                        setEmail(c.email);
                      }}
                    >
                      {c.name}
                      {c.serves && <small>{c.serves}</small>}
                    </button>
                  ))}
                </div>
              )}
              <label className="field">
                <span className="field-label">Counselor's name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
              </label>
              <label className="field">
                <span className="field-label">Counselor's email</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
              </label>
              <div className="cep-actions">
                <button type="submit" className="btn-primary" disabled={!valid || busy}>
                  {busy ? "Writing your email…" : "Write and open email"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
