import { useState } from "react";
import { KNOWN_COLLEGES, MAJOR_SUGGESTIONS } from "../constants";
import { PROFILE_SECTIONS, completeness, useProfile, type SaveState, type SectionId } from "../profile";
import { href, navigate } from "../router";
import { newId } from "../storage";
import type { Activity, Award, Profile, TargetCollege } from "../types";
import { ChipsInput, ProgressRing, Segmented, SelectField, TextArea, TextField, type Option } from "../components/Form";
import { ArrowRightIcon, CheckIcon, PlusIcon, TrashIcon } from "../components/icons";

type Group = "basics" | "academics" | "goals" | "preferences";
type Setter = <G extends Group, K extends keyof Profile[G]>(group: G, key: K) => (value: Profile[G][K]) => void;

const opts = <T extends string>(pairs: [T, string][]): Option<T>[] => pairs.map(([value, label]) => ({ value, label }));

const GRADES = opts<Profile["basics"]["gradeLevel"]>([
  ["9", "9th grade"],
  ["10", "10th grade"],
  ["11", "11th grade"],
  ["12", "12th grade"],
  ["gap", "Gap year"],
  ["transfer", "Transfer student"],
]);
const YES_NO = opts<"yes" | "no">([
  ["yes", "Yes"],
  ["no", "No"],
]);
const TEST_PLANS = opts<Profile["academics"]["testPlan"]>([
  ["submitting", "Submitting scores"],
  ["test-optional", "Going test-optional"],
  ["undecided", "Undecided"],
]);
const PROGRESS = opts<Profile["preferences"]["fafsa"]>([
  ["not-started", "Not started"],
  ["in-progress", "In progress"],
  ["done", "Done"],
]);
const STATUSES = opts<TargetCollege["status"]>([
  ["researching", "Researching"],
  ["applying", "Applying"],
  ["submitted", "Submitted"],
  ["accepted", "Accepted"],
  ["waitlisted", "Waitlisted"],
  ["denied", "Denied"],
]);
const PLANS = opts<TargetCollege["plan"]>([
  ["UC", "UC application"],
  ["CSU", "Cal State Apply"],
  ["EA", "Early Action"],
  ["ED", "Early Decision"],
  ["REA", "Restrictive EA"],
  ["RD", "Regular Decision"],
  ["Rolling", "Rolling"],
]);
const AWARD_LEVELS = opts<Award["level"]>([
  ["school", "School"],
  ["regional", "Regional"],
  ["state", "State"],
  ["national", "National"],
  ["international", "International"],
]);

function isSection(value: string | null): value is SectionId {
  return PROFILE_SECTIONS.some((s) => s.id === value);
}

function SavedIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return <span className="saved muted">Changes save automatically</span>;
  if (state === "saving") return <span className="saved">Saving…</span>;
  if (state === "error") return <span className="saved error">Couldn't save. Check your connection.</span>;
  return (
    <span className="saved ok">
      <CheckIcon width={14} height={14} /> Saved
    </span>
  );
}

