import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PIQ_PROMPTS } from "./journey/logic";
import { getStore } from "./data";
import { OTHER_MAJOR, toMajorChoice } from "./constants";
import type { Activity, ActivityCategory, Profile, TargetCollege, Transcript } from "./types";

export function emptyOnboarding(): Profile["onboarding"] {
  return {
    completed: false,
    checkpoint: 0,
    subjects: [],
    exploringMajors: false,
    gpaScale: "",
    distance: "",
    priorities: [],
    biggestQuestion: "",
    helpFocus: "",
    activityNote: "",
    completedAt: null,
  };
}

export function emptyActivity(partial: Partial<Activity> & { id: string }): Activity {
  return {
    id: partial.id,
    name: partial.name ?? "",
    role: partial.role ?? "",
    hoursPerWeek: partial.hoursPerWeek ?? "",
    weeksPerYear: partial.weeksPerYear ?? "",
    years: partial.years ?? "",
    description: partial.description ?? "",
    category: partial.category ?? "",
  };
}

export function emptyProfile(firstName = "", lastName = ""): Profile {
  return {
    basics: { firstName, lastName, gradeLevel: "", graduationYear: "", highSchool: "", city: "", state: "", firstGen: "" },
    academics: {
      gpaUnweighted: "",
      gpaWeighted: "",
      exams: "",
      classRank: "",
      apIbCourses: "",
      sat: "",
      act: "",
      testPlan: "",
      coursework: "",
    },
    goals: { majors: [], intendedMajor: "", careers: "", whyCollege: "" },
    activities: [],
    awards: [],
    colleges: [],
    preferences: {
      regions: "",
      campusSize: "",
      setting: "",
      maxAnnualCost: "",
      needsAid: "",
      incomeRange: "",
      fafsa: "",
      essays: "",
      recommendations: "",
    },
    checklistDone: {},
    onboarding: emptyOnboarding(),
    updatedAt: 0,
  };
}

/**
 * The saved intended major, or for older profiles the one implied by their per-campus majors
 * (the first one set) or their onboarding interests, mapped onto the major choices.
 */
function intendedMajorOf(stored: Partial<Profile>): string {
  if (stored.goals?.intendedMajor !== undefined) return toMajorChoice(stored.goals.intendedMajor);
  const campusMajor = (stored.colleges ?? []).map((c) => toMajorChoice(c.major)).find(Boolean);
  if (campusMajor) return campusMajor;
  return (stored.goals?.majors ?? []).map(toMajorChoice).find((m) => m && m !== OTHER_MAJOR) ?? "";
}

/** Merge stored data over defaults so profiles saved by older versions gain new fields. */
export function hydrate(stored: Partial<Profile> | null, fallback: Profile): Profile {
  if (!stored) return fallback;
  const academics = { ...fallback.academics, ...stored.academics };
  if (!("exams" in (stored.academics ?? {})) && stored.academics?.apIbCourses) {
    // Soft-migrate: keep legacy apIbCourses; exams stay empty until the student fills them.
    academics.exams = academics.exams ?? "";
  }
  return {
    ...fallback,
    ...stored,
    basics: { ...fallback.basics, ...stored.basics },
    academics,
    goals: { ...fallback.goals, ...stored.goals, intendedMajor: intendedMajorOf(stored) },
    preferences: {
      ...fallback.preferences,
      ...stored.preferences,
      // The retired Apply page kept its own "FAFSA done" flag; fold it into the one story mode,
      // the journey map, and the chatbot all read.
      ...(stored.ucJourney?.agent?.fafsaDoneAt ? { fafsa: "done" as const } : {}),
    },
    activities: (stored.activities ?? fallback.activities).map((a) => emptyActivity({ ...a, id: a.id })),
    awards: stored.awards ?? fallback.awards,
    colleges: stored.colleges ?? fallback.colleges,
    checklistDone: { ...fallback.checklistDone, ...stored.checklistDone },
    onboarding: { ...fallback.onboarding, ...stored.onboarding },
    // Once folded in, drop the old flag so a later "not done yet" answer isn't flipped back on reload.
    ucJourney: stored.ucJourney?.agent?.fafsaDoneAt
      ? { ...stored.ucJourney, agent: { ...stored.ucJourney.agent, fafsaDoneAt: undefined } }
      : (stored.ucJourney ?? fallback.ucJourney),
    piqWork: stored.piqWork ?? fallback.piqWork,
  };
}

