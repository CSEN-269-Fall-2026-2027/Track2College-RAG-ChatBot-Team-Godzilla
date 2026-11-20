import { useRef, useState, type DragEvent } from "react";
import { CheckIcon, UploadIcon } from "../components/icons";
import { MAJOR_CHOICES, OTHER_MAJOR } from "../constants";
import { TRANSCRIPT_TYPES, usePlanning } from "../planning";
import { useProfile } from "../profile";
import type { Profile } from "../types";
import { GRADE_OPTIONS, US_STATES, applyTranscriptBasics, inferGraduationYear } from "./logic";

const EXPLORING_MAJOR = "__exploring__";

interface Props {
  questionId: string;
  profile: Profile;
  onChange: (next: Profile) => void;
}

export function QuestionFields({ questionId, profile, onChange }: Props) {
  switch (questionId) {
    case "confirm":
      return <ConfirmBasicsForm profile={profile} onChange={onChange} />;
    case "transcript":
      return <TranscriptField />;
    default:
      return null;
  }
}

function ConfirmBasicsForm({ profile, onChange }: { profile: Profile; onChange: (next: Profile) => void }) {
  const [editing, setEditing] = useState(false);
  const year = new Date().getFullYear();
  const years = Array.from({ length: 8 }, (_, i) => String(year + i));
  const setBasics = (patch: Partial<Profile["basics"]>) => onChange({ ...profile, basics: { ...profile.basics, ...patch } });
  const setAcademics = (patch: Partial<Profile["academics"]>) =>
    onChange({ ...profile, academics: { ...profile.academics, ...patch } });

  const gradeLabel = GRADE_OPTIONS.find((g) => g.id === profile.basics.gradeLevel)?.label
    || (profile.basics.gradeLevel ? `Grade ${profile.basics.gradeLevel}` : "—");
  const majorValue = profile.onboarding.exploringMajors
    ? EXPLORING_MAJOR
    : profile.goals.intendedMajor || "";

  const setMajor = (value: string) => {
    if (value === EXPLORING_MAJOR) {
      onChange({
        ...profile,
        goals: { ...profile.goals, intendedMajor: "" },
        onboarding: { ...profile.onboarding, exploringMajors: true },
      });
      return;
    }
    onChange({
      ...profile,
      goals: { ...profile.goals, intendedMajor: value },
      onboarding: { ...profile.onboarding, exploringMajors: false },
    });
  };

  const rows: { label: string; value: string }[] = [
    { label: "Name", value: [profile.basics.firstName, profile.basics.lastName].map((n) => n.trim()).filter(Boolean).join(" ") || "—" },
    { label: "Current grade", value: gradeLabel },
    { label: "Graduation year", value: profile.basics.graduationYear || "—" },
    { label: "State", value: profile.basics.state || "—" },
    { label: "High school", value: profile.basics.highSchool.trim() || "—" },
    {
      label: "GPA",
      value: [profile.academics.gpaUnweighted && `${profile.academics.gpaUnweighted} unweighted`, profile.academics.gpaWeighted && `${profile.academics.gpaWeighted} weighted`]
        .filter(Boolean)
        .join(" · ") || "—",
    },
  ];

  return (
    <div className="ob-confirm">
      <div className={`ob-confirm-card ${editing ? "is-editing" : ""}`}>
        <div className="ob-confirm-card-head">
          <p className="ob-confirm-card-title">Your details</p>
          <button type="button" className="ob-link" onClick={() => setEditing((v) => !v)}>
            {editing ? "Done" : "Edit"}
          </button>
        </div>

        {editing ? (
          <div className="ob-confirm-edit">
            <div className="ob-row">
              <label className="ob-field">
                <span>First name</span>
                <input
                  value={profile.basics.firstName}
                  onChange={(e) => setBasics({ firstName: e.target.value })}
                  autoComplete="given-name"
                  placeholder="First name"
                  autoFocus
                />
              </label>
              <label className="ob-field">
                <span>Last name</span>
                <input
                  value={profile.basics.lastName}
                  onChange={(e) => setBasics({ lastName: e.target.value })}
                  autoComplete="family-name"
                  placeholder="Last name"
                />
              </label>
            </div>

            <div className="ob-field">
              <span>Current grade</span>
              <div className="ob-chips">
                {GRADE_OPTIONS.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className={`ob-chip ${profile.basics.gradeLevel === g.id ? "on" : ""}`}
                    aria-pressed={profile.basics.gradeLevel === g.id}
                    onClick={() =>
                      setBasics({
                        gradeLevel: g.id,
                        graduationYear: profile.basics.graduationYear || inferGraduationYear(g.id),
                      })
                    }
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="ob-row">
              <label className="ob-field">
                <span>Graduation year</span>
                <select value={profile.basics.graduationYear} onChange={(e) => setBasics({ graduationYear: e.target.value })}>
                  <option value="">Select year</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ob-field">
                <span>State</span>
                <select value={profile.basics.state} onChange={(e) => setBasics({ state: e.target.value })}>
                  <option value="">Select</option>
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  <option value="Outside US">Outside the U.S.</option>
                </select>
              </label>
            </div>

            <label className="ob-field">
              <span>High school</span>
              <input
                value={profile.basics.highSchool}
                onChange={(e) => setBasics({ highSchool: e.target.value })}
                placeholder="School name"
              />
            </label>

            <div className="ob-row">
              <label className="ob-field">
                <span>Unweighted GPA</span>
                <input
                  value={profile.academics.gpaUnweighted}
                  onChange={(e) => setAcademics({ gpaUnweighted: e.target.value })}
                  placeholder="e.g. 3.6"
                  inputMode="decimal"
                />
              </label>
              <label className="ob-field">
                <span>Weighted GPA</span>
                <input
                  value={profile.academics.gpaWeighted}
                  onChange={(e) => setAcademics({ gpaWeighted: e.target.value })}
                  placeholder="Optional"
                  inputMode="decimal"
                />
              </label>
            </div>
          </div>
        ) : (
          <dl className="ob-confirm-review">
            {rows.map((row) => (
              <div key={row.label} className="ob-confirm-row">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <label className="ob-field">
        <span>Intended major</span>
        <select value={majorValue} onChange={(e) => setMajor(e.target.value)}>
          <option value="">Select a major</option>
          {MAJOR_CHOICES.filter((m) => m !== OTHER_MAJOR).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          <option value={OTHER_MAJOR}>{OTHER_MAJOR}</option>
          <option value={EXPLORING_MAJOR}>Still exploring</option>
        </select>
      </label>
    </div>
  );
}

/** Required transcript upload; prefills name, school, grade, year, and GPA when blank. */
function TranscriptField() {
  const { transcripts, upload, uploading, uploadError, loadError, reload } = usePlanning();
  const { update } = useProfile();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const latest = transcripts[0];

  const send = async (file: File) => {
    const saved = await upload(file);
    if (!saved) return;
    update((p) => applyTranscriptBasics(p, saved));
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) send(file);
  };

  return (
    <div className="ob-transcript">
      <input
        ref={inputRef}
        type="file"
        accept={TRANSCRIPT_TYPES}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) send(file);
          e.target.value = "";
        }}
      />
      {latest && !uploading ? (
        <div className="ob-transcript-done" role="status">
          <CheckIcon width={18} height={18} />
          <span>
            <strong>{latest.fileName}</strong>
            {latest.courses.length} courses read{latest.school ? ` · ${latest.school}` : ""}
          </span>
          <button type="button" className="ob-link" onClick={() => inputRef.current?.click()}>
            Replace
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`dropzone ${dragging ? "dragging" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          disabled={!!uploading}
        >
          <span className="dropzone-icon">
            <UploadIcon width={22} height={22} />
          </span>
          {uploading ? (
            <span className="shimmer">Reading {uploading}… this can take up to a minute.</span>
          ) : (
            <>
              <strong>Drop your transcript here or click to upload</strong>
              <span>PDF, TXT, CSV, or Markdown (.md) up to 5 MB. Required to continue.</span>
            </>
          )}
        </button>
      )}
      {loadError && (
        <p className="form-error dropzone-error" role="alert">
          {loadError} <button type="button" className="ob-link" onClick={reload}>Retry</button>
        </p>
      )}
      {uploadError && (
        <p className="form-error dropzone-error" role="alert">
          {uploadError}
        </p>
      )}
    </div>
  );
}
