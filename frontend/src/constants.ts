export { COLLEGE_NAMES as KNOWN_COLLEGES } from "./colleges";

/**
 * The intended-major choices: ten of the largest majors across the UC campuses (one pick covers
 * every campus the student applies to). Anything else is "Other". Edit this list to change the
 * choices everywhere: Profile → UC campuses, the journey map, story mode, and the chatbot.
 */
export const UC_MAJORS = [
  "Biology",
  "Computer Science",
  "Psychology",
  "Economics",
  "Business",
  "Engineering",
  "Political Science",
  "Sociology",
  "Communication",
  "Mathematics",
] as const;
export const OTHER_MAJOR = "Other";
export const MAJOR_CHOICES = [...UC_MAJORS, OTHER_MAJOR];

/** Keyword → choice, checked in order (so "Bioengineering" is Engineering and "Business Economics" is Business). */
const MAJOR_KEYWORDS: [RegExp, string][] = [
  [/engineer/i, "Engineering"],
  [/computer|software/i, "Computer Science"],
  [/business|management|accounting|finance/i, "Business"],
  [/econ/i, "Economics"],
  [/biolog|life science/i, "Biology"],
  [/psych/i, "Psychology"],
  [/politic|government/i, "Political Science"],
  [/sociolog/i, "Sociology"],
  [/communication/i, "Communication"],
  [/math/i, "Mathematics"],
];

/** Maps any typed or older saved major onto the choices: "" for undecided/blank, "Other" when nothing fits. */
export function toMajorChoice(raw: string | undefined | null): string {
  const value = (raw ?? "").trim();
  if (!value || /^(undecided|undeclared|exploring|not sure)/i.test(value)) return "";
  const exact = MAJOR_CHOICES.find((m) => m.toLowerCase() === value.toLowerCase());
  if (exact) return exact;
  return MAJOR_KEYWORDS.find(([re]) => re.test(value))?.[1] ?? OTHER_MAJOR;
}

export const MAJOR_SUGGESTIONS = [
  "Computer Science",
  "Biology",
  "Business",
  "Psychology",
  "Engineering",
  "Nursing",
  "Economics",
  "Undecided",
];
