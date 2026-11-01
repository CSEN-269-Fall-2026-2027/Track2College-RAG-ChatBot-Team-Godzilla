import { useId, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { XIcon } from "./icons";

interface FieldShellProps {
  label: string;
  hint?: string;
  wide?: boolean;
  children: (id: string) => ReactNode;
}

function FieldShell({ label, hint, wide, children }: FieldShellProps) {
  const id = useId();
  return (
    <div className={`field ${wide ? "field-wide" : ""}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

type TextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  wide?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">;

export function TextField({ label, value, onChange, hint, wide, ...rest }: TextFieldProps) {
  return (
    <FieldShell label={label} hint={hint} wide={wide}>
      {(id) => <input id={id} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />}
    </FieldShell>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  hint,
  placeholder,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <FieldShell label={label} hint={hint} wide>
      {(id) => <textarea id={id} value={value} rows={rows} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </FieldShell>
  );
}

export interface Option<T extends string> {
  value: T;
  label: string;
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  placeholder = "Select…",
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <FieldShell label={label} hint={hint}>
      {(id) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className={value ? "" : "placeholder"}>
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  wide,
  hint,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  wide?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className={`field ${wide ? "field-wide" : ""}`} role="radiogroup" aria-labelledby={id}>
      <span className="field-label" id={id}>
        {label}
      </span>
      <div className="segmented">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={value === o.value ? "on" : ""}
            onClick={() => onChange((value === o.value ? "" : o.value) as T)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function ChipsInput({
  label,
  values,
  onChange,
  suggestions = [],
  placeholder,
  max = 5,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  max?: number;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const value = raw.trim().replace(/,$/, "");
    if (!value || values.length >= max || values.some((v) => v.toLowerCase() === value.toLowerCase())) return;
    onChange([...values, value]);
    setDraft("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(draft);
    } else if (event.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };
  const remaining = suggestions.filter((s) => !values.includes(s)).slice(0, 8);

  return (
    <FieldShell label={label} wide hint={`Press Enter to add · up to ${max}`}>
      {(id) => (
        <>
          <div className="chips-input">
            {values.map((v) => (
              <span key={v} className="chip">
                {v}
                <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
                  <XIcon width={12} height={12} />
                </button>
              </span>
            ))}
            {values.length < max && (
              <input
                id={id}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                onBlur={() => add(draft)}
                placeholder={values.length ? "" : placeholder}
              />
            )}
          </div>
          {remaining.length > 0 && values.length < max && (
            <div className="chip-suggestions">
              {remaining.map((s) => (
                <button key={s} type="button" className="chip chip-ghost" onClick={() => add(s)}>
                  + {s}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </FieldShell>
  );
}

export function ProgressRing({ value, size = 44, stroke = 4 }: { value: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="ring" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="ring-track" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={stroke}
        className="ring-value"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, Math.max(0, value)))}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