export function ProfilePage({ section: param }: { section: string | null }) {
  const { profile, update, saveState } = useProfile();
  const section: SectionId = isSection(param) ? param : "basics";
  const { overall, sections } = completeness(profile);
  const index = PROFILE_SECTIONS.findIndex((s) => s.id === section);
  const current = PROFILE_SECTIONS[index];
  const next = PROFILE_SECTIONS[index + 1];

  const set: Setter = (group, key) => (value) =>
    update((p) => ({ ...p, [group]: { ...p[group], [key]: value } }));

  return (
    <div className="page-scroll">
      <div className="page-inner">
        <header className="page-head">
          <div>
            <h1>My profile</h1>
            <p>The more you share, the more specific your advisor and insights can be.</p>
          </div>
          <div className="page-head-side">
            <SavedIndicator state={saveState} />
            <div className="overall">
              <ProgressRing value={overall} size={40} />
              <span>
                <strong>{Math.round(overall * 100)}%</strong> complete
              </span>
            </div>
          </div>
        </header>

        <div className="profile-layout">
          <nav className="section-nav" aria-label="Profile sections">
            {PROFILE_SECTIONS.map((s) => {
              const done = sections[s.id] === 1;
              return (
                <a key={s.id} href={href("profile", s.id)} className={`section-link ${s.id === section ? "active" : ""}`}>
                  <span className={`section-dot ${done ? "done" : ""}`}>
                    {done ? <CheckIcon width={12} height={12} /> : <ProgressRing value={sections[s.id]} size={18} stroke={2.5} />}
                  </span>
                  <span className="section-text">
                    <span>{s.title}</span>
                    <span className="section-blurb">{s.blurb}</span>
                  </span>
                </a>
              );
            })}
          </nav>

          <section className="card form-card" key={section}>
            <header className="card-head">
              <h2>{current.title}</h2>
              <p>{current.blurb}</p>
            </header>

            {section === "basics" && <BasicsForm profile={profile} set={set} />}
            {section === "academics" && <AcademicsForm profile={profile} set={set} />}
            {section === "goals" && <GoalsForm profile={profile} set={set} />}
            {section === "activities" && <ActivitiesForm profile={profile} update={update} />}
            {section === "colleges" && <CollegesForm profile={profile} update={update} />}
            {section === "finances" && <FinancesForm profile={profile} set={set} />}

            <footer className="form-foot">
              {next ? (
                <button className="btn-primary" onClick={() => navigate("profile", next.id)}>
                  Next: {next.title} <ArrowRightIcon width={16} height={16} />
                </button>
              ) : (
                <button className="btn-primary" onClick={() => navigate("insights")}>
                  See my insights <ArrowRightIcon width={16} height={16} />
                </button>
              )}
            </footer>
          </section>
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
      <SelectField label="Current grade" value={b.gradeLevel} options={GRADES} onChange={set("basics", "gradeLevel")} />
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
        wide
      />
    </div>
  );
}

function AcademicsForm({ profile: { academics: a }, set }: FormProps) {
  return (
    <div className="form-grid">
      <a className="apply-bar field-wide transcript-shortcut" href={href("insights", "transcript")}>
        <span>
          <strong>Have your transcript?</strong> Upload it to calculate your GPA and fill this in automatically.
        </span>
        <ArrowRightIcon width={16} height={16} />
      </a>
      <TextField label="Unweighted GPA" value={a.gpaUnweighted} onChange={set("academics", "gpaUnweighted")} inputMode="decimal" placeholder="3.70" />
      <TextField label="Weighted GPA" value={a.gpaWeighted} onChange={set("academics", "gpaWeighted")} inputMode="decimal" placeholder="4.10" />
      <TextField label="Class rank" value={a.classRank} onChange={set("academics", "classRank")} placeholder="Top 10% or 25 / 410" hint="Optional" />
      <TextField
        label="AP / IB / honors courses"
        value={a.apIbCourses}
        onChange={set("academics", "apIbCourses")}
        inputMode="numeric"
        placeholder="6"
        hint="Total taken or planned"
      />
      <SelectField label="Testing plan" value={a.testPlan} options={TEST_PLANS} onChange={set("academics", "testPlan")} hint="UCs and CSUs are test-blind" />
      <div className="field-pair">
        <TextField label="SAT" value={a.sat} onChange={set("academics", "sat")} inputMode="numeric" placeholder="1350" />
        <TextField label="ACT" value={a.act} onChange={set("academics", "act")} inputMode="numeric" placeholder="29" />
      </div>
      <TextArea
        label="Coursework highlights"
        value={a.coursework}
        onChange={set("academics", "coursework")}
        placeholder="AP Calculus BC, AP Biology, dual enrollment Intro to Programming…"
        hint="Include A–G progress if you know it."
      />
    </div>
  );
}

