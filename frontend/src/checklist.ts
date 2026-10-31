import type { SectionId } from "./profile";
import type { GradeLevel, Profile } from "./types";

export type ChecklistGrade = "9" | "10" | "11" | "12" | "gap" | "transfer";
export type ChecklistPhase = "building" | "applying" | "submitted" | "decisions";

export interface ChecklistVideo {
  title: string;
  url: string;
  channel: string;
}

export interface ChecklistDetail {
  kind: "counselor" | "videos" | "tips";
  title: string;
  body?: string[];
  videos?: ChecklistVideo[];
}

export interface ChecklistDef {
  id: string;
  label: string;
  grades: ChecklistGrade[];
  phase: ChecklistPhase;
  section?: SectionId;
  /** Auto-complete from profile when possible; manual toggle still wins if set. */
  autoDone?: (p: Profile) => boolean;
  detail?: ChecklistDetail;
}

const COMMON_APP_VIDEOS: ChecklistVideo[] = [
  {
    title: "How to Write a Personal Statement",
    url: "https://www.youtube.com/watch?v=KkRFXQ6Nq0s",
    channel: "College Essay Guy",
  },
  {
    title: "Brainstorming Your College Essay",
    url: "https://www.youtube.com/watch?v=HhCZEX3v5jE",
    channel: "College Essay Guy",
  },
  {
    title: "UC Personal Insight Questions Explained",
    url: "https://www.youtube.com/watch?v=8Q8qK2nG8nA",
    channel: "UC Admissions",
  },
];

const COUNSELOR_BRING = [
  "Unofficial transcript or list of courses you've taken and plan to take",
  "Current GPA (weighted and unweighted) and test scores if you have them",
  "A draft college list (reach / target / likely) — even if it's rough",
  "Questions about A–G, dual enrollment, or summer programs",
  "Any scholarship or first-gen program deadlines you've seen",
  "Notes on intended majors and what you want from a campus",
];

const COUNSELOR_NOTES = [
  "Ask which courses your school offers that strengthen your target colleges",
  "Confirm recommendation letter process and deadlines at your school",
  "Ask how to request fee waivers for applications and SAT/ACT if needed",
  "Share family college history (first-gen) so they can point you to support",
  "Ask about Naviance / Scoir / school-specific application tools",
];

