import { useMemo, useRef, useState, type DragEvent } from "react";
import { AG_AREAS, AREA_LABEL, LEVEL_LABEL, agProgress, computeGpa, formatGpa } from "../academics";
import { formatDate } from "../format";
import { TRANSCRIPT_TYPES, usePlanning } from "../planning";
import { useProfile } from "../profile";
import { href } from "../router";
import type { AgArea, CourseLevel, Transcript, TranscriptCourse } from "../types";
import { BookIcon, ChatIcon, CheckIcon, FileIcon, TrashIcon, UploadIcon } from "../components/icons";

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
            <span>PDF, TXT, or CSV up to 5 MB. Unofficial transcripts from your school portal work great.</span>
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
  const { transcripts, updateTranscript, removeTranscript, uploadError, uploading } = usePlanning();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const transcript = transcripts.find((t) => t.id === selectedId) ?? transcripts[0];

  if (!transcript) {
    return (
      <section className="card">
        <header className="card-head">
          <h2>Upload your transcript</h2>
          <p>We'll pull out every course and grade, calculate your GPA and A–G progress, and point out strengths and gaps.</p>
        </header>
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
    const advanced = [...new Set(transcript.courses.filter((c) => c.level !== "regular").map((c) => c.name))];
    update((p) => ({
      ...p,
      basics: { ...p.basics, highSchool: p.basics.highSchool || transcript.school },
      academics: {
        ...p.academics,
        gpaUnweighted: gpa.unweighted !== null ? gpa.unweighted.toFixed(2) : p.academics.gpaUnweighted,
        gpaWeighted: gpa.weighted !== null ? gpa.weighted.toFixed(2) : p.academics.gpaWeighted,
        apIbCourses: advanced.length ? String(advanced.length) : p.academics.apIbCourses,
        coursework: advanced.length ? advanced.join(", ") : p.academics.coursework,
      },
    }));
    setApplied(true);
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
        <GpaStat label="Unweighted GPA" value={formatGpa(gpa.unweighted)} hint={transcript.reportedGpa.unweighted && `School reports ${transcript.reportedGpa.unweighted}`} />
        <GpaStat label="Weighted GPA" value={formatGpa(gpa.weighted)} hint={transcript.reportedGpa.weighted && `School reports ${transcript.reportedGpa.weighted}`} />
        <GpaStat label="Est. UC GPA" value={formatGpa(gpa.ucCapped)} hint="10th–11th grade A–G, capped honors" />
        <GpaStat label="AP / IB / college courses" value={String(gpa.advancedCourses)} hint={`${gpa.gradedSemesters} graded semesters`} />
      </div>

      <div className="apply-bar">
        <span>{applied ? "Your profile's academics were updated from this transcript." : "Use these numbers to fill in the Academics section of your profile."}</span>
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
            <p>UC / CSU subject requirements, counting C or better</p>
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
          <a className="card-link plan-link" href={href("insights", "plan")}>
            <BookIcon width={14} height={14} /> Build a course plan from this transcript
          </a>
        </section>
      </div>

      <section className="card courses-card">
        <header className="card-head row-head">
          <div>
            <h2>Courses</h2>
            <p>Check that the AI read everything correctly; fix the level or A–G area if needed.</p>
          </div>
        </header>
        {byGrade.map(({ grade, courses }) => (
          <div key={grade} className="course-year">
            <h3>{GRADE_TITLE[grade]}</h3>
            <div className="course-table">
              {courses.map((course) => (
                <div key={course.id} className="course-row">
                  <span className="course-name">
                    {course.name}
                    {course.term && <span className="course-term">{course.term}</span>}
                  </span>
                  <input
                    className="course-grade"
                    value={course.grade}
                    onChange={(e) => patchCourse(course.id, { grade: e.target.value })}
                    aria-label={`Grade for ${course.name}`}
                  />
                  <select value={course.level} onChange={(e) => patchCourse(course.id, { level: e.target.value as CourseLevel })} aria-label={`Level for ${course.name}`}>
                    {(Object.keys(LEVEL_LABEL) as CourseLevel[]).map((l) => (
                      <option key={l} value={l}>
                        {LEVEL_LABEL[l]}
                      </option>
                    ))}
                  </select>
                  <select value={course.area} onChange={(e) => patchCourse(course.id, { area: e.target.value as AgArea })} aria-label={`A–G area for ${course.name}`}>
                    {[...AG_AREAS.map((a) => a.id), "none" as const].map((a) => (
                      <option key={a} value={a}>
                        {a === "none" ? AREA_LABEL.none : `${a.toUpperCase()} · ${AREA_LABEL[a]}`}
                      </option>
                    ))}
                  </select>
                  <button className="icon-btn" onClick={() => removeCourse(course.id)} aria-label={`Remove ${course.name}`}>
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
