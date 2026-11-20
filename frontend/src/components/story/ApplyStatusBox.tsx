import type { ApplyIssue } from "../../agent/useBackgroundApply";
import type { UcRun } from "../../api";

interface ApplyStatusBoxProps {
  run: UcRun | null;
  issue: ApplyIssue | null;
  running: boolean;
  onWatch: () => void;
  onStop: () => void;
  onRetry: () => void;
  onChangeLogin: () => void;
}

/** Live UC-assistant progress in the chat (replaces under-character status and opener rewrites). */
export function ApplyStatusBox({ run, issue, running, onWatch, onStop, onRetry, onChangeLogin }: ApplyStatusBoxProps) {
  const finished = !!run?.finished;
  const loginIssue = issue?.kind === "login";
  const failed = !!issue && issue.kind !== "code" && issue.kind !== "your-turn";

  let title = "UC application";
  let body = run?.detail?.trim() || "Starting…";
  if (issue && issue.kind !== "code") {
    title = issue.kind === "login" ? "UC login" : issue.kind === "your-turn" ? "Your turn" : "UC assistant";
    body = issue.message;
  } else if (finished) {
    title = "Ready for review";
    body = run?.detail?.trim() || "Filled in everything it could. Look it over on UC's site and submit it yourself.";
  } else if (running) {
    title = "Filling in your UC application";
  }

  return (
    <div className="apply-status-box" role="status" aria-live="polite">
      <div className="apply-status-box-head">
        <span className={`apply-status-dot${running ? " is-live" : failed ? " is-bad" : finished ? " is-good" : ""}`} aria-hidden />
        <strong>{title}</strong>
      </div>
      <p className="apply-status-box-body">{body}</p>
      <div className="apply-status-box-actions">
        {running && (
          <>
            <button type="button" className="story-opener-action" onClick={onWatch}>
              Watch
            </button>
            <button type="button" className="story-opener-action" onClick={onStop}>
              Stop
            </button>
          </>
        )}
        {loginIssue && (
          <button type="button" className="story-opener-action" onClick={onChangeLogin}>
            Change UC login
          </button>
        )}
        {failed && !loginIssue && (
          <>
            <button type="button" className="story-opener-action" onClick={onWatch}>
              See what happened
            </button>
            <button type="button" className="story-opener-action" onClick={onRetry}>
              Try again
            </button>
          </>
        )}
        {issue?.kind === "your-turn" && (
          <button type="button" className="story-opener-action" onClick={onWatch}>
            Open live view
          </button>
        )}
      </div>
    </div>
  );
}