/** Full college-planning checklist. Same plan for everyone; grade filter highlights what's timely. */
export const CHECKLIST_DEFS: ChecklistDef[] = [
  {
    id: "meet-counselor",
    label: "Meet with your high school counselor",
    grades: ["9", "10", "11", "12", "gap", "transfer"],
    phase: "building",
    detail: {
      kind: "counselor",
      title: "Counselor meeting prep",
      body: [
        "What to bring:",
        ...COUNSELOR_BRING.map((s) => `• ${s}`),
        "",
        "Notes / questions for your counselor:",
        ...COUNSELOR_NOTES.map((s) => `• ${s}`),
      ],
    },
  },
  {
    id: "basics",
    label: "Fill in your basic profile info",
    grades: ["9", "10", "11", "12", "gap", "transfer"],
    phase: "building",
    section: "basics",
    autoDone: (p) => !!(p.basics.firstName && p.basics.gradeLevel && p.basics.highSchool),
  },
  {
    id: "ag-plan",
    label: "Map A–G / graduation requirements with your counselor",
    grades: ["9", "10"],
    phase: "building",
    section: "academics",
    detail: {
      kind: "tips",
      title: "Why this matters",
      body: [
        "UC campuses require A–G coursework. Get on track early so you don't scramble junior year.",
        "Ask which classes count for each letter and whether summer or dual enrollment can fill gaps.",
      ],
    },
  },
  {
    id: "rigor",
    label: "Plan honors / AP / IB / dual enrollment for next year",
    grades: ["9", "10", "11"],
    phase: "building",
    section: "academics",
    autoDone: (p) => p.academics.exams.trim().length > 0 || p.activities.some((a) => a.category === "other-coursework"),
  },
  {
    id: "activities-start",
    label: "Join 1–2 activities you can stick with",
    grades: ["9", "10"],
    phase: "building",
    autoDone: (p) => p.activities.length >= 1,
  },
  {
    id: "psat",
    label: "Optional practice tests (not used by UC admissions)",
    grades: ["10", "11"],
    phase: "building",
    section: "academics",
    detail: {
      kind: "tips",
      title: "Testing note",
      body: [
        "UC campuses do not use SAT or ACT scores in admissions decisions.",
        "Practice tests are optional and only matter if you apply elsewhere that considers them.",
      ],
    },
  },
  {
    id: "majors",
    label: "Explore possible majors",
    grades: ["9", "10", "11", "12", "gap", "transfer"],
    phase: "building",
    section: "campuses",
    autoDone: (p) => p.goals.majors.length > 0 || p.colleges.some((c) => !!c.major?.trim()),
  },
  {
    id: "summer",
    label: "Plan a meaningful summer (job, program, project, or research)",
    grades: ["10", "11"],
    phase: "building",
    detail: {
      kind: "tips",
      title: "Summer ideas",
      body: [
        "Paid work, family responsibilities, self-directed projects, and community college classes all count.",
        "Depth over prestige — colleges care that you grew, not that you bought a fancy program.",
      ],
    },
  },
  {
    id: "campus-research",
    label: "Research UC campuses (virtual tour, visit, or info session)",
    grades: ["10", "11", "12", "gap", "transfer"],
    phase: "building",
  },
  {
    id: "activities-depth",
    label: "Record activities with roles, hours, and impact",
    grades: ["11", "12", "gap", "transfer"],
    phase: "applying",
    autoDone: (p) => p.activities.length > 0 && p.activities.every((a) => a.role.trim() && a.hoursPerWeek.trim() && a.description.trim()),
  },
  {
    id: "essays",
    label: "Write personal essays / UC PIQs",
    grades: ["11", "12", "gap", "transfer"],
    phase: "applying",
    autoDone: (p) => Object.values(p.ucJourney?.piqs ?? {}).filter((s) => s === "ready").length >= 4,
    detail: {
      kind: "videos",
      title: "Videos on writing essays",
      videos: COMMON_APP_VIDEOS,
      body: [
        "Start with stories only you can tell. Specific beats impressive.",
        "Use Profile → Essays and the Journey Map Four Essays checkpoint.",
      ],
    },
  },
  {
    id: "recs",
    label: "Ask for recommendation letters only if a campus or program specifically needs them",
    grades: ["11", "12", "gap", "transfer"],
    phase: "applying",
    detail: {
      kind: "tips",
      title: "Recommendation tips",
      body: [
        "UC campuses do not use teacher letters for freshman admission.",
        "Only request letters when a campus supplemental or another school asks for them.",
      ],
    },
  },
  {
    id: "apps-open",
    label: "Start your UC application",
    grades: ["12", "gap", "transfer"],
    phase: "applying",
  },
  {
    id: "fafsa",
    label: "Submit the FAFSA or CADAA",
    grades: ["12", "gap", "transfer"],
    phase: "applying",
    section: "finances",
    autoDone: (p) => p.preferences.fafsa === "done" || p.preferences.needsAid === "no",
    detail: {
      kind: "tips",
      title: "Financial aid",
      body: [
        "FAFSA opens in the fall of senior year (dates shift — confirm the current cycle).",
        "California Dream Act (CADAA) is for undocumented students who meet AB 540 criteria.",
        "Also check CSS Profile if any private colleges require it.",
      ],
    },
  },
  {
    id: "scholarships",
    label: "Apply to scholarships (school, local, and national)",
    grades: ["11", "12", "gap", "transfer"],
    phase: "applying",
    detail: {
      kind: "tips",
      title: "Where to look",
      body: [
        "Start with your high school counseling office and local community foundations.",
        "Many deadlines fall between December and March — put them on a calendar.",
      ],
    },
  },
  {
    id: "transcripts-send",
    label: "Send official transcripts / self-report grades as required",
    grades: ["12", "gap", "transfer"],
    phase: "submitted",
    section: "academics",
    detail: {
      kind: "tips",
      title: "Transcripts",
      body: [
        "UC uses self-reported coursework; official transcripts come after admission.",
        "Keep your Academic History courses accurate before you submit.",
      ],
    },
  },
  {
    id: "commit",
    label: "Compare aid offers and commit by May 1 (or your school's date)",
    grades: ["12", "gap", "transfer"],
    phase: "decisions",
    detail: {
      kind: "tips",
      title: "Choosing where to go",
      body: [
        "Compare net price, not sticker price. Ask each school about appeals if needed.",
        "Housing deposits and orientation deadlines often follow right after commitment.",
      ],
    },
  },
];

export interface ChecklistItem extends ChecklistDef {
  done: boolean;
  relevant: boolean;
}

export function normalizeGrade(grade: GradeLevel): ChecklistGrade | "" {
  if (grade === "9" || grade === "10" || grade === "11" || grade === "12" || grade === "gap" || grade === "transfer") {
    return grade;
  }
  return "";
}

export function isItemDone(def: ChecklistDef, p: Profile): boolean {
  if (p.checklistDone[def.id] === true) return true;
  if (p.checklistDone[def.id] === false) return false;
  return def.autoDone?.(p) ?? false;
}

export function planningChecklist(p: Profile, gradeFilter: ChecklistGrade | "all" = "all"): ChecklistItem[] {
  const grade = normalizeGrade(p.basics.gradeLevel);
  return CHECKLIST_DEFS.filter((def) => gradeFilter === "all" || def.grades.includes(gradeFilter)).map((def) => ({
    ...def,
    done: isItemDone(def, p),
    relevant: !grade || def.grades.includes(grade),
  }));
}

/** Short “next steps” list for Overview — incomplete items for the student's grade (or all if unknown). */
export function nextSteps(p: Profile, limit = 4): ChecklistItem[] {
  const grade = normalizeGrade(p.basics.gradeLevel);
  const items = planningChecklist(p, grade || "all").filter((i) => !i.done);
  const prioritized = grade ? items.filter((i) => i.relevant) : items;
  return (prioritized.length ? prioritized : items).slice(0, limit);
}
