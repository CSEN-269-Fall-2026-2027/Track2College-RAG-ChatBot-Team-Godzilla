import { useCallback, useEffect, useState } from "react";
import { ApiError, getGoogleStatus, startGoogleOAuth, type GoogleConnectionStatus } from "../api";
import { useGoogleActivities } from "../googleActivities";

interface GoogleConnectPanelProps {
  onContinue: () => void;
  onBack: () => void;
}

function clearGoogleQueryParams() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("google") && !url.searchParams.has("google_error")) return;
  url.searchParams.delete("google");
  url.searchParams.delete("google_error");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function GoogleConnectPanel({ onContinue, onBack }: GoogleConnectPanelProps) {
  const { scan } = useGoogleActivities();
  const [status, setStatus] = useState<GoogleConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justConnected, setJustConnected] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await getGoogleStatus(signal);
      setStatus(next);
      setError(null);
      return next;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Couldn't check Google connection.";
      setError(message);
      setStatus(null);
      return null;
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("google");
    const detail = params.get("google_error");
    clearGoogleQueryParams();

    const ac = new AbortController();
    (async () => {
      setLoading(true);
      const next = await refresh(ac.signal);
      if (ac.signal.aborted) return;
      if (result === "connected") {
        setJustConnected(true);
        const connected = next?.connected ? next : await refresh(ac.signal);
        if (!ac.signal.aborted && connected?.connected) void scan({ force: true });
      } else if (result === "error") {
        setError(detail || "Google connect didn't finish. You can try again or skip.");
      }
      setLoading(false);
    })();
    return () => ac.abort();
  }, [refresh, scan]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await startGoogleOAuth();
      window.location.assign(url);
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError ? err.message : "Couldn't start Google connect.");
    }
  };

  const connected = Boolean(status?.connected);
  const configured = status == null || status.configured;

  return (
    <>
      <p className="ob-section-tag">Step 2 · Optional</p>
      <h1 id="ob-heading">Connect Google</h1>

      <div className="ob-google">
        {loading ? (
          <p className="ob-google-status">Checking connection…</p>
        ) : connected ? (
          <div className={`ob-google-card ${justConnected ? "is-success" : ""}`} role="status">
            <p className="ob-google-title">Google connected</p>
            <p className="ob-google-detail">
              {status?.googleEmail ? `Signed in as ${status.googleEmail}` : "Your Google account is linked."}
            </p>
            <p className="ob-google-note">Readonly access only — we won’t send mail or change files.</p>
          </div>
        ) : (
          <div className="ob-google-scopes">
            <p className="ob-google-scopes-title">What we will access</p>
            <ul className="ob-google-list">
              <li>Gmail (Read Only)</li>
              <li>Google Calendar (Read Only)</li>
              <li>Google Drive (Read Only)</li>
            </ul>
          </div>
        )}

        {error && (
          <ul className="ob-errors" role="alert">
            <li>{error}</li>
          </ul>
        )}
      </div>

      <div className="ob-actions">
        <button type="button" className="btn-ghost" onClick={onBack} disabled={busy}>
          Back
        </button>
        <div className="ob-actions-right">
          {!connected && (
            <button type="button" className="ob-skip" onClick={onContinue} disabled={busy}>
              Skip for now
            </button>
          )}
          {connected ? (
            <button type="button" className="btn-primary" onClick={onContinue}>
              Continue
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={connect} disabled={busy || !configured}>
              {busy ? "Opening Google…" : "Connect Google"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