// ---------------------------------------------------------------------------
// Completeness — core profile setup only (About You basics)
// ---------------------------------------------------------------------------

export const PROFILE_SECTIONS = [
  { id: "basics", title: "About you" },
  { id: "academics", title: "Academic history" },
  { id: "campuses", title: "UC campuses" },
  { id: "finances", title: "Cost & support" },
] as const;

/** Dedicated workspace routes — not part of profile completeness. Essays and the course plan used to be "Materials". */
export const PROFILE_WORKSPACES = [
  { id: "activities", title: "Activities & awards" },
  { id: "essays", title: "Personal insight essays" },
  { id: "majors", title: "Major selection" },
] as const;

export type SectionId = (typeof PROFILE_SECTIONS)[number]["id"];
export type ProfileRouteId = SectionId | (typeof PROFILE_WORKSPACES)[number]["id"];

const filled = (value: string) => value.trim().length > 0;

export const ACTIVITY_CATEGORY_LABELS: Record<Exclude<ActivityCategory, "">, string> = {
  award: "Award or honor",
  "educational-prep": "Educational preparation",
  extracurricular: "Extracurricular activity",
  "other-coursework": "Other coursework",
  volunteering: "Volunteering / community service",
  work: "Work experience / paid work",
};

export function sectionChecks(p: Profile): Partial<Record<SectionId, boolean[]>> {
  const { basics: b } = p;
  return {
    basics: [filled(b.firstName), b.gradeLevel !== "" && b.gradeLevel !== "transfer", filled(b.graduationYear), filled(b.highSchool), filled(b.state)],
  };
}

/** Core profile setup only. Optional GPA, aid, activities, and campuses do not reduce this. */
export function completeness(p: Profile) {
  const checks = sectionChecks(p);
  const basicsList = checks.basics ?? [];
  const basics = basicsList.length ? basicsList.filter(Boolean).length / basicsList.length : 0;
  const sections = Object.fromEntries(PROFILE_SECTIONS.map(({ id }) => [id, id === "basics" ? basics : 0])) as Record<SectionId, number>;
  return { overall: basics, sections };
}

export type AcademicHistoryStatus = {
  started: boolean;
  courseCount: number;
  hasReportedGpa: boolean;
  hasUpload: boolean;
  /** Honest label — never treats an upload alone as “complete.” */
  label: string;
};

/** Separate from profile completeness; upload ≠ finished academic history. */
export function academicHistoryStatus(p: Profile, transcripts: Transcript[] = []): AcademicHistoryStatus {
  const courseCount = transcripts.reduce((n, t) => n + t.courses.length, 0);
  const hasReportedGpa = filled(p.academics.gpaUnweighted) || filled(p.academics.gpaWeighted);
  const hasUpload = transcripts.some((t) => !!t.fileName && t.fileName !== "Manual entry");
  const started = courseCount > 0 || hasReportedGpa;
  let label = "Not started";
  if (started && courseCount === 0) label = "Reported GPA only — add courses when ready";
  else if (courseCount > 0 && courseCount < 4) label = `In progress · ${courseCount} course${courseCount === 1 ? "" : "s"} saved`;
  else if (courseCount >= 4) label = `In progress · ${courseCount} courses — review A–G and grades before applying`;
  return { started, courseCount, hasReportedGpa, hasUpload, label };
}

// ---------------------------------------------------------------------------
// Derived data
// ---------------------------------------------------------------------------

const GRADE_LABEL: Record<string, string> = {
  "9": "9th grade",
  "10": "10th grade",
  "11": "11th grade (junior)",
  "12": "12th grade (senior)",
  gap: "gap year",
  transfer: "community college / transfer student",
};

