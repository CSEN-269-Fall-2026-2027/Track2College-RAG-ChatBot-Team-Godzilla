import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { AG_AREAS, AREA_LABEL, LEVEL_LABEL, agProgress } from "../academics";
import { formatDate } from "../format";
import { TRANSCRIPT_TYPES, usePlanning } from "../planning";
import { useProfile } from "../profile";
import { newId } from "../storage";
import type { AgArea, CourseLevel, CourseStatus, Transcript, TranscriptCourse } from "../types";
import { ChatIcon, CheckIcon, ChevronIcon, FileIcon, PlusIcon, TrashIcon, UploadIcon } from "../components/icons";

const GRADE_ORDER: TranscriptCourse["gradeLevel"][] = ["9", "10", "11", "12", "other"];
const GRADE_TITLE: Record<TranscriptCourse["gradeLevel"], string> = {
  "9": "9th grade",
  "10": "10th grade",
  "11": "11th grade",
  "12": "12th grade",
  other: "Other / summer",
};

/** A closed-by-default section: only its title shows until the student opens it to look or edit. */
export function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="pf-fold">
      <summary className="pf-fold-summary">
        <span>{title}</span>
        <ChevronIcon width={16} height={16} className="pf-fold-chevron" aria-hidden="true" />
      </summary>
      <div className="pf-fold-body">{children}</div>
    </details>
  );
}

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

/**
 * Academic history: the transcript upload up top, then everything else in closed sections.
 * `before` is extra closed sections from the profile page, shown right under the upload.
 */
