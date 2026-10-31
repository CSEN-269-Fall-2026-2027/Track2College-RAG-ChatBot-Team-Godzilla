import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Message } from "../types";
import { AssistantMessage, ThinkingMessage, UserMessage } from "./Message";
import { ArrowUpIcon } from "./icons";

interface ChatViewProps {
  /** Shown above the first message (e.g. the guide's opening line). */
  intro?: ReactNode;
  messages: Message[];
  pending: boolean;
  busy: boolean;
  freshId: string | null;
  onFollowup: (question: string) => void;
  onRetry: () => void;
}

const STICK_THRESHOLD = 96;

export function ChatView({ intro, messages, pending, busy, freshId, onFollowup, onRetry }: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  };

  // Follow the bottom while content grows (new messages, text reveal), unless the user scrolled up.
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (stickRef.current) scrollToBottom();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const last = messages.at(-1);
  useEffect(() => {
    if (last?.role === "user") {
      stickRef.current = true;
      scrollToBottom("smooth");
    }
  }, [last?.id, last?.role]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
    stickRef.current = nearBottom;
    setShowJump(!nearBottom);
  };

  return (
    <div className="chat-area">
      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="chat-content" ref={contentRef}>
          {intro}
        {messages.map((message, index) =>
          message.role === "user" ? (
            <UserMessage key={message.id} message={message} />
          ) : (
            <AssistantMessage
              key={message.id}
              message={message}
              animate={message.id === freshId}
              busy={busy}
              onFollowup={onFollowup}
              onRetry={index === messages.length - 1 ? onRetry : noop}
            />
          ),
        )}
          {pending && <ThinkingMessage />}
        </div>
      </div>
      {showJump && (
        <button
          className="jump-btn"
          onClick={() => {
            stickRef.current = true;
            scrollToBottom("smooth");
          }}
          aria-label="Scroll to latest message"
        >
          <ArrowUpIcon width={16} height={16} style={{ transform: "rotate(180deg)" }} />
        </button>
      )}
    </div>
  );
}

function noop() {}