function GoalsForm({ profile: { goals: g }, set }: FormProps) {
  return (
    <div className="form-grid">
      <ChipsInput label="Majors you're considering" values={g.majors} onChange={set("goals", "majors")} suggestions={MAJOR_SUGGESTIONS} placeholder="Add a major" />
      <TextField label="Career interests" value={g.careers} onChange={set("goals", "careers")} wide placeholder="Software engineering, healthcare, teaching…" />
      <TextArea
        label="What do you want out of college?"
        value={g.whyCollege}
        onChange={set("goals", "whyCollege")}
        rows={4}
        placeholder="Close to home, strong research opportunities, a big campus with lots of clubs…"
      />
    </div>
  );
}

function FinancesForm({ profile: { preferences: f }, set }: FormProps) {
  return (
    <>
      <h3 className="form-subhead">Paying for college</h3>
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
          hint="Used only to estimate aid eligibility"
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
          label="Max yearly cost your family can pay"
          value={f.maxAnnualCost}
          onChange={set("preferences", "maxAnnualCost")}
          inputMode="numeric"
          placeholder="15000"
          hint="In USD, after aid"
        />
        <SelectField label="FAFSA / CADAA" value={f.fafsa} options={PROGRESS} onChange={set("preferences", "fafsa")} />
      </div>

      <h3 className="form-subhead">Application progress</h3>
      <div className="form-grid">
        <Segmented label="Personal essays" value={f.essays} options={PROGRESS} onChange={set("preferences", "essays")} />
        <Segmented label="Recommendation letters" value={f.recommendations} options={PROGRESS} onChange={set("preferences", "recommendations")} />
      </div>

      <h3 className="form-subhead">Campus preferences</h3>
      <div className="form-grid">
        <SelectField
          label="Campus size"
          value={f.campusSize}
          onChange={set("preferences", "campusSize")}
          options={opts<Profile["preferences"]["campusSize"]>([
            ["small", "Small (< 5k)"],
            ["medium", "Medium (5k – 15k)"],
            ["large", "Large (15k+)"],
            ["any", "No preference"],
          ])}
        />
        <SelectField
          label="Setting"
          value={f.setting}
          onChange={set("preferences", "setting")}
          options={opts<Profile["preferences"]["setting"]>([
            ["urban", "Urban"],
            ["suburban", "Suburban"],
            ["rural", "Rural"],
            ["any", "No preference"],
          ])}
        />
        <TextField label="Preferred regions" value={f.regions} onChange={set("preferences", "regions")} wide placeholder="Bay Area, Southern California, anywhere in CA…" />
      </div>
    </>
  );
}

type Update = (change: (p: Profile) => Profile) => void;

function useListEditor<K extends "activities" | "awards" | "colleges">(update: Update, key: K) {
  type Item = Profile[K][number];
  return {
    add: (item: Item) => update((p) => ({ ...p, [key]: [...p[key], item] })),
    patch: (id: string, change: Partial<Item>) =>
      update((p) => ({ ...p, [key]: (p[key] as Item[]).map((x) => (x.id === id ? { ...x, ...change } : x)) })),
    remove: (id: string) => update((p) => ({ ...p, [key]: (p[key] as Item[]).filter((x) => x.id !== id) })),
  };
}

