import type { AgArea, CourseLevel, TranscriptCourse } from "./types";

export const AG_AREAS: { id: Exclude<AgArea, "none" | "unknown">; label: string; years: number }[] = [
  { id: "a", label: "History / social science", years: 2 },
  { id: "b", label: "English", years: 4 },
  { id: "c", label: "Mathematics", years: 3 },
  { id: "d", label: "Laboratory science", years: 2 },
  { id: "e", label: "Language other than English", years: 2 },
  { id: "f", label: "Visual & performing arts", years: 1 },
  { id: "g", label: "College-prep elective", years: 1 },
];

export const AREA_LABEL: Record<AgArea, string> = {
  ...(Object.fromEntries(AG_AREAS.map((a) => [a.id, a.label])) as Record<Exclude<AgArea, "none" | "unknown">, string>),
  none: "Not A–G",
  unknown: "Unknown — review later",
};

export const LEVEL_LABEL: Record<CourseLevel, string> = {
  regular: "Regular",
  honors: "Honors",
  ap: "AP",
  ib: "IB",
  "dual-enrollment": "College",
};

const BONUS_LEVELS: CourseLevel[] = ["honors", "ap", "ib", "dual-enrollment"];
const UC_HONORS_CAP = 8;
const UC_HONORS_CAP_10TH = 4;

/** Letter-grade points (plus/minus ignored, as UC and CSU do). Null for pass/fail or unrecognized grades. */
export function gradePoints(grade: string): number | null {
  const letter = grade.trim().toUpperCase()[0];
  return letter && "ABCDF".includes(letter) ? { A: 4, B: 3, C: 2, D: 1, F: 0 }[letter as "A"] : null;
}

const isPassing = (course: TranscriptCourse) => {
  const points = gradePoints(course.grade);
  return points === null ? /^p(ass)?$/i.test(course.grade.trim()) : points >= 2;
};

const semestersOf = (course: TranscriptCourse) => Math.max(1, Math.round(course.semesters || 1));

function average(entries: { points: number; weight: number }[]) {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  return total ? entries.reduce((sum, e) => sum + e.points * e.weight, 0) / total : null;
}

export interface GpaSummary {
  unweighted: number | null;
  weighted: number | null;
  ucCapped: number | null;
  advancedCourses: number;
  gradedSemesters: number;
}

export function computeGpa(courses: TranscriptCourse[]): GpaSummary {
  const graded = courses.flatMap((c) => {
    const points = gradePoints(c.grade);
    return points === null ? [] : [{ course: c, points, weight: semestersOf(c) }];
  });
  const bonus = (c: TranscriptCourse, points: number) => (BONUS_LEVELS.includes(c.level) && points >= 2 ? 1 : 0);

  // UC GPA: A–G courses from 10th and 11th grade, with honors points capped at
  // 8 semesters total and no more than 4 of them from 10th grade.
  const ucEntries: { points: number; weight: number }[] = [];
  let honorsUsed = 0;
  let honorsUsed10th = 0;
  const ucCourses = graded
    .filter(
      ({ course }) =>
        (course.gradeLevel === "10" || course.gradeLevel === "11") &&
        course.area !== "none" &&
        course.area !== "unknown" &&
        (course.status ?? "completed") !== "planned",
    )
    .sort((a, b) => a.course.gradeLevel.localeCompare(b.course.gradeLevel));
  for (const { course, points, weight } of ucCourses) {
    for (let s = 0; s < weight; s++) {
      let extra = bonus(course, points);
      if (extra && (honorsUsed >= UC_HONORS_CAP || (course.gradeLevel === "10" && honorsUsed10th >= UC_HONORS_CAP_10TH))) extra = 0;
      if (extra) {
        honorsUsed++;
        if (course.gradeLevel === "10") honorsUsed10th++;
      }
      ucEntries.push({ points: points + extra, weight: 1 });
    }
  }

  return {
    unweighted: average(graded.map(({ points, weight }) => ({ points, weight }))),
    weighted: average(graded.map(({ course, points, weight }) => ({ points: points + bonus(course, points), weight }))),
    ucCapped: average(ucEntries),
    advancedCourses: new Set(courses.filter((c) => c.level === "ap" || c.level === "ib" || c.level === "dual-enrollment").map((c) => c.name.toLowerCase())).size,
    gradedSemesters: graded.reduce((sum, g) => sum + g.weight, 0),
  };
}

export interface AreaProgress {
  id: Exclude<AgArea, "none" | "unknown">;
  label: string;
  required: number;
  completed: number;
}

/** Semesters completed per A–G area (C or better). Extra a–f semesters count toward the g elective, as UC allows. */
export function agProgress(courses: TranscriptCourse[]): AreaProgress[] {
  const done: Record<string, number> = {};
  for (const course of courses) {
    const area = course.area;
    if (area === "none" || area === "unknown") continue;
    if ((course.status ?? "completed") === "planned") continue;
    if (isPassing(course)) done[area] = (done[area] ?? 0) + semestersOf(course);
  }
  const overflow = AG_AREAS.filter((a) => a.id !== "g").reduce((sum, a) => sum + Math.max(0, (done[a.id] ?? 0) - a.years * 2), 0);
  return AG_AREAS.map((a) => ({
    id: a.id,
    label: a.label,
    required: a.years * 2,
    completed: (done[a.id] ?? 0) + (a.id === "g" ? overflow : 0),
  }));
}

export const formatGpa = (value: number | null) => (value === null ? "—" : value.toFixed(2));
