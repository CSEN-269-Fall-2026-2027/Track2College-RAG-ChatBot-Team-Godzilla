import { useMemo, useRef, useState, type DragEvent } from "react";
import { AG_AREAS, AREA_LABEL, LEVEL_LABEL, agProgress, computeGpa, formatGpa } from "../academics";
import { formatDate } from "../format";
import { TRANSCRIPT_TYPES, usePlanning } from "../planning";
import { useProfile } from "../profile";
import { href } from "../router";
import { newId } from "../storage";
import type { AgArea, CourseLevel, CourseStatus, Transcript, TranscriptCourse } from "../types";
import { BookIcon, ChatIcon, CheckIcon, FileIcon, PlusIcon, TrashIcon, UploadIcon } from "../components/icons";

const GRADE_ORDER: TranscriptCourse["gradeLevel"][] = ["9", "10", "11", "12", "other"];
const GRADE_TITLE: Record<TranscriptCourse["gradeLevel"], string> = {
  "9": "9th grade",
  "10": "10th grade",
  "11": "11th grade",
  "12": "12th grade",
  other: "Other / summer",
};

function Dropzone({ compact }: { compact?: boolean }) {
  const { upload, uploading, uploadError } = usePlanning();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) upload(file);
  };

  const picker = (
    <input
      ref={inputRef}
      type="file"
      accept={TRANSCRIPT_TYPES}
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) upload(file);
        e.target.value = "";
      }}
    />
  );

  if (compact) {
    return (
      <>
        {picker}
        <button className="btn-ghost" onClick={() => inputRef.current?.click()} disabled={!!uploading}>
          <UploadIcon width={15} height={15} /> {uploading ? "Reading…" : "Upload new"}
        </button>
      </>
    );
  }

  return (
    <div>
      {picker}
      <button
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
            <span>PDF, TXT, CSV, or Markdown (.md) up to 5 MB. Unofficial transcripts from your school portal work great.</span>
          </>
        )}
      </button>
      {uploadError && (
        <p className="form-error dropzone-error" role="alert">
          {uploadError}
        </p>
      )}
      <p className="privacy-note">Your transcript is sent to the AI only to read your courses and grades.</p>
    </div>
  );
}

export function TranscriptTab({ onAsk }: { onAsk: (text: string) => void }) {
  const { transcripts, updateTranscript, removeTranscript, uploadError, uploading, ensureManualTranscript } = usePlanning();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const transcript = transcripts.find((t) => t.id === selectedId) ?? transcripts[0];

  if (!transcript) {
    return (
      <section className="card">
        <header className="card-head">
          <h2>Courses &amp; transcript</h2>
          <p>Enter courses manually or optionally upload a transcript. An upload is never required for profile completion.</p>
        </header>
        <button className="btn-dashed" style={{ marginBottom: 16 }} onClick={() => ensureManualTranscript()}>
          Add courses manually
        </button>
        <Dropzone />
      </section>
    );
  }

  return (
    <>
      {(uploadError || uploading) && (
        <div className={uploadError ? "error-card" : "notice"}>
          {uploadError ? <p>{uploadError}</p> : <span className="shimmer">Reading {uploading}…</span>}
        </div>
      )}
      <TranscriptView
        transcript={transcript}
        transcripts={transcripts}
        onSelect={setSelectedId}
        onChange={updateTranscript}
        onRemove={() => {
          removeTranscript(transcript);
          setSelectedId(null);
        }}
        onAsk={onAsk}
      />
    </>
  );
}

interface ViewProps {
  transcript: Transcript;
  transcripts: Transcript[];
  onSelect: (id: string) => void;
  onChange: (transcript: Transcript) => void;
  onRemove: () => void;
  onAsk: (text: string) => void;
}

