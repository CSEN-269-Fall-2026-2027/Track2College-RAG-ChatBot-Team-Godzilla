import { useRef, useState, type DragEvent } from "react";
import { CheckIcon, UploadIcon } from "../components/icons";
import { MAJOR_CHOICES, OTHER_MAJOR } from "../constants";
import { TRANSCRIPT_TYPES, usePlanning } from "../planning";
import { useProfile } from "../profile";
import type { Profile } from "../types";
import {
  ACTIVITY_CHIPS,
  CAREER_CHIPS,
  DISTANCE_CHIPS,
  GRADE_OPTIONS,
  HELP_CHIPS,
  PRIORITY_CHIPS,
  REGION_CHIPS,
  SIZE_CHIPS,
  SUBJECT_CHIPS,
  US_STATES,
  applyTranscriptBasics,
  inferGraduationYear,
  toggleList,
} from "./logic";

const EXPLORING_MAJOR = "__exploring__";

interface Props {
  questionId: string;
  profile: Profile;
  onChange: (next: Profile) => void;
}

function Chips({
  options,
  selected,
  onToggle,
  multi = true,
}: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  multi?: boolean;
}) {
  return (
    <div className="ob-chips" role="group">
      {options.map((opt) => {
        const on = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            className={`ob-chip ${on ? "on" : ""}`}
            aria-pressed={on}
            onClick={() => {
              if (multi) onToggle(opt);
              else onToggle(on ? "" : opt);
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export function QuestionFields({ questionId, profile, onChange }: Props) {
  const year = new Date().getFullYear();
  const years = Array.from({ length: 8 }, (_, i) => String(year + i));
  const setOb = (patch: Partial<Profile["onboarding"]>) =>
    onChange({ ...profile, onboarding: { ...profile.onboarding, ...patch } });

  switch (questionId) {
    case "confirm":
      return <ConfirmBasicsForm profile={profile} onChange={onChange} />;
    case "name":
      return (
        <label className="ob-field">
          <span className="visually-hidden">Preferred name</span>
          <input
            value={profile.basics.firstName}
            onChange={(e) => onChange({ ...profile, basics: { ...profile.basics, firstName: e.target.value } })}
            autoComplete="nickname"
            placeholder="Your name"
            autoFocus
          />
        </label>
      );
    case "grade":
      return (
        <div className="ob-chips">
          {GRADE_OPTIONS.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`ob-chip ${profile.basics.gradeLevel === g.id ? "on" : ""}`}
              aria-pressed={profile.basics.gradeLevel === g.id}
              onClick={() => onChange({ ...profile, basics: { ...profile.basics, gradeLevel: g.id } })}
            >
              {g.label}
            </button>
          ))}
        </div>
      );
    case "year":
      return (
        <label className="ob-field">
          <span className="visually-hidden">Graduation year</span>
          <select
            value={profile.basics.graduationYear}
            onChange={(e) => onChange({ ...profile, basics: { ...profile.basics, graduationYear: e.target.value } })}
          >
            <option value="">Select year</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      );
    case "school":
      return (
        <label className="ob-field">
          <span className="visually-hidden">High school</span>
          <input
            value={profile.basics.highSchool}
            onChange={(e) => onChange({ ...profile, basics: { ...profile.basics, highSchool: e.target.value } })}
            placeholder="School name"
          />
        </label>
      );
    case "state":
      return (
        <label className="ob-field">
          <span className="visually-hidden">State</span>
          <select value={profile.basics.state} onChange={(e) => onChange({ ...profile, basics: { ...profile.basics, state: e.target.value } })}>
            <option value="">Select</option>
            {US_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value="Outside US">Outside the U.S.</option>
          </select>
        </label>
      );
    case "gpa":
      return (
        <div className="ob-row">
          <label className="ob-field">
            <span className="visually-hidden">GPA</span>
            <input
              value={profile.academics.gpaUnweighted}
              onChange={(e) => onChange({ ...profile, academics: { ...profile.academics, gpaUnweighted: e.target.value } })}
              placeholder="e.g. 3.6"
              inputMode="decimal"
            />
          </label>
          <label className="ob-field">
            <span className="visually-hidden">Scale</span>
            <select value={profile.onboarding.gpaScale || "4.0"} onChange={(e) => setOb({ gpaScale: e.target.value })}>
              <option value="4.0">4.0</option>
              <option value="5.0">5.0 weighted</option>
              <option value="100">100-point</option>
            </select>
          </label>
        </div>
      );
    case "classes":
      return (
        <label className="ob-field">
          <span className="visually-hidden">Classes</span>
          <textarea
            value={profile.academics.coursework}
            onChange={(e) => onChange({ ...profile, academics: { ...profile.academics, coursework: e.target.value } })}
            placeholder="e.g. AP Chem, Algebra 2…"
            rows={3}
          />
        </label>
      );
    case "subjects":
      return (
        <Chips
          options={SUBJECT_CHIPS}
          selected={profile.onboarding.subjects}
          onToggle={(v) => setOb({ subjects: toggleList(profile.onboarding.subjects, v) })}
        />
      );
    case "majors":
      return (
        <div className="ob-stack">
          <Chips
            options={MAJOR_CHOICES}
            selected={[profile.goals.intendedMajor]}
            multi={false}
            onToggle={(v) =>
              onChange({
                ...profile,
                goals: { ...profile.goals, intendedMajor: v },
                onboarding: { ...profile.onboarding, exploringMajors: false },
              })
            }
          />
          <button
            type="button"
            className={`ob-chip ${profile.onboarding.exploringMajors ? "on" : ""}`}
            aria-pressed={profile.onboarding.exploringMajors}
            onClick={() =>
              onChange({
                ...profile,
                goals: { ...profile.goals, intendedMajor: "" },
                onboarding: { ...profile.onboarding, exploringMajors: !profile.onboarding.exploringMajors },
              })
            }
          >
            I’m still exploring
          </button>
        </div>
      );
    case "careers":
      return (
        <Chips
          options={CAREER_CHIPS}
          selected={profile.goals.careers ? profile.goals.careers.split(", ").filter(Boolean) : []}
          onToggle={(v) => {
            const cur = profile.goals.careers ? profile.goals.careers.split(", ").filter(Boolean) : [];
            onChange({ ...profile, goals: { ...profile.goals, careers: toggleList(cur, v).join(", ") } });
          }}
        />
      );
    case "activities": {
      const labels = profile.activities.map((a) => a.name).filter((n) => ACTIVITY_CHIPS.includes(n));
      return (
        <Chips
          options={ACTIVITY_CHIPS}
          selected={labels}
          onToggle={(v) => {
            const next = toggleList(labels, v);
            const kept = profile.activities.filter((a) => !ACTIVITY_CHIPS.includes(a.name));
            const added = next.map((name) => {
              const prev = profile.activities.find((a) => a.name === name);
              return prev ?? { id: crypto.randomUUID(), name, role: "", hoursPerWeek: "", weeksPerYear: "", years: "", description: "", category: "" as const };
            });
            onChange({ ...profile, activities: [...kept, ...added] });
          }}
        />
      );
    }
    case "activityNote":
      return (
        <label className="ob-field">
          <span className="visually-hidden">Experience note</span>
          <textarea
            value={profile.onboarding.activityNote}
            onChange={(e) => {
              const activityNote = e.target.value.slice(0, 280);
              const activities = profile.activities.map((a, i) => (i === 0 ? { ...a, description: activityNote } : a));
              onChange({ ...profile, activities, onboarding: { ...profile.onboarding, activityNote } });
            }}
            rows={3}
            placeholder="A sentence or two…"
          />
        </label>
      );
    case "regions":
      return (
        <Chips
          options={REGION_CHIPS}
          selected={profile.preferences.regions ? profile.preferences.regions.split(" · ").filter(Boolean) : []}
          onToggle={(v) => {
            const cur = profile.preferences.regions ? profile.preferences.regions.split(" · ").filter(Boolean) : [];
            onChange({ ...profile, preferences: { ...profile.preferences, regions: toggleList(cur, v).join(" · ") } });
          }}
        />
      );
    case "distance":
      return (
        <Chips
          options={DISTANCE_CHIPS}
          selected={profile.onboarding.distance ? [profile.onboarding.distance] : []}
          multi={false}
          onToggle={(v) => setOb({ distance: v })}
        />
      );
    case "size":
      return (
        <div className="ob-chips">
          {SIZE_CHIPS.map((s) => (
            <button
              key={s.id || "any"}
              type="button"
              className={`ob-chip ${profile.preferences.campusSize === s.id ? "on" : ""}`}
              aria-pressed={profile.preferences.campusSize === s.id}
              onClick={() => onChange({ ...profile, preferences: { ...profile.preferences, campusSize: s.id } })}
            >
              {s.label}
            </button>
          ))}
        </div>
      );
    case "priorities":
      return (
        <Chips
          options={PRIORITY_CHIPS}
          selected={profile.onboarding.priorities}
          onToggle={(v) => setOb({ priorities: toggleList(profile.onboarding.priorities, v) })}
        />
      );
    case "aidConcern":
      return (
        <div className="ob-chips">
          {(
            [
              ["yes", "Yes"],
              ["no", "Not really"],
              ["unsure", "Not sure yet"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`ob-chip ${profile.preferences.needsAid === id ? "on" : ""}`}
              aria-pressed={profile.preferences.needsAid === id}
              onClick={() => onChange({ ...profile, preferences: { ...profile.preferences, needsAid: id } })}
            >
              {label}
            </button>
          ))}
        </div>
      );
    case "budget":
      return (
        <label className="ob-field">
          <span className="visually-hidden">Budget</span>
          <input
            value={profile.preferences.maxAnnualCost}
            onChange={(e) => onChange({ ...profile, preferences: { ...profile.preferences, maxAnnualCost: e.target.value } })}
            placeholder="e.g. under $15k / year"
          />
        </label>
      );
    case "aidInterest":
      return (
        <div className="ob-chips">
          {(
            [
              ["not-started", "Yes, later"],
              ["in-progress", "Already looking"],
              ["done", "Mostly figured out"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`ob-chip ${profile.preferences.fafsa === id ? "on" : ""}`}
              aria-pressed={profile.preferences.fafsa === id}
              onClick={() => onChange({ ...profile, preferences: { ...profile.preferences, fafsa: id } })}
            >
              {label}
            </button>
          ))}
        </div>
      );
    case "transcript":
      return <TranscriptField />;
    case "biggest":
      return (
        <label className="ob-field">
          <span className="visually-hidden">Biggest question</span>
          <textarea
            value={profile.onboarding.biggestQuestion}
            onChange={(e) => setOb({ biggestQuestion: e.target.value.slice(0, 240) })}
            rows={3}
            placeholder="What’s on your mind?"
          />
        </label>
      );
    case "help":
      return (
        <Chips
          options={HELP_CHIPS}
          selected={profile.onboarding.helpFocus ? [profile.onboarding.helpFocus] : []}
          multi={false}
          onToggle={(v) => setOb({ helpFocus: v })}
        />
      );
    case "else":
      return (
        <label className="ob-field">
          <span className="visually-hidden">Anything else</span>
          <textarea
            value={profile.goals.whyCollege}
            onChange={(e) => onChange({ ...profile, goals: { ...profile.goals, whyCollege: e.target.value.slice(0, 280) } })}
            rows={2}
            placeholder="Optional"
          />
        </label>
      );
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
    { label: "Name", value: profile.basics.firstName.trim() || "—" },
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
            <label className="ob-field">
              <span>Name</span>
              <input
                value={profile.basics.firstName}
                onChange={(e) => setBasics({ firstName: e.target.value })}
                autoComplete="nickname"
                placeholder="Your name"
                autoFocus
              />
            </label>

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
  const { transcripts, upload, uploading, uploadError } = usePlanning();
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
      {uploadError && (
        <p className="form-error dropzone-error" role="alert">
          {uploadError}
        </p>
      )}
    </div>
  );
}
