import { memo, useState } from "react";
import type { Message } from "../types";
import { useElapsed, useReveal } from "../hooks";
import { Markdown } from "./Markdown";
import { CheckIcon, CopyIcon, CornerIcon, ExternalIcon, RetryIcon } from "./icons";

function describeSource(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop();
    return { host, path: path ? decodeURIComponent(path).replace(/[-_]+/g, " ") : "" };
  } catch {
    return { host: url, path: "" };
  }
}

/** Ready-made questions longer than this show collapsed to a few lines with "See more". */
const PRESET_PREVIEW_CHARS = 140;

export const UserMessage = memo(function UserMessage({ message }: { message: Message }) {
  const long = !!message.preset && message.content.length > PRESET_PREVIEW_CHARS;
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="row row-user">
      <div className={`bubble bubble-user${long && !expanded ? " is-clamped" : ""}`}>
        <span className="bubble-text">{message.content}</span>
        {long && (
          <button type="button" className="bubble-more" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
            {expanded ? "See less" : "See more"}
          </button>
        )}
      </div>
    </div>
  );
});

interface AssistantMessageProps {
  message: Message;
  animate: boolean;
  busy: boolean;
  onFollowup: (question: string) => void;
  onRetry: () => void;
}

export const AssistantMessage = memo(function AssistantMessage({
  message,
  animate,
  busy,
  onFollowup,
  onRetry,
}: AssistantMessageProps) {
  const { visible, done } = useReveal(message.content, animate);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const sources = message.sources?.length ? `\n\nSources:\n${message.sources.map((s) => `- ${s}`).join("\n")}` : "";
    try {
      await navigator.clipboard.writeText(message.content + sources);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied; nothing useful to show.
    }
  };

  if (message.error) {
    return (
      <div className="row row-assistant">
        <div className="bubble bubble-assistant bubble-error" role="alert">
          <p>{message.content}</p>
          <button className="btn-ghost" onClick={onRetry} disabled={busy}>
            <RetryIcon width={15} height={15} /> Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="row row-assistant">
      <div className="bubble bubble-assistant">
        <Markdown text={visible} />
      </div>

      {done && (
        <div className="assistant-extras">
          {!!message.sources?.length && (
            <section className="sources" aria-label="Sources">
              <div className="source-list">
                {message.sources.map((url, i) => {
                  const { host, path } = describeSource(url);
                  return (
                    <a key={url} className="source-chip" href={url} target="_blank" rel="noreferrer noopener" title={url}>
                      <span className="source-index">{i + 1}</span>
                      <span className="source-text">
                        <span className="source-host">{host}</span>
                        {path && <span className="source-path">{path}</span>}
                      </span>
                      <ExternalIcon width={13} height={13} className="source-ext" />
                    </a>
                  );
                })}
              </div>
            </section>
          )}

          {!!message.followups?.length && (
            <section className="followups followups-chips" aria-label="Suggested follow-up questions">
              {message.followups.map((question) => (
                <button key={question} className="followup-chip" onClick={() => onFollowup(question)} disabled={busy}>
                  <CornerIcon width={13} height={13} />
                  <span>{question}</span>
                </button>
              ))}
            </section>
          )}

          <div className="message-actions">
            <button className="icon-btn" onClick={copy} aria-label={copied ? "Copied" : "Copy answer"} title="Copy">
              {copied ? <CheckIcon width={16} height={16} /> : <CopyIcon width={16} height={16} />}
            </button>
            {message.responseTimeMs !== undefined && (
              <span className="meta">{(message.responseTimeMs / 1000).toFixed(1)}s</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export function ThinkingMessage() {
  const seconds = useElapsed(true);
  const label = seconds < 3 ? "Typing…" : seconds < 12 ? "Still typing…" : "Working on a longer reply…";

  return (
    <div className="row row-assistant" aria-live="polite">
      <div className="bubble bubble-assistant bubble-thinking">
        <span className="typing-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="visually-hidden">{label}</span>
        {seconds >= 8 && <span className="meta">{seconds}s</span>}
      </div>
    </div>
  );
}