function TranscriptView({ transcript, transcripts, onSelect, onChange, onRemove, onAsk }: ViewProps) {
  const { update } = useProfile();
  const [applied, setApplied] = useState(false);
  const gpa = useMemo(() => computeGpa(transcript.courses), [transcript.courses]);
  const progress = useMemo(() => agProgress(transcript.courses), [transcript.courses]);
  const byGrade = useMemo(
    () => GRADE_ORDER.map((g) => ({ grade: g, courses: transcript.courses.filter((c) => c.gradeLevel === g) })).filter((g) => g.courses.length),
    [transcript.courses],
  );

  const patchCourse = (id: string, change: Partial<TranscriptCourse>) =>
    onChange({ ...transcript, courses: transcript.courses.map((c) => (c.id === id ? { ...c, ...change } : c)) });
  const removeCourse = (id: string) => onChange({ ...transcript, courses: transcript.courses.filter((c) => c.id !== id) });

  const applyToProfile = () => {
    update((p) => ({
      ...p,
      basics: { ...p.basics, highSchool: p.basics.highSchool || transcript.school },
      academics: {
        ...p.academics,
        // Prefer school-reported GPA when present; otherwise keep prior reported values.
        gpaUnweighted: p.academics.gpaUnweighted || transcript.reportedGpa.unweighted || p.academics.gpaUnweighted,
        gpaWeighted: p.academics.gpaWeighted || transcript.reportedGpa.weighted || p.academics.gpaWeighted,
      },
    }));
    setApplied(true);
  };

  const addCourse = () => {
    const course: TranscriptCourse = {
      id: newId(),
      name: "",
      gradeLevel: "11",
      term: "",
      grade: "",
      level: "regular",
      area: "unknown",
      semesters: 1,
      status: "completed",
      school: transcript.school || "",
    };
    onChange({ ...transcript, courses: [...transcript.courses, course] });
  };

  const missing = progress.filter((a) => a.completed < a.required);

  return (
    <>
      <section className="card transcript-head">
        <div className="transcript-file">
          <span className="stat-icon">
            <FileIcon />
          </span>
          <div>
            {transcripts.length > 1 ? (
              <select value={transcript.id} onChange={(e) => onSelect(e.target.value)} aria-label="Choose transcript" className="transcript-select">
                {transcripts.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.fileName} · {formatDate(t.uploadedAt)}
                  </option>
                ))}
              </select>
            ) : (
              <strong>{transcript.fileName}</strong>
            )}
            <p>
              {[transcript.school, `Uploaded ${formatDate(transcript.uploadedAt)}`, `${transcript.courses.length} courses`].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <div className="transcript-actions">
          <Dropzone compact />
          <button className="icon-btn" onClick={onRemove} aria-label="Delete transcript" title="Delete transcript">
            <TrashIcon width={16} height={16} />
          </button>
        </div>
      </section>

      <div className="stat-grid">
        <GpaStat label="Calculated unweighted" value={formatGpa(gpa.unweighted)} hint={transcript.reportedGpa.unweighted && `School reports ${transcript.reportedGpa.unweighted}`} />
        <GpaStat label="Calculated weighted" value={formatGpa(gpa.weighted)} hint={transcript.reportedGpa.weighted && `School reports ${transcript.reportedGpa.weighted}`} />
        <GpaStat label="Estimated capped UC GPA" value={formatGpa(gpa.ucCapped)} hint="Unofficial estimate · 10th–11th A–G, capped honors — not an official UC GPA" />
        <GpaStat label="AP / IB / college courses" value={String(gpa.advancedCourses)} hint={`${gpa.gradedSemesters} graded semesters`} />
      </div>

      <div className="apply-bar">
        <span>{applied ? "Reported GPA fields on your profile were updated from school-reported values when available." : "Copy school-reported GPA into your profile (calculated estimates stay here)."}</span>
        {applied ? (
          <a className="btn-ghost" href={href("profile", "academics")}>
            <CheckIcon width={15} height={15} /> Review profile
          </a>
        ) : (
          <button className="btn-primary" onClick={applyToProfile}>
            Update my profile
          </button>
        )}
      </div>

      <div className="two-col">
        <section className="card">
          <header className="card-head">
            <h2>A–G progress</h2>
            <p>UC A–G subject requirements, counting C or better</p>
          </header>
          <ul className="ag-list">
            {progress.map((area) => {
              const pct = Math.min(1, area.completed / area.required);
              return (
                <li key={area.id} className={pct >= 1 ? "met" : ""}>
                  <div className="ag-top">
                    <span>
                      <span className="ag-letter">{area.id}</span> {area.label}
                    </span>
                    <span className="ag-count">
                      {pct >= 1 && <CheckIcon width={13} height={13} />}
                      {area.completed / 2} / {area.required / 2} yr
                    </span>
                  </div>
                  <span className="mini-bar">
                    <span style={{ width: `${pct * 100}%` }} />
                  </span>
                </li>
              );
            })}
          </ul>
          {missing.length > 0 && (
            <button className="link-btn ag-ask" onClick={() => onAsk(`I still need ${missing.map((m) => m.label.toLowerCase()).join(", ")} for A–G. How can I fit these in before I graduate?`)}>
              <ChatIcon width={13} height={13} /> Ask how to finish A–G
            </button>
          )}
        </section>

        <section className="card">
          <header className="card-head">
            <h2>AI review</h2>
            <p>What stands out in your coursework</p>
          </header>
          {transcript.summary && <p className="ai-summary small">{transcript.summary}</p>}
          <div className="stack">
            {transcript.strengths.length > 0 && (
              <div className="pill-list strengths">
                <h3>Strengths</h3>
                <ul>
                  {transcript.strengths.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {transcript.concerns.length > 0 && (
              <div className="pill-list gaps">
                <h3>Watch out for</h3>
                <ul>
                  {transcript.concerns.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <a className="card-link plan-link" href={href("profile", "plan")}>
            <BookIcon width={14} height={14} /> Build a course plan from this transcript
          </a>
          <a className="card-link plan-link" href={href("profile", "academics")}>
            <CheckIcon width={14} height={14} /> Back to academics
          </a>
        </section>
      </div>

      <section className="card courses-card">
        <header className="card-head row-head">
          <div>
            <h2>Courses</h2>
            <p>School, year, term, level, grade, and status. Leave A–G as unknown if you’re unsure — we won’t invent a classification.</p>
          </div>
          <button className="btn-ghost" onClick={addCourse}>
            <PlusIcon width={15} height={15} /> Add course
          </button>
        </header>
        {transcript.courses.length === 0 && <p className="list-empty">No courses yet — add them manually or upload a transcript above.</p>}
        {byGrade.map(({ grade, courses }) => (
          <div key={grade} className="course-year">
            <h3>{GRADE_TITLE[grade]}</h3>
            <div className="course-table">
              {courses.map((course) => (
                <div key={course.id} className="course-row" style={{ flexWrap: "wrap" }}>
                  <input
                    className="course-name"
                    value={course.name}
                    onChange={(e) => patchCourse(course.id, { name: e.target.value })}
                    aria-label="Course name"
                    placeholder="Course name"
                  />
                  <input
                    className="course-term"
                    value={course.school ?? ""}
                    onChange={(e) => patchCourse(course.id, { school: e.target.value })}
                    aria-label={`School for ${course.name || "course"}`}
                    placeholder="School"
                  />
                  <input
                    className="course-term"
                    value={course.term}
                    onChange={(e) => patchCourse(course.id, { term: e.target.value })}
                    aria-label={`Term for ${course.name || "course"}`}
                    placeholder="Term"
                  />
                  <input
                    className="course-grade"
                    value={course.grade}
                    onChange={(e) => patchCourse(course.id, { grade: e.target.value })}
                    aria-label={`Grade for ${course.name || "course"}`}
                    placeholder="Grade"
                  />
                  <select value={course.gradeLevel} onChange={(e) => patchCourse(course.id, { gradeLevel: e.target.value as TranscriptCourse["gradeLevel"] })} aria-label="Grade level">
                    {GRADE_ORDER.map((g) => (
                      <option key={g} value={g}>
                        {GRADE_TITLE[g]}
                      </option>
                    ))}
                  </select>
                  <select value={course.level} onChange={(e) => patchCourse(course.id, { level: e.target.value as CourseLevel })} aria-label={`Level for ${course.name || "course"}`}>
                    {(Object.keys(LEVEL_LABEL) as CourseLevel[]).map((l) => (
                      <option key={l} value={l}>
                        {LEVEL_LABEL[l]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={course.status ?? "completed"}
                    onChange={(e) => patchCourse(course.id, { status: e.target.value as CourseStatus })}
                    aria-label={`Status for ${course.name || "course"}`}
                  >
                    <option value="completed">Completed</option>
                    <option value="in-progress">In progress</option>
                    <option value="planned">Planned</option>
                  </select>
                  <select value={course.area} onChange={(e) => patchCourse(course.id, { area: e.target.value as AgArea })} aria-label={`A–G area for ${course.name || "course"}`}>
                    {(["unknown", ...AG_AREAS.map((a) => a.id), "none"] as AgArea[]).map((a) => (
                      <option key={a} value={a}>
                        {a === "unknown" || a === "none" ? AREA_LABEL[a] : `${a.toUpperCase()} · ${AREA_LABEL[a]}`}
                      </option>
                    ))}
                  </select>
                  <button className="icon-btn" onClick={() => removeCourse(course.id)} aria-label={`Remove ${course.name || "course"}`}>
                    <TrashIcon width={15} height={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}

function GpaStat({ label, value, hint }: { label: string; value: string; hint?: string | false }) {
  return (
    <div className="card stat stat-plain">
      <span>
        <strong>{value}</strong>
        <span className="stat-label">{label}</span>
        {hint && <span className="stat-hint">{hint}</span>}
      </span>
    </div>
  );
}
