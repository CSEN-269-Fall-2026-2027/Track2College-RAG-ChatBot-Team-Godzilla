import { useMemo, useState, type ReactNode } from "react";
import { useAuth } from "../auth";
import { COLLEGES } from "../colleges";
import { activitiesStatus, journeyOf, PIQ_REQUIRED, setCampusMajor, toggleCampus } from "../journey/logic";
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
import { href, navigate } from "../router";
import { newId } from "../storage";
import type { ActivityCategory, Award, Profile } from "../types";
import { ProgressRing, Segmented, SelectField, TextArea, TextField, type Option } from "../components/Form";
import { AlertIcon, ArrowRightIcon, CheckIcon, PlusIcon, TrashIcon } from "../components/icons";
import { EssayTab } from "./EssayTab";
import { MajorsTab } from "./MajorsTab";
import { TranscriptTab } from "./TranscriptTab";

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

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "Changes save automatically",
  saving: "Saving…",
  saved: "All changes saved",
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
    if (id === "campuses") return ucs.length > 0 && ucs.every((c) => !!c.major?.trim());
    return false;
  };

  const sectionValue = (id: SectionId) => {
    if (id === "basics") return sections.basics;
    if (id === "academics") return academic.started ? 0.5 : 0;
    if (id === "campuses") return sectionDone(id) ? 1 : profile.colleges.length ? 0.5 : 0;
    return 0;
  };

  const meta = (id: ProfileRouteId) =>
    PROFILE_SECTIONS.find((s) => s.id === id) ?? PROFILE_WORKSPACES.find((w) => w.id === id)!;
  const item = (id: ProfileRouteId, done: boolean, value: number) => ({ id, title: meta(id).title, blurb: meta(id).blurb, done, value });
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
        item("majors", profile.goals.majors.length > 0, profile.onboarding.exploringMajors ? 0.5 : 0),
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
    blurb: meta(id).blurb,
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
                    title={s.blurb}
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
              <>
                <Panel
                  {...panelProps("academics")}
                  badge={
                    <span className={`pf-pill ${academic.started ? "on" : ""}`} role="status">
                      Preparation status: <strong>{academic.label}</strong>
                      {academic.hasUpload ? " · transcript on file" : ""}
                    </span>
                  }
                >
                  {isEditing("academics") ? (
                    <AcademicsForm profile={profile} set={set} />
                  ) : (
                    <Facts
                      items={[
                        ["Reported unweighted GPA", a.gpaUnweighted],
                        ["Reported weighted GPA", a.gpaWeighted],
                        ["AP, IB, or English-proficiency exams", a.exams, true],
                      ]}
                    />
                  )}
                </Panel>
                <div className="pf-embedded">
                  <TranscriptTab onAsk={onAsk} />
                </div>
              </>
            )}

            {section === "campuses" && (
              <>
                <Panel {...panelProps("campuses")}>
                  <p className="pf-note">
                    Same campus list as the Journey Map. One UC application covers all nine campuses; each needs an intended major. UC uses one application process — not ED/EA/RD.
                  </p>
                  {isEditing("campuses") ? (
                    <CampusesForm profile={profile} update={update} />
                  ) : (
                    <CampusesSummary profile={profile} />
                  )}
                </Panel>
                <ActivitiesTeaser profile={profile} />
              </>
            )}

            {section === "activities" && (
              <Panel
                {...panelProps("activities")}
                blurb="UC lets you list up to 20 entries across six categories. Quality matters more than filling every slot — awards and activities are optional."
              >
                {isEditing("activities") ? <ActivitiesWorkspace profile={profile} update={update} /> : <ActivitiesSummary profile={profile} />}
                <ActivitiesDone profile={profile} update={update} />
              </Panel>
            )}

            {section === "finances" && (
              <Panel {...panelProps("finances")}>
                <p className="pf-note">
                  Optional. Your budget is what your family can plan to pay — not a university’s actual net cost. Income answers never declare exact aid or fee-waiver eligibility.
                </p>
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

            <footer className="pf-next">
              {section === "basics" ? (
                <button className="btn-primary" onClick={() => navigate("profile", "academics")}>
                  Next: Academic history <ArrowRightIcon width={16} height={16} />
                </button>
              ) : section === "academics" ? (
                <button className="btn-primary" onClick={() => navigate("profile", "campuses")}>
                  Next: UC campuses &amp; majors <ArrowRightIcon width={16} height={16} />
                </button>
              ) : section === "activities" ? (
                <button className="btn-primary" onClick={() => navigate("map")}>
                  Back to Journey Map <ArrowRightIcon width={16} height={16} />
                </button>
              ) : section === "majors" ? (
                <button className="btn-primary" onClick={() => navigate("profile", "campuses")}>
                  Next: Set a major for each campus <ArrowRightIcon width={16} height={16} />
                </button>
              ) : section === "essays" ? null : (
                <button className="btn-primary" onClick={() => navigate("advisor")}>
                  Go to Advisor <ArrowRightIcon width={16} height={16} />
                </button>
              )}
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}

/** A section card: title, optional status badge, and an Edit / Done toggle between summary and form. */
function Panel({
  title,
  blurb,
  badge,
  editing,
  onEdit,
  onDone,
  saveState,
  children,
}: {
  title: string;
  blurb: string;
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
          <p>{blurb}</p>
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

function CampusesSummary({ profile }: { profile: Profile }) {
  const selected = COLLEGES.map((college) => ({ college, saved: profile.colleges.find((c) => c.name.toLowerCase() === college.name.toLowerCase()) })).filter(
    (x) => x.saved,
  );
  return (
    <>
      <h3 className="pf-subhead">
        Campuses <span className="count">{selected.length}</span>
      </h3>
      {selected.length === 0 ? (
        <p className="pf-empty">No campuses selected yet.</p>
      ) : (
        <ul className="pf-rows">
          {selected.map(({ college, saved }) => (
            <li key={college.name}>
              <div className="pf-row-main">
                <strong>{college.name}</strong>
                <span>{college.city}</span>
              </div>
              <div className="pf-row-side">
                {saved!.major?.trim() ? <span className="pf-row-value">{saved!.major}</span> : <span className="pf-pill warn">Needs a major</span>}
              </div>
              {(saved!.deadline || saved!.notes) && (
                <p className="pf-row-note">{[saved!.deadline, saved!.notes].filter(Boolean).join(" · ")}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="pf-note">
        Majors you're considering in general live in <a href={href("profile", "majors")}>Major selection</a>.
      </p>
    </>
  );
}

function ActivitiesTeaser({ profile }: { profile: Profile }) {
  const ucCount = profile.colleges.filter((c) => isUc(c.name)).length;
  return (
    <section className="pf-panel">
      <header className="pf-panel-head">
        <div className="pf-panel-title">
          <h2>Activities &amp; awards</h2>
          <p>
            {ucCount === 0 && profile.activities.length === 0 && profile.awards.length === 0
              ? "Activities live on the Journey Map checkpoint — no quota required."
              : `${profile.activities.length} activit${profile.activities.length === 1 ? "y" : "ies"}${profile.awards.length ? ` · ${profile.awards.length} award${profile.awards.length === 1 ? "" : "s"}` : ""}`}
          </p>
        </div>
        <a className="pf-edit" href={href("profile", "activities")}>
          Edit activities <ArrowRightIcon width={14} height={14} />
        </a>
      </header>
      {(profile.activities.length > 0 || profile.awards.length > 0) && (
        <ul className="pf-rows">
          {profile.activities.slice(0, 5).map((a) => (
            <li key={a.id}>
              <div className="pf-row-main">
                <strong>{a.name || "Untitled"}</strong>
              </div>
              <span className="pf-pill">{a.category ? ACTIVITY_CATEGORY_LABELS[a.category as Exclude<ActivityCategory, "">] : "Uncategorized"}</span>
            </li>
          ))}
          {profile.awards.slice(0, 3).map((a) => (
            <li key={a.id}>
              <div className="pf-row-main">
                <strong>{a.title}</strong>
              </div>
              <span className="pf-pill">Award</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivitiesSummary({ profile }: { profile: Profile }) {
  return (
    <>
      <h3 className="pf-subhead">
        Activities <span className="count">{profile.activities.length}</span>
      </h3>
      {profile.activities.length === 0 ? (
        <p className="pf-empty">Jobs, family responsibilities, clubs, volunteering, and prep programs all count. No minimum number required.</p>
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
        <p className="pf-empty">Optional. Awards can also be listed as activities in the “Award or honor” category.</p>
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
      <TextField label="State" value={b.state} onChange={set("basics", "state")} autoComplete="address-level1" placeholder="CA" hint="Where you go to school — not a California residency determination." />
      <Segmented
        label="Will you be the first in your family to attend college?"
        value={b.firstGen}
        options={YES_NO}
        onChange={set("basics", "firstGen")}
        hint="First-generation status is optional. Sharing it helps advising and support context; it does not decide aid or admissions on its own."
        wide
      />
    </div>
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
      hint="Optional · from your school — not a calculated UC GPA"
    />
    <TextField
      label="Reported weighted GPA"
      value={a.gpaWeighted}
      onChange={set("academics", "gpaWeighted")}
      inputMode="decimal"
      placeholder="4.10"
      hint="Optional · school-reported weighted GPA"
    />
    <TextArea
      label="AP, IB, or English-proficiency exams"
      value={a.exams}
      onChange={set("academics", "exams")}
      rows={3}
      placeholder="e.g. AP Calculus BC 4; IB History HL; TOEFL if applicable…"
      hint="Optional · exams are separate from courses. Include only what applies to you."
    />
  </div>
  );
}

function CampusesForm({ profile, update }: { profile: Profile; update: Update }) {
  const savedFor = (name: string) => profile.colleges.find((c) => c.name.toLowerCase() === name.toLowerCase());
  const patchCampus = (name: string, change: Partial<Profile["colleges"][number]>) =>
    update((p) => ({
      ...p,
      colleges: p.colleges.map((c) => (c.name.toLowerCase() === name.toLowerCase() ? { ...c, ...change } : c)),
    }));
  const selected = COLLEGES.filter((college) => savedFor(college.name));

  return (
    <>

      <ul className="pf-campus-grid" aria-label="UC campuses">
        {COLLEGES.map((college) => {
          const on = !!savedFor(college.name);
          return (
            <li key={college.name}>
              <label className={`pf-campus ${on ? "on" : ""}`}>
                <input type="checkbox" checked={on} onChange={() => update((p) => toggleCampus(p, college.name, newId))} />
                <span className="pf-campus-box" aria-hidden="true">
                  {on && <CheckIcon width={12} height={12} />}
                </span>
                <span className="pf-campus-text">
                  <span className="pf-campus-name">{college.name}</span>
                  <span className="pf-campus-city">{college.city}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {selected.length > 0 && (
        <div className="list pf-campus-details">
          {selected.map((college) => {
            const saved = savedFor(college.name)!;
            return (
              <div className="list-card" key={college.name}>
                <div className="pf-campus-head">
                  <h4>{college.name}</h4>
                  <span>{college.city}</span>
                  {saved.major?.trim() ? (
                    <span className="pf-pill on">
                      <CheckIcon width={12} height={12} /> Major set
                    </span>
                  ) : (
                    <span className="pf-pill">Needs a major</span>
                  )}
                </div>
                <div className="form-grid">
                  <TextField
                    label={`Intended major at ${college.name}`}
                    value={saved.major ?? ""}
                    onChange={(major) => update((p) => setCampusMajor(p, college.name, major))}
                    placeholder="e.g. Biology, Undeclared"
                  />
                  <TextField
                    label="Campus notes / supplemental deadlines"
                    value={saved.deadline}
                    onChange={(deadline) => patchCampus(college.name, { deadline })}
                    placeholder="Optional portfolio, audition, or campus deadline note"
                  />
                  <TextArea
                    label="Notes"
                    value={saved.notes}
                    onChange={(notes) => patchCampus(college.name, { notes })}
                    rows={2}
                    placeholder="Impacted major research, visit notes…"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="pf-note">
        Majors you're considering in general live in <a href={href("profile", "majors")}>Major selection</a>, with a quick survey if you're unsure.
      </p>

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
          hint="Optional · prefer not to say is fine"
          options={INCOME}
        />
        <TextField
          label="Annual budget you can plan for"
          value={f.maxAnnualCost}
          onChange={set("preferences", "maxAnnualCost")}
          inputMode="numeric"
          placeholder="15000"
          hint="USD · your planning number, not a campus net-cost quote"
        />
        <SelectField
          label="FAFSA or California Dream Act"
          value={f.fafsa}
          onChange={set("preferences", "fafsa")}
          hint="Not every student files FAFSA — use CADAA when that fits your situation. Progress belongs on the journey checklist too."
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
      <p className="pf-note">
        Categories: award or honor, educational preparation, extracurricular, other coursework, volunteering, and paid work. You do not need an entry in every category.
      </p>
      <h3 className="form-subhead">
        Activities <span className="count">{profile.activities.length}</span>
      </h3>
      {profile.activities.length === 0 && (
        <p className="list-empty">Jobs, family responsibilities, clubs, volunteering, and prep programs all count. No minimum number required.</p>
      )}
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
      <p className="pf-hint">
        Optional. Awards can also be listed as activities in the “Award or honor” category above.
      </p>
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
        <CheckIcon width={14} height={14} /> Activities step done — Quill drafts your chosen essays from this list automatically.
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
          : "This finishes the activities step, and Quill starts drafting your essays from whatever is here."}
      </p>
    </div>
  );
}
