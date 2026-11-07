import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useAuth } from "../auth";
import { getStore } from "../data";
import { AlertIcon, XIcon } from "./icons";

/** Longer than the profile (500ms) and game (800ms) save debounces, so queued saves land before we delete. */
const FLUSH_MS = 1000;

/** Password-confirmed wipe of everything saved for the signed-in user, then a fresh start. */
export function ResetDataDialog({ onClose }: { onClose: () => void }) {
  const { account } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!account || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, FLUSH_MS));
      await (await getStore()).resetAllData(account.id, account.email, password);
      // Wipe local caches for this user (game, map, drafts).
      const prefixes = [`t2c.u.${account.id}.`, `t2c.${account.id}.`];
      for (const store of [localStorage, sessionStorage]) {
        for (const key of Object.keys(store)) {
          if (prefixes.some((p) => key.startsWith(p))) store.removeItem(key);
        }
      }
      window.location.hash = "";
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Nothing was deleted.");
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !busy) onClose();
    if (event.key !== "Tab" || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input")];
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="reset-wrap" onKeyDown={onKeyDown}>
      <button className="reset-scrim" onClick={() => !busy && onClose()} tabIndex={-1} aria-label="Cancel" />
      <div className="reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-desc" ref={dialogRef}>
        <header>
          <span className="reset-icon" aria-hidden="true">
            <AlertIcon width={18} height={18} />
          </span>
          <h2 id="reset-title">Reset all data?</h2>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close">
            <XIcon width={16} height={16} />
          </button>
        </header>
        <p id="reset-desc">
          This permanently deletes everything saved to your account: your profile, chats, transcripts and uploaded files,
          essay progress, journey map, and XP. Your login stays, and you'll start over from onboarding. <strong>This can't be undone.</strong>
        </p>
        <form onSubmit={submit}>
          <label htmlFor="reset-password">Enter your password to confirm</label>
          <input
            id="reset-password"
            ref={inputRef}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            aria-invalid={!!error}
            aria-describedby={error ? "reset-error" : undefined}
          />
          {error && (
            <p className="reset-error" id="reset-error" role="alert">
              {error}
            </p>
          )}
          <div className="reset-actions">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="reset-confirm" disabled={!password || busy}>
              {busy ? "Deleting…" : "Delete everything"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
