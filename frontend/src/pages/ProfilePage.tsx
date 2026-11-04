import { useMemo, useState, type ReactNode } from "react";
import { computeGpa, formatGpa } from "../academics";
import { useAuth } from "../auth";
import { COLLEGES } from "../colleges";
import { activitiesStatus, journeyOf, PIQ_REQUIRED, toggleCampus } from "../journey/logic";
import { usePlanning } from "../planning";
import {
  ACTIVITY_CATEGORY_LABELS,
  PROFILE_SECTIONS,
  PROFILE_WORKSPACES,
  academicHistoryStatus,
  completeness,
  emptyActivity,
  useProfile,
  type ProfileRouteId,
  type SaveState,
  type SectionId,
} from "../profile";
import { href } from "../router";
import { newId } from "../storage";
import type { ActivityCategory, Award, Profile, TranscriptCourse } from "../types";
import { ProgressRing, Segmented, SelectField, TextArea, TextField, type Option } from "../components/Form";
import { AlertIcon, CheckIcon, PlusIcon, TrashIcon } from "../components/icons";
import { EssayTab } from "./EssayTab";
import { MajorsTab } from "./MajorsTab";
import { Fold, TranscriptTab } from "./TranscriptTab";

type Group = "basics" | "academics" | "goals" | "preferences";
type Setter = <G extends Group, K extends keyof Profile[G]>(group: G, key: K) => (value: Profile[G][K]) => void;
type Update = (change: (p: Profile) => Profile) => void;

const opts = <T extends string>(pairs: [T, string][]): Option<T>[] => pairs.map(([value, label]) => ({ value, label }));

const GRADES = opts<Exclude<Profile["basics"]["gradeLevel"], "transfer" | "">>([
  ["9", "9th grade"],
  ["10", "10th grade"],
  ["11", "11th grade"],
  ["12", "12th grade"],
  ["gap", "Gap year"],
]);
const YES_NO = opts<"yes" | "no">([
  ["yes", "Yes"],
  ["no", "No"],
]);
const AWARD_LEVELS = opts<Award["level"]>([
  ["school", "School / local"],
  ["regional", "Regional"],
  ["state", "State"],
  ["national", "National"],
  ["international", "International"],
]);
const ACTIVITY_CATEGORIES = opts<Exclude<ActivityCategory, "">>(
  (Object.entries(ACTIVITY_CATEGORY_LABELS) as [Exclude<ActivityCategory, "">, string][]).map(([value, label]) => [value, label]),
);

function isRoute(value: string | null): value is ProfileRouteId {
  return PROFILE_SECTIONS.some((s) => s.id === value) || PROFILE_WORKSPACES.some((w) => w.id === value);
}

const NEEDS_AID = opts<Profile["preferences"]["needsAid"]>([
  ["yes", "Yes"],
  ["no", "No"],
  ["unsure", "Not sure"],
]);
const INCOME = opts<Profile["preferences"]["incomeRange"]>([
  ["under-30k", "Under $30k"],
  ["30-60k", "$30k – $60k"],
  ["60-110k", "$60k – $110k"],
  ["110-175k", "$110k – $175k"],
  ["over-175k", "Over $175k"],
  ["prefer-not", "Prefer not to say"],
]);
const FAFSA = opts<Profile["preferences"]["fafsa"]>([
  ["not-started", "Not started"],
  ["in-progress", "In progress"],
  ["done", "Done"],
]);

const labelOf = <T extends string>(options: Option<T>[], value: string) => options.find((o) => o.value === value)?.label ?? "";
const isUc = (name: string) => COLLEGES.some((u) => u.name.toLowerCase() === name.toLowerCase());

/** Shows a plain number as dollars; anything else the student typed is shown as-is. */
const formatBudget = (raw: string) => {
  const v = raw.trim();
  return /^\$?\d[\d,]*$/.test(v) ? `$${Number(v.replace(/[$,]/g, "")).toLocaleString()}` : v;
};