export function displayName(p: Profile, fallback: string) {
  return p.basics.firstName.trim() || fallback.split(" ")[0];
}

export function parseDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T23:59:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function upcomingDeadlines(p: Profile, now = Date.now()) {
  return p.colleges
    .map((college) => ({ college, date: parseDate(college.deadline) }))
    .filter((item): item is { college: TargetCollege; date: Date } => item.date !== null)
    .filter(({ college }) => college.status === "researching" || college.status === "applying")
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map(({ college, date }) => ({ college, date, days: Math.ceil((date.getTime() - now) / 86_400_000) }));
}

/**
 * Compact, plain-text profile for the LLM. Only filled, UC-relevant fields.
 * Deprecated SAT/ACT/test-plan and removed preference fields are omitted.
 */
export function profileSummary(p: Profile): string {
  const { basics: b, academics: a, goals: g, preferences: f } = p;
  const lines: string[] = [];
  const add = (label: string, value: string | undefined | false) => {
    if (value && value.trim()) lines.push(`${label}: ${value.trim()}`);
  };

  add("Name", b.firstName);
  add("Grade", GRADE_LABEL[b.gradeLevel]);
  add("Graduation year", b.graduationYear);
  add("High school", [b.highSchool, b.city, b.state].filter(Boolean).join(", "));
  if (b.state === "CA") {
    lines.push("Note: Living in California is not the same as qualifying for California residency for tuition.");
  }
  add("First-generation college student", b.firstGen === "yes" ? "yes" : b.firstGen === "no" ? "no" : "");
  add("Reported unweighted GPA", a.gpaUnweighted);
  add("Reported weighted GPA", a.gpaWeighted);
  add("AP/IB or English-proficiency exams", a.exams);
  add(
    "Intended major (the same at every UC campus)",
    g.intendedMajor === OTHER_MAJOR ? "Other (not one of the ten largest UC majors)" : g.intendedMajor || "not chosen yet",
  );
  add("General major interests", g.majors.join(", "));
  if (p.onboarding?.exploringMajors) lines.push("Majors: still exploring");
  if (p.activities.length) {
    lines.push(
      "Activities: " +
        p.activities
          .map((x) => {
            const cat = x.category ? ACTIVITY_CATEGORY_LABELS[x.category as Exclude<ActivityCategory, "">] : "";
            return [cat && `[${cat}]`, x.name, x.role && `(${x.role})`, x.hoursPerWeek && `${x.hoursPerWeek} hrs/wk`, x.weeksPerYear && `${x.weeksPerYear} wks/yr`]
              .filter(Boolean)
              .join(" ");
          })
          .join("; "),
    );
  }
  if (p.awards.length) {
    lines.push("Awards: " + p.awards.map((x) => (x.level ? `${x.title} (${x.level})` : x.title)).join("; "));
  }
  if (p.colleges.length) {
    lines.push(
      "UC campus list: " + p.colleges.map((c) => `${c.name} (status ${c.status})`).join("; "),
    );
  }
  add("Needs financial aid", f.needsAid);
  add("Student annual budget (USD, not university net cost)", f.maxAnnualCost);
  add("Household income range", f.incomeRange && f.incomeRange !== "prefer-not" ? f.incomeRange : "");
  add("FAFSA or California Dream Act status", f.fafsa.replace("-", " "));
  const ob = p.onboarding;
  if (ob) {
    add("Favorite subjects", ob.subjects?.length ? ob.subjects.join(", ") : "");
    add("Biggest college question", ob.biggestQuestion);
    add("Wants help with first", ob.helpFocus);
  }
  const piqs = Object.entries(p.ucJourney?.piqs ?? {});
  lines.push(
    "Chosen UC Personal Insight Questions: " +
      (piqs.length
        ? piqs.map(([id, status]) => `${PIQ_PROMPTS.find((q) => q.id === id)?.prompt ?? id} (${status.replace("-", " ")})`).join("; ")
        : "none chosen yet"),
  );
  lines.push("Context: Track2College prepares first-year UC applicants; it does not replace the official UC application.");
  return lines.join("\n");
}

