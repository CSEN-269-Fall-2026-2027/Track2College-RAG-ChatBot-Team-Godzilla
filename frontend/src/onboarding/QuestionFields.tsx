import { useRef, useState, type DragEvent } from "react";
import { CheckIcon, UploadIcon } from "../components/icons";
import { MAJOR_CHOICES } from "../constants";
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
  toggleList,
} from "./logic";

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

export function SummaryList({ profile, onJump }: { profile: Profile; onJump: (checkpoint: number) => void }) {
  const { transcripts } = usePlanning();
  const rows = [
    { i: 0, label: "You", value: [profile.basics.firstName, profile.basics.gradeLevel && `Grade ${profile.basics.gradeLevel}`, profile.basics.graduationYear, profile.basics.state].filter(Boolean).join(" · ") },
    {
      i: 1,
      label: "Academic history",
      value: [transcripts[0] && `Transcript: ${transcripts[0].fileName}`, profile.basics.highSchool, profile.academics.gpaUnweighted && `GPA ${profile.academics.gpaUnweighted}`].filter(Boolean).join(", ") || "Skipped — add it later",
    },
    { i: 2, label: "Interests", value: profile.onboarding.exploringMajors ? "Still exploring" : profile.goals.intendedMajor || profile.onboarding.subjects.join(", ") || "—" },
  ];

  return (
    <ul className="ob-summary">
      {rows.map((r) => (
        <li key={r.i}>
          <div>
            <strong>{r.label}</strong>
            <span>{r.value || "Not set"}</span>
          </div>
          <button type="button" className="ob-link" onClick={() => onJump(r.i)}>
            Edit
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Optional transcript upload; fills in school and GPA when they're still blank. */
function TranscriptField() {
  const { transcripts, upload, uploading, uploadError } = usePlanning();
  const { update } = useProfile();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const latest = transcripts[0];

  const send = async (file: File) => {
    const saved = await upload(file);
    if (!saved) return;
    update((p) => ({
      ...p,
      basics: { ...p.basics, highSchool: p.basics.highSchool || saved.school },
      academics: {
        ...p.academics,
        gpaUnweighted: p.academics.gpaUnweighted || saved.reportedGpa.unweighted,
        gpaWeighted: p.academics.gpaWeighted || saved.reportedGpa.weighted,
      },
    }));
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
              <span>PDF, TXT, CSV, or Markdown (.md) up to 5 MB. No transcript? Just continue and answer a few questions instead.</span>
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