/** Saving is automatic and silent; only a failed save is worth telling the student about. */
const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  saving: "",
  saved: "",
  error: "Couldn’t save — we’ll retry on your next edit",
};

export function ProfilePage({ section: param, onAsk }: { section: string | null; onAsk: (text: string) => void }) {
  const { profile, update, saveState } = useProfile();
  const { account } = useAuth();
  const { transcripts } = usePlanning();
  const section: ProfileRouteId = isRoute(param) ? param : "basics";
  const { sections } = completeness(profile);
  const essaysReady = Object.values(journeyOf(profile).piqs).filter((s) => s === "ready").length;
  const academic = useMemo(() => academicHistoryStatus(profile, transcripts), [profile, transcripts]);
  const transferUnsupported = profile.basics.gradeLevel === "transfer";
  const [editing, setEditing] = useState<Partial<Record<ProfileRouteId, boolean>>>({});

  const set: Setter = (group, key) => (value) => update((p) => ({ ...p, [group]: { ...p[group], [key]: value } }));

  const ucs = profile.colleges.filter((c) => isUc(c.name));
  const sectionDone = (id: SectionId) => {
    if (id === "basics") return sections.basics === 1;
    if (id === "academics") return academic.started;
    if (id === "campuses") return ucs.length > 0;
    return false;
  };

  const sectionValue = (id: SectionId) => {
    if (id === "basics") return sections.basics;
    if (id === "academics") return academic.started ? 0.5 : 0;
    if (id === "campuses") return sectionDone(id) ? 1 : 0;
    return 0;
  };

  const meta = (id: ProfileRouteId) =>
    PROFILE_SECTIONS.find((s) => s.id === id) ?? PROFILE_WORKSPACES.find((w) => w.id === id)!;
  const item = (id: ProfileRouteId, done: boolean, value: number) => ({ id, title: meta(id).title, done, value });
  const navGroups = [
    {
      label: "Profile",
      items: [
        ...PROFILE_SECTIONS.filter((s) => s.id !== "finances").map((s) => item(s.id, sectionDone(s.id), sectionValue(s.id))),
        item("activities", activitiesStatus(profile).done, profile.activities.length ? 0.5 : 0),
        item("finances", sectionDone("finances"), sectionValue("finances")),
      ],
    },
    {
      label: "Workspaces",
      items: [
        item("essays", essaysReady >= PIQ_REQUIRED, essaysReady / PIQ_REQUIRED),
        item("majors", !!profile.goals.intendedMajor, 0),
      ],
    },
  ];

  // A section with nothing saved yet opens straight into its form; otherwise it shows a summary first.
  const b = profile.basics;
  const a = profile.academics;
  const f = profile.preferences;
  const empty: Partial<Record<ProfileRouteId, boolean>> = {
    basics: ![b.firstName, b.lastName, b.gradeLevel, b.graduationYear, b.highSchool, b.city, b.state, b.firstGen].some(Boolean),
    academics: ![a.gpaUnweighted, a.gpaWeighted, a.exams].some((v) => v.trim()),
    campuses: ucs.length === 0,
    activities: profile.activities.length === 0 && profile.awards.length === 0,
    finances: ![f.needsAid, f.incomeRange, f.maxAnnualCost, f.fafsa].some(Boolean),
  };
  const isEditing = (id: ProfileRouteId) => editing[id] ?? !!empty[id];
  const setEdit = (id: ProfileRouteId, on: boolean) => setEditing((e) => ({ ...e, [id]: on }));

  const fullName = [b.firstName, b.lastName].filter(Boolean).join(" ") || account?.name || "Your profile";
  const initials =
    (b.firstName || b.lastName
      ? `${b.firstName.charAt(0)}${b.lastName.charAt(0)}`
      : (account?.name ?? "")
          .split(/\s+/)
          .map((w) => w.charAt(0))
          .slice(0, 2)
          .join("")
    ).toUpperCase() || "?";
  const metaLine = [
    labelOf(GRADES, b.gradeLevel),
    b.highSchool,
    [b.city, b.state].filter(Boolean).join(", "),
    b.graduationYear ? `Class of ${b.graduationYear}` : "",
  ].filter(Boolean);

  const panelProps = (id: ProfileRouteId) => ({
    title: meta(id).title,
    editing: isEditing(id),
    onEdit: () => setEdit(id, true),
    onDone: () => setEdit(id, false),
    saveState,
  });

  return (
    <div className="page-scroll pf-page">
      <div className="pf-cover" aria-hidden="true" />
      <div className="pf-wrap">
        <header className="pf-hero">
          <div className="pf-avatar" aria-hidden="true">
            {initials}
          </div>
          <div className="pf-identity">
            <h1>{fullName}</h1>
            {metaLine.length > 0 ? (
              <p className="pf-meta">
                {metaLine.map((m, i) => (
                  <span key={i}>{m}</span>
                ))}
              </p>
            ) : (
              <p className="pf-meta">
                <a href={href("profile", "basics")} onClick={() => setEdit("basics", true)}>
                  Add your grade and school
                </a>
              </p>
            )}
          </div>
        </header>

        <div className="pf-body">
          <nav className="pf-nav" aria-label="Profile sections">
            {navGroups.map((g) => (
              <div className="pf-nav-group" key={g.label}>
                <span className="pf-nav-label">{g.label}</span>
                {g.items.map((s) => (
                  <a
                    key={s.id}
                    href={href("profile", s.id)}
                    className={`pf-nav-link ${s.id === section ? "active" : ""}`}
                    aria-current={s.id === section ? "page" : undefined}
                  >
                    <span className={`pf-nav-dot ${s.done ? "done" : ""}`}>
                      {s.done ? <CheckIcon width={10} height={10} /> : <ProgressRing value={s.value} size={16} stroke={2} />}
                    </span>
                    <span>{s.title}</span>
                  </a>
                ))}
              </div>
            ))}
          </nav>

          <main className="pf-main" key={section}>
            {transferUnsupported && (
              <div className="pf-alert" role="status">
                <AlertIcon width={16} height={16} />
                <p>
                  This profile flow supports <strong>first-year</strong> UC applicants (including gap-year students). Transfer applicants use a different UC process. Your saved data is kept, but we can’t guide a transfer application here.
                </p>
              </div>
            )}

            {section === "basics" && (
              <Panel {...panelProps("basics")}>
                {isEditing("basics") ? (
                  <BasicsForm profile={profile} set={set} />
                ) : (
                  <Facts
                    items={[
                      ["First name", b.firstName],
                      ["Last name", b.lastName],
                      ["Current grade", labelOf(GRADES, b.gradeLevel)],
                      ["High school graduation year", b.graduationYear],
                      ["High school", b.highSchool, true],
                      ["City", b.city],
                      ["State", b.state],
                      ["First in family to attend college", labelOf(YES_NO, b.firstGen)],
                    ]}
                  />
                )}
              </Panel>
            )}

            {section === "academics" && (
              <div className="pf-embedded">
                <TranscriptTab
                  onAsk={onAsk}
                  before={<GpaFold profile={profile} set={set} saveState={saveState} courses={transcripts[0]?.courses ?? []} />}
                />
              </div>
            )}

            {section === "campuses" && (
              <section className="pf-panel">
                <header className="pf-panel-head">
                  <div className="pf-panel-title">
                    <h2>{meta("campuses").title}</h2>
                  </div>
                  {saveState === "error" && (
                    <span className="pf-save error" role="alert">
                      {SAVE_LABEL.error}
                    </span>
                  )}
                </header>
                <div className="pf-panel-body">
                  <CampusesForm profile={profile} update={update} />
                </div>
              </section>
            )}

            {section === "activities" && (
              <Panel {...panelProps("activities")}>
                {isEditing("activities") ? <ActivitiesWorkspace profile={profile} update={update} /> : <ActivitiesSummary profile={profile} />}
                <ActivitiesDone profile={profile} update={update} />
              </Panel>
            )}

            {section === "finances" && (
              <Panel {...panelProps("finances")}>
                {isEditing("finances") ? (
                  <FinancesForm profile={profile} set={set} />
                ) : (
                  <Facts
                    items={[
                      ["Will you need financial aid?", labelOf(NEEDS_AID, f.needsAid)],
                      ["Household income", labelOf(INCOME, f.incomeRange)],
                      ["Annual budget you can plan for", formatBudget(f.maxAnnualCost)],
                      ["FAFSA or California Dream Act", labelOf(FAFSA, f.fafsa)],
                    ]}
                  />
                )}
              </Panel>
            )}

            {section === "essays" && (
              <div className="pf-embedded">
                <EssayTab onAsk={onAsk} />
              </div>
            )}

            {section === "majors" && <MajorsTab onAsk={onAsk} />}
          </main>
        </div>
      </div>
    </div>
  );
}

