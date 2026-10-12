import { completeness, type SectionId } from "./profile";
import type { Profile } from "./types";

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  section: SectionId;
}

export function planningChecklist(p: Profile): ChecklistItem[] {
  const { sections } = completeness(p);
  const { preferences: f, academics: a } = p;
  const items: ChecklistItem[] = [
    { id: "basics", label: "Fill in your basic info", done: sections.basics === 1, section: "basics" },
    { id: "grades", label: "Add your GPA and coursework", done: sections.academics >= 0.75, section: "academics" },
    { id: "testing", label: "Decide on a testing plan", done: a.testPlan !== "" && a.testPlan !== "undecided", section: "academics" },
    { id: "majors", label: "Explore and list possible majors", done: p.goals.majors.length > 0, section: "goals" },
    { id: "activities", label: "Record at least 3 activities", done: p.activities.length >= 3, section: "activities" },
    { id: "list", label: "Build a list of 4+ colleges", done: p.colleges.length >= 4, section: "colleges" },
    {
      id: "plans",
      label: "Set an application type and deadline for each college",
      done: p.colleges.length > 0 && p.colleges.every((c) => c.plan && c.deadline),
      section: "colleges",
    },
    { id: "essays", label: "Finish your personal essays", done: f.essays === "done", section: "finances" },
    { id: "recs", label: "Line up recommendation letters", done: f.recommendations === "done", section: "finances" },
  ];
  if (f.needsAid !== "no") {
    items.push({ id: "fafsa", label: "Submit the FAFSA or CADAA", done: f.fafsa === "done", section: "finances" });
  }
  return items;
}