function ActivitiesForm({ profile, update }: { profile: Profile; update: Update }) {
  const activities = useListEditor(update, "activities");
  const awards = useListEditor(update, "awards");
  const [awardDraft, setAwardDraft] = useState("");

  const addActivity = () =>
    activities.add({ id: newId(), name: "", role: "", hoursPerWeek: "", years: "", description: "" } satisfies Activity);
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
      {profile.activities.length === 0 && (
        <p className="list-empty">Clubs, sports, jobs, family responsibilities, volunteering, and personal projects all count.</p>
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
              <TextField label="Activity" value={a.name} onChange={(name) => activities.patch(a.id, { name })} placeholder="Robotics club" autoFocus={!a.name} />
              <TextField label="Your role" value={a.role} onChange={(role) => activities.patch(a.id, { role })} placeholder="Team captain" />
              <TextField label="Hours / week" value={a.hoursPerWeek} onChange={(hoursPerWeek) => activities.patch(a.id, { hoursPerWeek })} inputMode="numeric" />
              <TextField label="Years involved" value={a.years} onChange={(years) => activities.patch(a.id, { years })} placeholder="9, 10, 11" />
              <TextArea
                label="What you did"
                value={a.description}
                onChange={(description) => activities.patch(a.id, { description })}
                rows={2}
                placeholder="Led a team of 12 to build…"
              />
            </div>
          </div>
        ))}
      </div>
      <button className="btn-dashed" onClick={addActivity}>
        <PlusIcon width={16} height={16} /> Add activity
      </button>

      <h3 className="form-subhead">
        Honors & awards <span className="count">{profile.awards.length}</span>
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

function CollegesForm({ profile, update }: { profile: Profile; update: Update }) {
  const colleges = useListEditor(update, "colleges");
  const [draft, setDraft] = useState("");
  const listId = "known-colleges";

  const add = (name: string) => {
    const clean = name.trim();
    if (!clean || profile.colleges.some((c) => c.name.toLowerCase() === clean.toLowerCase())) return;
    colleges.add({ id: newId(), name: clean, status: "researching", plan: "", deadline: "", notes: "" } satisfies TargetCollege);
    setDraft("");
  };

  // Picking a datalist suggestion fires onChange with the full name; add it right away.
  const onDraftChange = (value: string) => (KNOWN_COLLEGES.includes(value) ? add(value) : setDraft(value));

  return (
    <>
      <form
        className="inline-add"
        onSubmit={(e) => {
          e.preventDefault();
          add(draft);
        }}
      >
        <input value={draft} onChange={(e) => onDraftChange(e.target.value)} list={listId} placeholder="Search or type a college name" aria-label="Add a college" />
        <datalist id={listId}>
          {KNOWN_COLLEGES.filter((c) => !profile.colleges.some((x) => x.name === c)).map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button className="btn-primary" disabled={!draft.trim()}>
          <PlusIcon width={15} height={15} /> Add
        </button>
      </form>
      <p className="field-hint">Aim for a balanced list of 6–10 schools. Advisor knowledge is deepest for California public universities.</p>

      {profile.colleges.length === 0 ? (
        <p className="list-empty">No colleges yet. Add a few you're curious about; you can refine the list later.</p>
      ) : (
        <div className="college-table" role="table" aria-label="College list">
          <div className="college-row college-head" role="row">
            <span role="columnheader">College</span>
            <span role="columnheader">Application</span>
            <span role="columnheader">Deadline</span>
            <span role="columnheader">Status</span>
            <span />
          </div>
          {profile.colleges.map((c) => (
            <div className="college-row" role="row" key={c.id}>
              <span className="college-name" role="cell">
                {c.name}
              </span>
              <select role="cell" value={c.plan} onChange={(e) => colleges.patch(c.id, { plan: e.target.value as TargetCollege["plan"] })} aria-label={`Application type for ${c.name}`} className={c.plan ? "" : "placeholder"}>
                <option value="">Type…</option>
                {PLANS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input role="cell" type="date" value={c.deadline} onChange={(e) => colleges.patch(c.id, { deadline: e.target.value })} aria-label={`Deadline for ${c.name}`} />
              <select role="cell" value={c.status} onChange={(e) => colleges.patch(c.id, { status: e.target.value as TargetCollege["status"] })} aria-label={`Status for ${c.name}`} className={`status-select s-${c.status}`}>
                {STATUSES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button className="icon-btn" onClick={() => colleges.remove(c.id)} aria-label={`Remove ${c.name}`} title="Remove">
                <TrashIcon width={16} height={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
