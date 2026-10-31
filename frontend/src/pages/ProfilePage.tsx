import { useMemo, useState } from "react";
import { COLLEGES } from "../colleges";
import { MAJOR_SUGGESTIONS } from "../constants";
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
  type SectionId,
} from "../profile";
import { href, navigate } from "../router";
import { newId } from "../storage";
import type { ActivityCategory, Award, Profile } from "../types";
import { ChipsInput, ProgressRing, Segmented, SelectField, TextArea, TextField, type Option } from "../components/Form";
import { ArrowRightIcon, CheckIcon, PlusIcon, TrashIcon } from "../components/icons";
import { CoursePlanTab } from "./CoursePlanTab";
import { EssayTab } from "./EssayTab";
import { TranscriptTab } from "./TranscriptTab";

const ESSAYS = PROFILE_WORKSPACES.find((w) => w.id === "essays")!;

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

export function ProfilePage({ section: param, onAsk }: { section: string | null; onAsk: (text: string) => void }) {
  const { profile, update } = useProfile();
  const { transcripts, ensureManualTranscript } = usePlanning();
  const section: ProfileRouteId = isRoute(param) ? param : "basics";
  const { sections } = completeness(profile);
  const essaysReady = Object.values(journeyOf(profile).piqs).filter((s) => s === "ready").length;
  const academic = useMemo(() => academicHistoryStatus(profile, transcripts), [profile, transcripts]);
  const navIndex = PROFILE_SECTIONS.findIndex((s) => s.id === section);
  const current = PROFILE_SECTIONS[navIndex] ?? PROFILE_SECTIONS[0];
  const transferUnsupported = profile.basics.gradeLevel === "transfer";

  const set: Setter = (group, key) => (value) => update((p) => ({ ...p, [group]: { ...p[group], [key]: value } }));

  const sectionDone = (id: SectionId) => {
    if (id === "basics") return sections.basics === 1;
    if (id === "academics") return academic.started;
    if (id === "campuses") {
      const ucs = profile.colleges.filter((c) => COLLEGES.some((u) => u.name.toLowerCase() === c.name.toLowerCase()));
      return ucs.length > 0 && ucs.every((c) => !!c.major?.trim());
    }
    return false;
  };

  const sectionValue = (id: SectionId) => {
    if (id === "basics") return sections.basics;
    if (id === "academics") return academic.started ? 0.5 : 0;
    if (id === "campuses") return sectionDone(id) ? 1 : profile.colleges.length ? 0.5 : 0;
    return 0;
  };

  // Sidebar order: the profile sections, the essays, then optional Cost & support last.
  const navItems = [
    ...PROFILE_SECTIONS.filter((s) => s.id !== "finances").map((s) => ({ id: s.id, title: s.title, blurb: s.blurb, done: sectionDone(s.id), value: sectionValue(s.id) })),
    { id: ESSAYS.id, title: ESSAYS.title, blurb: ESSAYS.blurb, done: essaysReady >= PIQ_REQUIRED, value: essaysReady / PIQ_REQUIRED },
    ...PROFILE_SECTIONS.filter((s) => s.id === "finances").map((s) => ({ id: s.id, title: s.title, blurb: s.blurb, done: sectionDone(s.id), value: sectionValue(s.id) })),
  ];

  return (
    <div className="page-scroll">
      <div className="page-inner profile-page">
        {/* The content column is centered on the page; the sidebar sits in the left margin. */}
        <div className="profile-layout">
          <header className="page-head profile-head">
            <div>
              <h1>My profile</h1>
              <p>UC first-year application prep — this does not replace the official UC application.</p>
            </div>
          </header>

          <nav className="section-nav" aria-label="Profile sections">
            {navItems.map((s) => (
              <a key={s.id} href={href("profile", s.id)} className={`section-link ${s.id === section ? "active" : ""}`}>
                <span className={`section-dot ${s.done ? "done" : ""}`}>
                  {s.done ? <CheckIcon width={12} height={12} /> : <ProgressRing value={s.value} size={18} stroke={2.5} />}
                </span>
                <span className="section-text">
                  <span>{s.title}</span>
                  <span className="section-blurb">{s.blurb}</span>
                </span>
              </a>
            ))}
          </nav>

          <div className="profile-main">
            {transferUnsupported && (
              <div className="error-card" role="status">
                <p>
                  This profile flow supports <strong>first-year</strong> UC applicants (including gap-year students). Transfer applicants use a different UC process. Your saved data is kept, but we can’t guide a transfer application here.
                </p>
              </div>
            )}


            {section === "essays" ? (
              <div className="profile-transcript" key={section}>
                <EssayTab onAsk={onAsk} />
              </div>
            ) : section === "plan" ? (
              <div className="profile-transcript" key={section}>
                <CoursePlanTab onAsk={onAsk} />
                <footer className="form-foot card">
                  <button className="btn-ghost" onClick={() => navigate("profile", "academics")}>
                    Back to academic history
                  </button>
                </footer>
              </div>
            ) : section === "academics" ? (
              <div className="profile-transcript" key={section}>
                <AcademicsSection profile={profile} set={set} academic={academic} onAsk={onAsk} onManual={() => ensureManualTranscript()} />
                <footer className="form-foot card">
                  <button className="btn-primary" onClick={() => navigate("profile", "campuses")}>
                    Next: UC campuses &amp; majors <ArrowRightIcon width={16} height={16} />
                  </button>
                </footer>
              </div>
            ) : section === "activities" ? (
              <section className="card form-card" key={section}>
                <header className="card-head">
                  <h2>Activities &amp; awards</h2>
                  <p>UC lets you list up to 20 entries across six categories. Quality matters more than filling every slot — awards and activities are optional.</p>
                </header>
                <ActivitiesWorkspace profile={profile} update={update} />
                <footer className="form-foot">
                  <button className="btn-primary" onClick={() => navigate("map")}>
                    Back to Journey Map <ArrowRightIcon width={16} height={16} />
                  </button>
                </footer>
              </section>
            ) : (
              <section className="card form-card" key={section}>
                <header className="card-head">
                  <h2>{current.title}</h2>
                  <p>{current.blurb}</p>
                </header>

                {section === "basics" && <BasicsForm profile={profile} set={set} />}
                {section === "campuses" && <CampusesForm profile={profile} set={set} update={update} />}
                {section === "finances" && <FinancesForm profile={profile} set={set} />}

                <footer className="form-foot">
                  {section === "basics" ? (
                    <button className="btn-primary" onClick={() => navigate("profile", "academics")}>
                      Next: Academic history <ArrowRightIcon width={16} height={16} />
                    </button>
                  ) : section === "campuses" ? (
                    <button className="btn-primary" onClick={() => navigate("advisor")}>
                      Go to Advisor <ArrowRightIcon width={16} height={16} />
                    </button>
                  ) : (
                    <button className="btn-primary" onClick={() => navigate("advisor")}>
                      Go to Advisor <ArrowRightIcon width={16} height={16} />
                    </button>
                  )}
                </footer>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
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
        wide
      />
      <p className="field-wide muted small">
        First-generation status is optional. Sharing it helps advising and support context; it does not decide aid or admissions on its own.
      </p>
    </div>
  );
}

function AcademicsSection({
  profile,
  set,
  academic,
  onAsk,
  onManual,
}: FormProps & { academic: ReturnType<typeof academicHistoryStatus>; onAsk: (text: string) => void; onManual: () => void }) {
  const { academics: a } = profile;
  return (
    <>
      <section className="card form-card">
        <header className="card-head">
          <h2>Academic history</h2>
          <p>Enter courses manually or optionally import a transcript. An upload is never required to complete your profile.</p>
        </header>
        <p className="jm-note" role="status">
          Preparation status: <strong>{academic.label}</strong>
          {academic.hasUpload ? " · transcript on file" : ""}
        </p>
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
        <div className="form-grid" style={{ marginTop: 12 }}>
          <button type="button" className="btn-dashed field-wide" onClick={onManual}>
            <PlusIcon width={16} height={16} /> Add or edit courses manually
          </button>
        </div>
      </section>
      <TranscriptTab onAsk={onAsk} />
    </>
  );
}

function CampusesForm({ profile, set, update }: FormProps & { update: Update }) {
  const ucs = profile.colleges.filter((c) => COLLEGES.some((u) => u.name.toLowerCase() === c.name.toLowerCase()));
  return (
    <>
      <p className="jm-note">Same campus list as the Journey Map. One UC application covers all nine campuses; each needs an intended major.</p>
      <ul className="jm-campuses" style={{ listStyle: "none", padding: 0, margin: "0 0 1.25rem" }}>
        {COLLEGES.map((college) => {
          const saved = profile.colleges.find((c) => c.name.toLowerCase() === college.name.toLowerCase());
          return (
            <li key={college.name} className={saved ? "on" : ""} style={{ display: "grid", gap: 8, marginBottom: 10 }}>
              <label className="jm-campus-toggle">
                <input type="checkbox" checked={!!saved} onChange={() => update((p) => toggleCampus(p, college.name, newId))} />
                <span>
                  {college.name} <small>{college.city}</small>
                </span>
              </label>
              {saved && (
                <>
                  <TextField
                    label={`Intended major at ${college.name}`}
                    value={saved.major ?? ""}
                    onChange={(major) => update((p) => setCampusMajor(p, college.name, major))}
                    placeholder="e.g. Biology, Undeclared"
                  />
                  <TextField
                    label="Campus notes / supplemental deadlines"
                    value={saved.deadline}
                    onChange={(deadline) =>
                      update((p) => ({
                        ...p,
                        colleges: p.colleges.map((c) => (c.name.toLowerCase() === college.name.toLowerCase() ? { ...c, deadline } : c)),
                      }))
                    }
                    placeholder="Optional portfolio, audition, or campus deadline note"
                    hint="UC uses one application process — not ED/EA/RD."
                  />
                  <TextArea
                    label="Notes"
                    value={saved.notes}
                    onChange={(notes) =>
                      update((p) => ({
                        ...p,
                        colleges: p.colleges.map((c) => (c.name.toLowerCase() === college.name.toLowerCase() ? { ...c, notes } : c)),
                      }))
                    }
                    rows={2}
                    placeholder="Impacted major research, visit notes…"
                  />
                </>
              )}
            </li>
          );
        })}
      </ul>

      <h3 className="form-subhead">General major interests</h3>
      <div className="form-grid">
        <ChipsInput
          label="Majors you're considering (optional advising)"
          values={profile.goals.majors}
          onChange={set("goals", "majors")}
          suggestions={MAJOR_SUGGESTIONS}
          placeholder="Add a major"
        />
        <Segmented
          label="Still exploring majors?"
          value={profile.onboarding.exploringMajors ? "yes" : profile.goals.majors.length ? "no" : ""}
          options={YES_NO}
          onChange={(v) =>
            update((p) => ({
              ...p,
              onboarding: { ...p.onboarding, exploringMajors: v === "yes" },
              goals: v === "yes" ? { ...p.goals, majors: p.goals.majors.length ? p.goals.majors : ["Undeclared"] } : p.goals,
            }))
          }
          wide
        />
      </div>

      <h3 className="form-subhead">Activities &amp; awards</h3>
      <div className="apply-bar field-wide">
        <span>
          {ucs.length === 0 && profile.activities.length === 0 && profile.awards.length === 0
            ? "Activities live on the Journey Map checkpoint — no quota required."
            : `${profile.activities.length} activit${profile.activities.length === 1 ? "y" : "ies"}${profile.awards.length ? ` · ${profile.awards.length} award${profile.awards.length === 1 ? "" : "s"}` : ""}`}
        </span>
        <a className="btn-ghost" href={href("profile", "activities")}>
          Edit activities <ArrowRightIcon width={16} height={16} />
        </a>
      </div>
      {(profile.activities.length > 0 || profile.awards.length > 0) && (
        <ul className="jm-mini-list">
          {profile.activities.slice(0, 5).map((a) => (
            <li key={a.id}>
              <span>{a.name || "Untitled"}</span>
              <span className="jm-ok">{a.category ? ACTIVITY_CATEGORY_LABELS[a.category as Exclude<ActivityCategory, "">] : "Uncategorized"}</span>
            </li>
          ))}
          {profile.awards.slice(0, 3).map((a) => (
            <li key={a.id}>
              <span>{a.title}</span>
              <span className="jm-ok">Award</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function FinancesForm({ profile: { preferences: f }, set }: FormProps) {
  return (
    <>
      <p className="jm-note">
        Optional. Your budget is what your family can plan to pay — not a university’s actual net cost. Income answers never declare exact aid or fee-waiver eligibility.
      </p>
      <div className="form-grid">
        <Segmented
          label="Will you need financial aid?"
          value={f.needsAid}
          options={opts<"yes" | "no" | "unsure">([
            ["yes", "Yes"],
            ["no", "No"],
            ["unsure", "Not sure"],
          ])}
          onChange={set("preferences", "needsAid")}
        />
        <SelectField
          label="Household income"
          value={f.incomeRange}
          onChange={set("preferences", "incomeRange")}
          hint="Optional · prefer not to say is fine"
          options={opts<Profile["preferences"]["incomeRange"]>([
            ["under-30k", "Under $30k"],
            ["30-60k", "$30k – $60k"],
            ["60-110k", "$60k – $110k"],
            ["110-175k", "$110k – $175k"],
            ["over-175k", "Over $175k"],
            ["prefer-not", "Prefer not to say"],
          ])}
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
          options={opts<Profile["preferences"]["fafsa"]>([
            ["not-started", "Not started"],
            ["in-progress", "In progress"],
            ["done", "Done"],
          ])}
        />
      </div>
    </>
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
      <p className="jm-note">
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
      <p className="list-empty" style={{ marginTop: 0 }}>
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

      <ActivitiesDone profile={profile} update={update} />
    </>
  );
}

/** Finishing (or skipping) activities here passes the journey step, which starts essay drafting. */
function ActivitiesDone({ profile, update }: { profile: Profile; update: Update }) {
  const status = activitiesStatus(profile);
  if (status.done) {
    return (
      <p className="jm-note" style={{ marginTop: 24 }}>
        <CheckIcon width={14} height={14} /> Activities step done — Quill drafts your chosen essays from this list automatically.
      </p>
    );
  }
  return (
    <div style={{ marginTop: 24 }}>
      <button
        className="btn-primary"
        disabled={status.answered && !status.fits}
        onClick={() => update((p) => ({ ...p, ucJourney: { ...journeyOf(p), activitiesReviewed: true } }))}
      >
        {profile.activities.length ? "I'm done with activities" : "Skip activities for now"}
      </button>
      <p className="jm-note" style={{ marginTop: 8 }}>
        {status.answered && !status.fits
          ? "Shorten any description over 350 characters to finish this step."
          : "This finishes the activities step, and Quill starts drafting your essays from whatever is here."}
      </p>
    </div>
  );
}