export function profileHash(p: Profile): string {
  const text = JSON.stringify({ ...p, updatedAt: 0 });
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export type SaveState = "idle" | "saving" | "saved" | "error";

interface ProfileContextValue {
  profile: Profile;
  update: (change: (draft: Profile) => Profile) => void;
  saveState: SaveState;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);
const SAVE_DELAY_MS = 500;

interface ProviderProps {
  userId: string;
  name: string;
  /** Rendered while the stored profile loads. */
  fallback: ReactNode;
  children: ReactNode;
}

export function ProfileProvider({ userId, name, fallback, children }: ProviderProps) {
  const [initial, setInitial] = useState<Profile | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const [first = "", ...rest] = name.trim().split(/\s+/);
    const defaults = emptyProfile(first, rest.join(" "));
    (async () => {
      const store = await getStore();
      // A failed read retries, and never falls back to a blank profile: auto-save would then
      // overwrite the student's saved one. Only a successful read that finds no row is a new student.
      let stored: Profile | null = null;
      for (let tries = 0; ; tries++) {
        try {
          stored = await store.profiles.get(userId);
          break;
        } catch (error) {
          if (cancelled) return;
          if (tries >= 2) {
            console.error("[profile] Couldn't load the saved profile:", error);
            setLoadFailed(true);
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 800 * (tries + 1)));
        }
      }
      const profile = hydrate(stored, defaults);
      // First sign-in: create the row in Supabase so profile data is cloud-backed immediately.
      if (!stored) {
        const seeded = { ...profile, updatedAt: Date.now() };
        try {
          await store.profiles.save(userId, seeded);
          if (!cancelled) setInitial(seeded);
          return;
        } catch {
          // Still render locally; auto-save will retry on the next edit.
        }
      }
      if (!cancelled) setInitial(profile);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, name, attempt]);

  if (loadFailed) {
    return (
      <div className="profile-load-error" role="alert">
        <p>We couldn't load your profile. Check your connection and try again.</p>
        <button
          className="btn-primary"
          onClick={() => {
            setLoadFailed(false);
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!initial) return <>{fallback}</>;
  return (
    <LoadedProfileProvider userId={userId} initial={initial}>
      {children}
    </LoadedProfileProvider>
  );
}

function LoadedProfileProvider({ userId, initial, children }: { userId: string; initial: Profile; children: ReactNode }) {
  const [profile, setProfile] = useState(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const latest = useRef(profile);
  latest.current = profile;
  const savedAt = useRef(initial.updatedAt);

  const persist = useCallback(async () => {
    const snapshot = latest.current;
    if (snapshot.updatedAt === savedAt.current) return;
    try {
      await (await getStore()).profiles.save(userId, snapshot);
      savedAt.current = snapshot.updatedAt;
      if (latest.current.updatedAt === snapshot.updatedAt) setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [userId]);

  useEffect(() => {
    if (profile.updatedAt === savedAt.current) return;
    setSaveState("saving");
    const id = window.setTimeout(persist, SAVE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [profile, persist]);

  // Flush a pending debounced save if the tab closes mid-edit.
  useEffect(() => {
    window.addEventListener("pagehide", persist);
    return () => window.removeEventListener("pagehide", persist);
  }, [persist]);

  const update = useCallback((change: (draft: Profile) => Profile) => {
    // A change that changes nothing isn't saved: saving writes the whole profile, which could
    // overwrite newer work from another tab.
    setProfile((prev) => {
      const next = change(prev);
      return next === prev ? prev : { ...next, updatedAt: Date.now() };
    });
  }, []);

  const value = useMemo(() => ({ profile, update, saveState }), [profile, update, saveState]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const value = useContext(ProfileContext);
  if (!value) throw new Error("useProfile must be used inside <ProfileProvider>");
  return value;
}
