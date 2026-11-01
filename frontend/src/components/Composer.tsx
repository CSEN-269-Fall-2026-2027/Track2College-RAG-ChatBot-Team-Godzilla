import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUpIcon, StopIcon } from "./icons";

interface ComposerProps {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  focusKey: string;
  placeholder?: string;
}

const MAX_HEIGHT = 220;

export function Composer({ busy, onSend, onStop, focusKey, placeholder }: ComposerProps) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) ref.current?.focus({ preventScroll: true });
  }, [focusKey]);

  const submit = () => {
    const text = value.trim();
    if (!text || busy) return;
    onSend(text);
    setValue("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const canSend = value.trim().length > 0 && !busy;

  return (
    <div className="composer-wrap">
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={ref}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? "Ask about admissions, financial aid, scholarships…"}
          rows={1}
          aria-label="Message Track2College"
        />
        {busy ? (
          <button type="button" className="send-btn stop" onClick={onStop} aria-label="Stop generating">
            <StopIcon />
          </button>
        ) : (
          <button type="submit" className="send-btn" disabled={!canSend} aria-label="Send message">
            <ArrowUpIcon />
          </button>
        )}
      </form>
      <p className="disclaimer">
        Track2College can make mistakes. Confirm deadlines and requirements with your counselor or the college.
      </p>
    </div>
  );
}