/** A section card: title, optional status badge, and an Edit / Done toggle between summary and form. */
function Panel({
  title,
  badge,
  editing,
  onEdit,
  onDone,
  saveState,
  children,
}: {
  title: string;
  badge?: ReactNode;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  saveState: SaveState;
  children: ReactNode;
}) {
  return (
    <section className={`pf-panel ${editing ? "is-editing" : ""}`}>
      <header className="pf-panel-head">
        <div className="pf-panel-title">
          <h2>{title}</h2>
        </div>
        {!editing && (
          <button className="pf-edit" onClick={onEdit}>
            <PencilIcon /> Edit
          </button>
        )}
      </header>
      {badge && <div className="pf-panel-badge">{badge}</div>}
      <div className="pf-panel-body">{children}</div>
      {editing && (
        <footer className="pf-panel-foot">
          <span className={`pf-save ${saveState}`} aria-live="polite">
            {SAVE_LABEL[saveState]}
          </span>
          <button className="btn-primary pf-done-btn" onClick={onDone}>
            Done
          </button>
        </footer>
      )}
    </section>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/** Read-only label/value grid. A third `true` makes the row span both columns. */
function Facts({ items }: { items: [string, string, boolean?][] }) {
  return (
    <dl className="pf-facts">
      {items.map(([label, value, wide]) => (
        <div key={label} className={wide ? "wide" : ""}>
          <dt>{label}</dt>
          <dd className={value?.trim() ? "" : "is-empty"}>{value?.trim() ? value : "Not added"}</dd>
        </div>
      ))}
    </dl>
  );
}

function ActivitiesSummary({ profile }: { profile: Profile }) {
  return (
    <>
      <h3 className="pf-subhead">
        Activities <span className="count">{profile.activities.length}</span>
      </h3>
      {profile.activities.length === 0 ? (
        <p className="pf-empty">No activities yet.</p>
      ) : (
        <ul className="pf-rows">
          {profile.activities.map((a) => {
            const time = [a.hoursPerWeek && `${a.hoursPerWeek} hrs/week`, a.weeksPerYear && `${a.weeksPerYear} weeks/year`, a.years && `Grades ${a.years}`].filter(Boolean);
            return (
              <li key={a.id}>
                <div className="pf-row-main">
                  <strong>{a.name || "Untitled"}</strong>
                  <span>{[a.role, ...time].filter(Boolean).join(" · ")}</span>
                </div>
                <span className="pf-pill">{a.category ? ACTIVITY_CATEGORY_LABELS[a.category as Exclude<ActivityCategory, "">] : "Uncategorized"}</span>
                {a.description && <p className="pf-row-note">{a.description}</p>}
              </li>
            );
          })}
        </ul>
      )}

      <h3 className="pf-subhead">
        Honors &amp; awards <span className="count">{profile.awards.length}</span>
      </h3>
      {profile.awards.length === 0 ? (
        <p className="pf-empty">No awards yet.</p>
      ) : (
        <ul className="pf-rows">
          {profile.awards.map((a) => (
            <li key={a.id}>
              <div className="pf-row-main">
                <strong>{a.title}</strong>
              </div>
              <span className="pf-row-value">{labelOf(AWARD_LEVELS, a.level) || "Level not set"}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

interface FormProps {
  profile: Profile;
  set: Setter;
}

function BasicsForm({ profile: { basics: b }, set }: FormProps) {
  return (
    <div className="form-grid">
      <TextField label="First name" value={b.firstName} onChange={set("basics", "firstName")} autoComplete="given-name" />
      <TextField label="Last name" value={b.lastName} onChange={set("basics", "lastName")} autoComplete="family-name" />
      <SelectField label="Current grade" value={b.gradeLevel === "transfer" ? "" : b.gradeLevel} options={GRADES} onChange={set("basics", "gradeLevel")} />
      <TextField
        label="High school graduation year"
        value={b.graduationYear}
        onChange={set("basics", "graduationYear")}
        inputMode="numeric"
        placeholder="2027"
        maxLength={4}
      />
      <TextField label="High school" value={b.highSchool} onChange={set("basics", "highSchool")} wide placeholder="Lincoln High School" />
      <TextField label="City" value={b.city} onChange={set("basics", "city")} autoComplete="address-level2" />
      <TextField label="State" value={b.state} onChange={set("basics", "state")} autoComplete="address-level1" placeholder="CA" />
      <Segmented
        label="Will you be the first in your family to attend college?"
        value={b.firstGen}
        options={YES_NO}
        onChange={set("basics", "firstGen")}
        hint="Optional"
        wide
      />
    </div>
  );
}

/**
 * GPA and exams in one closed section. Values come from the transcript (school-reported GPA is
 * copied in on upload; otherwise the calculated one shows); Edit lets the student correct them.
 */
function GpaFold({ profile, set, saveState, courses }: FormProps & { saveState: SaveState; courses: TranscriptCourse[] }) {
  const [editing, setEditing] = useState(false);
  const a = profile.academics;
  const gpa = useMemo(() => computeGpa(courses), [courses]);
  const calc = (value: number | null) => (value === null ? "" : `${formatGpa(value)} (calculated)`);
  return (
    <Fold title="GPA & exams">
      {editing ? (
        <>
          <AcademicsForm profile={profile} set={set} />
          <div className="pf-fold-foot">
            <span className={`pf-save ${saveState}`} aria-live="polite">
              {SAVE_LABEL[saveState]}
            </span>
            <button type="button" className="btn-primary" onClick={() => setEditing(false)}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <Facts
            items={[
              ["Unweighted GPA", a.gpaUnweighted || calc(gpa.unweighted)],
              ["Weighted GPA", a.gpaWeighted || calc(gpa.weighted)],
              ["Estimated UC GPA", gpa.ucCapped === null ? "" : `${formatGpa(gpa.ucCapped)} (unofficial estimate)`],
              ["AP / IB / college courses", courses.length ? String(gpa.advancedCourses) : ""],
              ["AP, IB, or English-proficiency exams", a.exams, true],
            ]}
          />
          <div className="pf-fold-foot">
            <span className="pf-fold-note">Pulled from your transcript. Edit only if something's wrong.</span>
            <button type="button" className="pf-edit" onClick={() => setEditing(true)}>
              <PencilIcon /> Edit
            </button>
          </div>
        </>
      )}
    </Fold>
  );
}

function AcademicsForm({ profile, set }: FormProps) {
  const { academics: a } = profile;
  return (
  <div className="form-grid">
    <TextField
      label="Reported unweighted GPA"
      value={a.gpaUnweighted}
      onChange={set("academics", "gpaUnweighted")}
      inputMode="decimal"
      placeholder="3.70"
      hint="Optional"
    />
    <TextField
      label="Reported weighted GPA"
      value={a.gpaWeighted}
      onChange={set("academics", "gpaWeighted")}
      inputMode="decimal"
      placeholder="4.10"
      hint="Optional"
    />
    <TextArea
      label="AP, IB, or English-proficiency exams"
      value={a.exams}
      onChange={set("academics", "exams")}
      rows={3}
      placeholder="e.g. AP Calculus BC 4; IB History HL; TOEFL if applicable…"
      hint="Optional"
    />
  </div>
  );
}

/** The UC campus checkboxes. One application covers every checked campus; the major is set once in Major selection. */
function CampusesForm({ profile, update }: { profile: Profile; update: Update }) {
  const on = (name: string) => profile.colleges.some((c) => c.name.toLowerCase() === name.toLowerCase());
  return (
    <>
      <ul className="pf-campus-grid" aria-label="UC campuses">
        {COLLEGES.map((college) => (
          <li key={college.name}>
            <label className={`pf-campus ${on(college.name) ? "on" : ""}`}>
              <input type="checkbox" checked={on(college.name)} onChange={() => update((p) => toggleCampus(p, college.name, newId))} />
              <span className="pf-campus-box" aria-hidden="true">
                {on(college.name) && <CheckIcon width={12} height={12} />}
              </span>
              <span className="pf-campus-text">
                <span className="pf-campus-name">{college.name}</span>
                <span className="pf-campus-city">{college.city}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="pf-major-row">
        <div className="pf-major-text">
          <span className="pf-major-label">Intended major</span>
          <strong className={profile.goals.intendedMajor ? undefined : "is-empty"}>{profile.goals.intendedMajor || "Not chosen yet"}</strong>
        </div>
        <a className="pf-edit" href={href("profile", "majors")}>
          <PencilIcon /> {profile.goals.intendedMajor ? "Change" : "Choose"}
        </a>
      </div>
    </>
  );
}

function FinancesForm({ profile: { preferences: f }, set }: FormProps) {
  return (
      <div className="form-grid">
        <Segmented
          label="Will you need financial aid?"
          value={f.needsAid}
          options={NEEDS_AID}
          onChange={set("preferences", "needsAid")}
        />
        <SelectField
          label="Household income"
          value={f.incomeRange}
          onChange={set("preferences", "incomeRange")}
          hint="Optional"
          options={INCOME}
        />
        <TextField
          label="Annual budget you can plan for"
          value={f.maxAnnualCost}
          onChange={set("preferences", "maxAnnualCost")}
          inputMode="numeric"
          placeholder="15000"
          hint="USD per year"
        />
        <SelectField
          label="FAFSA or California Dream Act"
          value={f.fafsa}
          onChange={set("preferences", "fafsa")}
          options={FAFSA}
        />
      </div>
  );
}

function useListEditor<K extends "activities" | "awards">(update: Update, key: K) {
  type Item = Profile[K][number];
  return {
    add: (item: Item) => update((p) => ({ ...p, [key]: [...p[key], item] })),
    patch: (id: string, change: Partial<Item>) =>
      update((p) => ({ ...p, [key]: (p[key] as Item[]).map((x) => (x.id === id ? { ...x, ...change } : x)) })),
    remove: (id: string) => update((p) => ({ ...p, [key]: (p[key] as Item[]).filter((x) => x.id !== id) })),
  };
}

function ActivitiesWorkspace({ profile, update }: { profile: Profile; update: Update }) {
  const activities = useListEditor(update, "activities");
  const awards = useListEditor(update, "awards");
  const [awardDraft, setAwardDraft] = useState("");

  const addActivity = (category: ActivityCategory = "extracurricular") =>
    activities.add(emptyActivity({ id: newId(), category }));

  const addAward = () => {
    if (!awardDraft.trim()) return;
    awards.add({ id: newId(), title: awardDraft.trim(), level: "" } satisfies Award);
    setAwardDraft("");
  };

  return (
    <>
      <h3 className="form-subhead">
        Activities <span className="count">{profile.activities.length}</span>
      </h3>
      <div className="list">
        {profile.activities.map((a, i) => (
          <div className="list-card" key={a.id}>
            <div className="list-card-head">
              <span className="list-index">{i + 1}</span>
              <button className="icon-btn" onClick={() => activities.remove(a.id)} aria-label="Remove activity" title="Remove">
                <TrashIcon width={16} height={16} />
              </button>
            </div>
            <div className="form-grid">
              <SelectField
                label="UC category"
                value={a.category}
                options={ACTIVITY_CATEGORIES}
                onChange={(category) => activities.patch(a.id, { category })}
              />
              <TextField label="Activity / program" value={a.name} onChange={(name) => activities.patch(a.id, { name })} placeholder="Robotics club" autoFocus={!a.name} />
              <TextField label="Your role" value={a.role} onChange={(role) => activities.patch(a.id, { role })} placeholder="Team captain" />
              <TextField label="Hours / week" value={a.hoursPerWeek} onChange={(hoursPerWeek) => activities.patch(a.id, { hoursPerWeek })} inputMode="numeric" />
              <TextField label="Weeks / year" value={a.weeksPerYear} onChange={(weeksPerYear) => activities.patch(a.id, { weeksPerYear })} inputMode="numeric" placeholder="36" />
              <TextField label="Years involved" value={a.years} onChange={(years) => activities.patch(a.id, { years })} placeholder="9, 10, 11" />
              <TextArea
                label="What you did"
                value={a.description}
                onChange={(description) => activities.patch(a.id, { description: description.slice(0, 350) })}
                rows={2}
                placeholder="Role, responsibilities, impact…"
                hint={`${a.description.length}/350 characters (UC limit)`}
              />
            </div>
          </div>
        ))}
      </div>
      <button className="btn-dashed" onClick={() => addActivity()}>
        <PlusIcon width={16} height={16} /> Add activity
      </button>

      <h3 className="form-subhead">
        Honors &amp; awards <span className="count">{profile.awards.length}</span>
      </h3>
      <div className="award-list">
        {profile.awards.map((a) => (
          <div className="award-row" key={a.id}>
            <span className="award-title">{a.title}</span>
            <select
              value={a.level}
              onChange={(e) => awards.patch(a.id, { level: e.target.value as Award["level"] })}
              aria-label={`Level for ${a.title}`}
              className={a.level ? "" : "placeholder"}
            >
              <option value="">Level…</option>
              {AWARD_LEVELS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button className="icon-btn" onClick={() => awards.remove(a.id)} aria-label={`Remove ${a.title}`}>
              <TrashIcon width={16} height={16} />
            </button>
          </div>
        ))}
      </div>
      <form
        className="inline-add"
        onSubmit={(e) => {
          e.preventDefault();
          addAward();
        }}
      >
        <input value={awardDraft} onChange={(e) => setAwardDraft(e.target.value)} placeholder="AP Scholar, Honor Roll, Science Fair 1st place…" aria-label="New award" />
        <button className="btn-ghost" disabled={!awardDraft.trim()}>
          <PlusIcon width={15} height={15} /> Add
        </button>
      </form>

    </>
  );
}

/** Finishing (or skipping) activities here passes the journey step, which starts essay drafting. */
function ActivitiesDone({ profile, update }: { profile: Profile; update: Update }) {
  const status = activitiesStatus(profile);
  if (status.done) {
    return (
      <p className="pf-done">
        <CheckIcon width={14} height={14} /> Activities step done
      </p>
    );
  }
  return (
    <div className="pf-finish">
      <button
        className="btn-primary"
        disabled={status.answered && !status.fits}
        onClick={() => update((p) => ({ ...p, ucJourney: { ...journeyOf(p), activitiesReviewed: true } }))}
      >
        {profile.activities.length ? "I'm done with activities" : "Skip activities for now"}
      </button>
      <p className="field-hint">
        {status.answered && !status.fits
          ? "Shorten any description over 350 characters to finish this step."
          : "Quill drafts your essays from this list."}
      </p>
    </div>
  );
}
