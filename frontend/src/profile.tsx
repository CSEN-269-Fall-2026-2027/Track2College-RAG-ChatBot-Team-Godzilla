import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getStore } from "./data";
import type { Profile, TargetCollege } from "./types";

export function emptyProfile(firstName = "", lastName = ""): Profile {
  return {
    basics: { firstName, lastName, gradeLevel: "", graduationYear: "", highSchool: "", city: "", state: "", firstGen: "" },
    academics: {
      gpaUnweighted: "",
      gpaWeighted: "",
      classRank: "",
      apIbCourses: "",
      sat: "",
      act: "",
      testPlan: "",
      coursework: "",
    },
    goals: { majors: [], careers: "", whyCollege: "" },
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
    updatedAt: 0,
  };
}

/** Merge stored data over defaults so profiles saved by older versions gain new fields. */
function hydrate(stored: Partial<Profile> | null, fallback: Profile): Profile {
  if (!stored) return fallback;
  return {
    ...fallback,
    ...stored,
    basics: { ...fallback.basics, ...stored.basics },
    academics: { ...fallback.academics, ...stored.academics },
    goals: { ...fallback.goals, ...stored.goals },
    preferences: { ...fallback.preferences, ...stored.preferences },
    checklistDone: { ...fallback.checklistDone, ...stored.checklistDone },
  };
}

// ---------------------------------------------------------------------------
// Completeness
// ---------------------------------------------------------------------------

export const PROFILE_SECTIONS = [
  { id: "basics", title: "About you", blurb: "Grade, school, and location" },
  { id: "academics", title: "Academics", blurb: "GPA, coursework, and testing" },
  { id: "transcript", title: "Transcript", blurb: "Upload and review your courses" },
  { id: "goals", title: "Interests & goals", blurb: "Majors and what you want from college" },
  { id: "activities", title: "Activities & awards", blurb: "What you do outside class" },
  { id: "colleges", title: "College list", blurb: "Schools, plans, and deadlines" },
  { id: "finances", title: "Cost & preferences", blurb: "Budget, aid, and campus fit" },
] as const;

export type SectionId = (typeof PROFILE_SECTIONS)[number]["id"];

const filled = (value: string) => value.trim().length > 0;

export function sectionChecks(p: Profile): Partial<Record<SectionId, boolean[]>> {
  const { basics: b, academics: a, goals: g, preferences: f } = p;
  return {
    basics: [filled(b.firstName), b.gradeLevel !== "", filled(b.graduationYear), filled(b.highSchool), filled(b.state)],
    academics: [
      filled(a.gpaUnweighted) || filled(a.gpaWeighted),
      a.testPlan !== "",
      filled(a.sat) || filled(a.act) || a.testPlan === "test-optional",
      filled(a.apIbCourses) || filled(a.coursework),
    ],
    goals: [g.majors.length > 0, filled(g.careers), filled(g.whyCollege)],
    activities: [p.activities.length >= 1, p.activities.length >= 3, p.awards.length >= 1],
    colleges: [
      p.colleges.length >= 1,
      p.colleges.length >= 4,
      p.colleges.length > 0 && p.colleges.every((c) => c.plan !== "" && filled(c.deadline)),
    ],
    finances: [f.needsAid !== "", filled(f.maxAnnualCost), f.fafsa !== "", f.campusSize !== "" || f.setting !== ""],
  };
}

export function completeness(p: Profile) {
  const checks = sectionChecks(p);
  const sections = Object.fromEntries(
    PROFILE_SECTIONS.map(({ id }) => {
      const list = checks[id];
      return [id, list && list.length ? list.filter(Boolean).length / list.length : 0];
    }),
  ) as Record<SectionId, number>;
  const all = Object.values(checks).flat();
  return { overall: all.length ? all.filter(Boolean).length / all.length : 0, sections };
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
 * Compact, plain-text profile for the LLM. Only filled fields are included so
 * the prompt stays short; the backend treats it as personalization, not facts.
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
  add("First-generation college student", b.firstGen === "yes" ? "yes" : b.firstGen === "no" ? "no" : "");
  add("Unweighted GPA", a.gpaUnweighted);
  add("Weighted GPA", a.gpaWeighted);
  add("Class rank", a.classRank);
  add("AP/IB/honors courses", a.apIbCourses);
  add("SAT", a.sat);
  add("ACT", a.act);
  add("Testing plan", a.testPlan.replace("-", " "));
  add("Notable coursework", a.coursework);
  add("Intended majors", g.majors.join(", "));
  add("Career interests", g.careers);
  add("What they want from college", g.whyCollege);
  if (p.activities.length) {
    lines.push(
      "Activities: " +
        p.activities
          .map((x) => [x.name, x.role && `(${x.role})`, x.hoursPerWeek && `${x.hoursPerWeek} hrs/wk`].filter(Boolean).join(" "))
          .join("; "),
    );
  }
  if (p.awards.length) {
    lines.push("Awards: " + p.awards.map((x) => (x.level ? `${x.title} (${x.level})` : x.title)).join("; "));
  }
  if (p.colleges.length) {
    lines.push(
      "College list: " +
        p.colleges
          .map((c) => [c.name, c.plan && `[${c.plan}]`, c.deadline && `due ${c.deadline}`, `status ${c.status}`].filter(Boolean).join(" "))
          .join("; "),
    );
  }
  add("Preferred regions", f.regions);
  add("Campus size", f.campusSize);
  add("Campus setting", f.setting);
  add("Max annual cost (USD)", f.maxAnnualCost);
  add("Needs financial aid", f.needsAid);
  add("Household income range", f.incomeRange && f.incomeRange !== "prefer-not" ? f.incomeRange : "");
  add("FAFSA/CADAA status", f.fafsa.replace("-", " "));
  add("Essays status", f.essays.replace("-", " "));
  add("Recommendation letters status", f.recommendations.replace("-", " "));
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

  useEffect(() => {
    let cancelled = false;
    const [first = "", ...rest] = name.trim().split(/\s+/);
    const defaults = emptyProfile(first, rest.join(" "));
    (async () => {
      const store = await getStore();
      let stored: Profile | null = null;
      try {
        stored = await store.profiles.get(userId);
      } catch {
        stored = null;
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
  }, [userId, name]);

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
    setProfile((prev) => ({ ...change(prev), updatedAt: Date.now() }));
  }, []);

  const value = useMemo(() => ({ profile, update, saveState }), [profile, update, saveState]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const value = useContext(ProfileContext);
  if (!value) throw new Error("useProfile must be used inside <ProfileProvider>");
  return value;
}