export function TranscriptTab({ onAsk, before }: { onAsk: (text: string) => void; before?: ReactNode }) {
  const { transcripts, updateTranscript, removeTranscript, uploadError, saveError, uploading, ensureManualTranscript } = usePlanning();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const transcript = transcripts.find((t) => t.id === selectedId) ?? transcripts[0];
  const notice = uploadError || saveError;

  if (!transcript) {
    return (
      <>
        <section className="card">
          <header className="card-head">
            <h2>Upload your transcript</h2>
          </header>
          <Dropzone />
          <button className="btn-dashed" style={{ marginTop: 16 }} onClick={() => ensureManualTranscript()}>
            Add courses manually instead
          </button>
        </section>
        {(notice || uploading) && (
          <div className={notice ? "error-card" : "notice"}>
            {notice ? <p>{notice}</p> : <span className="shimmer">Reading {uploading}…</span>}
          </div>
        )}
        {before}
      </>
    );
  }

  return (
    <>
      {(notice || uploading) && (
        <div className={notice ? "error-card" : "notice"}>
          {notice ? <p>{notice}</p> : <span className="shimmer">Reading {uploading}…</span>}
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
        before={before}
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
  before?: ReactNode;
}

function TranscriptView({ transcript, transcripts, onSelect, onChange, onRemove, onAsk, before }: ViewProps) {
  const { update } = useProfile();
  const progress = useMemo(() => agProgress(transcript.courses), [transcript.courses]);

  // What the transcript says fills the profile's blanks on its own (school, school-reported GPA);
  // anything the student already typed stays.
  useEffect(() => {
    const { school, reportedGpa } = transcript;
    update((p) => {
      const next = {
        ...p,
        basics: { ...p.basics, highSchool: p.basics.highSchool || school },
        academics: {
          ...p.academics,
          gpaUnweighted: p.academics.gpaUnweighted || reportedGpa.unweighted,
          gpaWeighted: p.academics.gpaWeighted || reportedGpa.weighted,
        },
      };
      const same =
        next.basics.highSchool === p.basics.highSchool &&
        next.academics.gpaUnweighted === p.academics.gpaUnweighted &&
        next.academics.gpaWeighted === p.academics.gpaWeighted;
      return same ? p : next;
    });
  }, [transcript.id, transcript.school, transcript.reportedGpa.unweighted, transcript.reportedGpa.weighted, update]);

  // Older uploads can hold rows the reader repeated word for word; keep one of each.
  // Blank manual rows share an empty name key — leave them alone so "Add a course" works.
  useEffect(() => {
    const seen = new Set<string>();
    const unique = transcript.courses.filter((c) => {
      const name = c.name.trim().toLowerCase();
      if (!name) return true;
      const key = [name, c.gradeLevel, c.term.trim().toLowerCase(), c.grade.trim().toUpperCase()].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (unique.length < transcript.courses.length) onChange({ ...transcript, courses: unique });
  }, [transcript, onChange]);

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
            <p>{[transcript.school, `Uploaded ${formatDate(transcript.uploadedAt)}`].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <div className="transcript-actions">
          <Dropzone compact />
          <button className="icon-btn" onClick={onRemove} aria-label="Delete transcript" title="Delete transcript">
            <TrashIcon width={16} height={16} />
          </button>
        </div>
      </section>

      {before}

      <Fold title="A–G progress">
        <p className="pf-fold-note">C or better counts.</p>
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
      </Fold>

      <Fold title="Courses">
        <CourseList transcript={transcript} onChange={onChange} />
      </Fold>
    </>
  );
}

/** One course as the student sees it: its semesters (Fall and Spring rows) shown together. */
interface CourseGroup {
  key: string;
  first: TranscriptCourse;
  records: TranscriptCourse[];
}

/** Groups a year's rows by course name, so a two-semester course is one line, not two. */
function groupCourses(courses: TranscriptCourse[]): CourseGroup[] {
  const groups = new Map<string, CourseGroup>();
  for (const course of courses) {
    const key = `${course.gradeLevel}|${course.name.trim().toLowerCase() || course.id}`;
    const group = groups.get(key);
    if (group) group.records.push(course);
    else groups.set(key, { key, first: course, records: [course] });
  }
  return [...groups.values()];
}

const STATUS_LABEL: Record<CourseStatus, string> = { completed: "Completed", "in-progress": "In progress", planned: "Planned" };

function CourseList({ transcript, onChange }: { transcript: Transcript; onChange: (transcript: Transcript) => void }) {
  // The course being edited, by one of its rows' ids (stays put while its name is edited).
  const [editingId, setEditingId] = useState<string | null>(null);
  const byGrade = useMemo(
    () =>
      GRADE_ORDER.map((g) => ({ grade: g, groups: groupCourses(transcript.courses.filter((c) => c.gradeLevel === g)) })).filter((g) => g.groups.length),
    [transcript.courses],
  );

  const patch = (ids: string[], change: Partial<TranscriptCourse>) =>
    onChange({ ...transcript, courses: transcript.courses.map((c) => (ids.includes(c.id) ? { ...c, ...change } : c)) });
  const remove = (ids: string[]) => onChange({ ...transcript, courses: transcript.courses.filter((c) => !ids.includes(c.id)) });
  const add = (template?: Partial<TranscriptCourse>) => {
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
      ...template,
    };
    onChange({ ...transcript, courses: [...transcript.courses, course] });
    return course;
  };

  return (
    <div className="course-list">
      {transcript.courses.length === 0 && <p className="list-empty">No courses yet. Upload a transcript above, or add them yourself.</p>}
      {byGrade.map(({ grade, groups }) => (
        <section key={grade} className="course-year">
          <h3>{GRADE_TITLE[grade]}</h3>
          <ul className="course-items">
            {groups.map((group) => {
              const ids = group.records.map((r) => r.id);
              const editing = editingId !== null && ids.includes(editingId);
              return editing ? (
                <li key={group.key} className="course-item is-editing">
                  <CourseEditor
                    group={group}
                    onPatch={(change) => patch(ids, change)}
                    onPatchRecord={(id, change) => patch([id], change)}
                    onRemoveRecord={(id) => remove([id])}
                    onAddSemester={() => add({ ...group.first, id: newId(), term: "", grade: "" })}
                    onDelete={() => {
                      remove(ids);
                      setEditingId(null);
                    }}
                    onDone={() => setEditingId(null)}
                  />
                </li>
              ) : (
                <li key={group.key} className="course-item">
                  <div className="course-item-main">
                    <strong>{group.first.name || "Untitled course"}</strong>
                    <span className="course-item-meta">
                      {[
                        group.first.level !== "regular" && LEVEL_LABEL[group.first.level],
                        group.first.area === "unknown" || group.first.area === "none" ? AREA_LABEL[group.first.area] : `${group.first.area.toUpperCase()} · ${AREA_LABEL[group.first.area]}`,
                        (group.first.status ?? "completed") !== "completed" && STATUS_LABEL[group.first.status ?? "completed"],
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  <div className="course-item-grades">
                    {group.records.map((r) => (
                      <span key={r.id} className="course-grade-chip">
                        {r.term && <span>{r.term}</span>}
                        <strong>{r.grade || "—"}</strong>
                      </span>
                    ))}
                  </div>
                  <button type="button" className="pf-edit" onClick={() => setEditingId(group.first.id)} aria-label={`Edit ${group.first.name || "course"}`}>
                    Edit
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <button type="button" className="btn-dashed" onClick={() => setEditingId(add().id)}>
        <PlusIcon width={15} height={15} /> Add a course
      </button>
    </div>
  );
}

function CourseEditor({
  group,
  onPatch,
  onPatchRecord,
  onRemoveRecord,
  onAddSemester,
  onDelete,
  onDone,
}: {
  group: CourseGroup;
  onPatch: (change: Partial<TranscriptCourse>) => void;
  onPatchRecord: (id: string, change: Partial<TranscriptCourse>) => void;
  onRemoveRecord: (id: string) => void;
  onAddSemester: () => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const c = group.first;
  const label = c.name || "course";
  return (
    <div className="course-editor">
      <div className="course-editor-grid">
        <label className="field field-wide">
          <span className="field-label">Course name</span>
          <input value={c.name} onChange={(e) => onPatch({ name: e.target.value })} placeholder="e.g. AP Biology" autoFocus />
        </label>
        <label className="field">
          <span className="field-label">Grade level</span>
          <select value={c.gradeLevel} onChange={(e) => onPatch({ gradeLevel: e.target.value as TranscriptCourse["gradeLevel"] })}>
            {GRADE_ORDER.map((g) => (
              <option key={g} value={g}>
                {GRADE_TITLE[g]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Level</span>
          <select value={c.level} onChange={(e) => onPatch({ level: e.target.value as CourseLevel })}>
            {(Object.keys(LEVEL_LABEL) as CourseLevel[]).map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABEL[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">A–G area</span>
          <select value={c.area} onChange={(e) => onPatch({ area: e.target.value as AgArea })}>
            {(["unknown", ...AG_AREAS.map((a) => a.id), "none"] as AgArea[]).map((a) => (
              <option key={a} value={a}>
                {a === "unknown" || a === "none" ? AREA_LABEL[a] : `${a.toUpperCase()} · ${AREA_LABEL[a]}`}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Status</span>
          <select value={c.status ?? "completed"} onChange={(e) => onPatch({ status: e.target.value as CourseStatus })}>
            {(Object.keys(STATUS_LABEL) as CourseStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="course-terms">
        <span className="field-label">Terms and grades</span>
        {group.records.map((r) => (
          <div key={r.id} className="course-term-row">
            <input value={r.term} onChange={(e) => onPatchRecord(r.id, { term: e.target.value })} placeholder="Term (e.g. Fall)" aria-label={`Term for ${label}`} />
            <input value={r.grade} onChange={(e) => onPatchRecord(r.id, { grade: e.target.value })} placeholder="Grade" aria-label={`Grade for ${label}`} />
            {group.records.length > 1 && (
              <button type="button" className="icon-btn" onClick={() => onRemoveRecord(r.id)} aria-label={`Remove this term of ${label}`}>
                <TrashIcon width={15} height={15} />
              </button>
            )}
          </div>
        ))}
        <button type="button" className="link-btn" onClick={onAddSemester}>
          <PlusIcon width={13} height={13} /> Add a term
        </button>
      </div>

      <div className="course-editor-foot">
        <button type="button" className="btn-ghost course-delete" onClick={onDelete}>
          <TrashIcon width={15} height={15} /> Delete course
        </button>
        <button type="button" className="btn-primary" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
