import { COLLEGE_NAMES } from "../colleges";
import type { ActivityCategory, PiqStatus, Profile, TargetCollege, UcJourneyState } from "../types";
import { hasAllDrafts, readyToGenerate } from "./piqs";

/**
 * UC Journey Map: six checkpoints whose progress is derived from the student's
 * saved profile. Only PIQ statuses, manual review ticks, activity-question
 * answers and the explicit submission record live in `profile.ucJourney`.
 */

export const PIQ_WORD_LIMIT = 350;
export const PIQ_REQUIRED = 4;
/** UC activity/award description limit, in characters. */
export const ACTIVITY_DESC_LIMIT = 350;
export const UC_APPLY_URL = "https://apply.universityofcalifornia.edu/";

export const PIQ_PROMPTS = [
  // Exact wording from UC Admissions (admission.universityofcalifornia.edu → Personal insight questions).
  { id: "leadership", title: "Leadership", prompt: "Describe an example of your leadership experience in which you have positively influenced others, helped resolve disputes or contributed to group efforts over time." },
  { id: "creativity", title: "Creativity", prompt: "Every person has a creative side, and it can be expressed in many ways: problem solving, original and innovative thinking, and artistically, to name a few. Describe how you express your creative side." },
  { id: "talent", title: "Talent or skill", prompt: "What would you say is your greatest talent or skill? How have you developed and demonstrated that talent over time?" },
  { id: "opportunity", title: "Educational opportunity", prompt: "Describe how you have taken advantage of a significant educational opportunity or worked to overcome an educational barrier you have faced." },
  { id: "challenge", title: "Significant challenge", prompt: "Describe the most significant challenge you have faced and the steps you have taken to overcome this challenge. How has this challenge affected your academic achievement?" },
  { id: "subject", title: "Academic subject", prompt: "Think about an academic subject that inspires you. Describe how you have furthered this interest inside and/or outside of the classroom." },
  { id: "community", title: "Community", prompt: "What have you done to make your school or your community a better place?" },
  { id: "standout", title: "What makes you stand out", prompt: "Beyond what has already been shared in your application, what do you believe makes you a strong candidate for admissions to the University of California?" },
] as const;

/**
 * Direct yes/no (or how-many) activity questions the story asks, in order.
 * A "yes" adds one entry to the activities list, then one optional details question.
 */
export const ACTIVITY_QUESTIONS: {
  id: string;
  name: string;
  category: ActivityCategory;
  question: string;
  /** Ask how many instead of a plain yes/no. */
  counted: boolean;
  details: string;
}[] = [
  { id: "sports", name: "Sports", category: "extracurricular", question: "do you play any sports — school teams, club teams, or anything competitive?", counted: true, details: "Which ones, what position or role, and about how many hours a week?" },
  { id: "music", name: "Band / music", category: "extracurricular", question: "are you in the band, orchestra, choir, or any other music group?", counted: false, details: "Which group, what instrument or part, and any section leader or solo roles?" },
  { id: "clubs", name: "Clubs", category: "extracurricular", question: "are you in any clubs, at school or outside it?", counted: true, details: "Which clubs, and do you hold any officer or leadership roles?" },
  { id: "volunteering", name: "Volunteering", category: "volunteering", question: "do you do any volunteering or community service?", counted: false, details: "Where do you volunteer, what do you do, and about how many hours a week?" },
  { id: "work", name: "Job / family responsibilities", category: "work", question: "do you have a job, or regular family responsibilities like caring for siblings or helping at a family business? UC counts these too.", counted: false, details: "What do you do, and about how many hours a week?" },
];

export function activitySurveyDone(j: UcJourneyState) {
  return ACTIVITY_QUESTIONS.every((q) => {
    const a = j.activitySurvey?.[q.id];
    return !!a && (a.count === 0 || a.details !== undefined);
  });
}

/** Activities step: questions answered (story or Profile page), and every description fits UC's limit. */
export function activitiesStatus(profile: Profile) {
  const j = journeyOf(profile);
  const acts = profile.activities;
  const answered =
    activitySurveyDone(j) ||
    !!j.activitiesReviewed ||
    // Lists finished on the Profile page (or before the question flow existed) count too.
    (acts.length > 0 && acts.every((a) => a.role.trim() && a.hoursPerWeek.trim() && a.description.trim()));
  const fits = acts.every((a) => a.description.length <= ACTIVITY_DESC_LIMIT);
  return { answered, fits, done: answered && fits };
}

export const REVIEW_MANUAL = [
  { id: "supplements", label: "Checked campus or major supplements", detail: "Some majors ask for extra steps (portfolios, auditions, supplemental questions). Check each campus's major page." },
  { id: "fees", label: "Planned application fees or a fee waiver", detail: "UC charges a fee per campus; eligible students can get a fee waiver for up to four campuses inside the application." },
] as const;

export const FOLLOW_UPS = [
  { id: "portals", label: "Watch your email and set up each campus portal" },
  { id: "aid", label: "Submit the FAFSA or California Dream Act Application" },
  { id: "grades", label: "Keep grades up and report any changes to UC" },
  { id: "decisions", label: "Track admission decisions and reply by the deadline" },
] as const;

export function emptyJourney(): UcJourneyState {
  return { piqs: {}, checks: {}, submittedAt: null, followUps: {} };
}

export function journeyOf(profile: Profile): UcJourneyState {
  const j = profile.ucJourney;
  return { ...emptyJourney(), ...j, piqs: { ...j?.piqs }, checks: { ...j?.checks }, followUps: { ...j?.followUps }, activitySurvey: { ...j?.activitySurvey } };
}

export function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export const isUc = (c: TargetCollege) => COLLEGE_NAMES.some((n) => n.toLowerCase() === c.name.toLowerCase());

export interface Task {
  id: string;
  label: string;
  done: boolean;
  detail?: string;
  /** Optional, so it doesn't count toward completion. */
  optional?: boolean;
}

export type CheckpointId = "profile" | "ucs" | "activities" | "essays" | "review" | "aid";

/** Checkpoints after Review & Apply (see storyComplete). */
export const AFTER_APPLY: CheckpointId[] = ["review", "aid"];

export interface Checkpoint {
  id: CheckpointId;
  title: string;
  short: string;
  tasks: Task[];
  done: number;
  total: number;
  complete: boolean;
  summary: string;
}

/**
 * `sections` is profile.completeness(p).sections.
 * `academicStarted` is honest academic-history prep (upload alone ≠ complete).
 */
export function computeJourney(profile: Profile, sections: Record<string, number>, academicStarted = false) {
  const j = journeyOf(profile);
  const ucs = profile.colleges.filter(isUc);
  const acts = profile.activities;
  const activities = activitiesStatus(profile);
  const chosen = Object.entries(j.piqs).slice(0, PIQ_REQUIRED);
  const ready = chosen.filter(([, s]) => s === "ready").length;
  const academicsReady = academicStarted || sections.academics >= 1;

  const raw: Omit<Checkpoint, "done" | "total" | "complete" | "summary">[] = [
    {
      id: "profile",
      title: "Basic Info",
      short: "Basic info",
      tasks: [
        { id: "basics", label: "Student information", done: sections.basics >= 1, detail: "Name, grade, graduation year, school, and state." },
        {
          id: "academics",
          label: "Start academic history",
          done: academicsReady,
          detail: "Add courses and/or a reported GPA. An uploaded file alone does not finish this step.",
        },
      ],
    },
    {
      id: "ucs",
      title: "Choose UCs",
      short: "Campuses",
      tasks: [
        { id: "campus", label: "Save at least one UC campus", done: ucs.length > 0, detail: `${ucs.length} of 9 campuses saved` },
        {
          id: "majors",
          label: "Choose your intended major",
          done: !!profile.goals.intendedMajor,
          detail: profile.goals.intendedMajor ? `${profile.goals.intendedMajor} at every campus` : "One major for all your UC campuses",
        },
      ],
    },
    {
      id: "activities",
      title: "Work on Activities List",
      short: "Activities",
      tasks: [
        {
          id: "add",
          label: "Answer the activity questions",
          done: activities.answered,
          detail: `${acts.length} of up to 20 entries · no quota required`,
        },
        {
          id: "limit",
          label: "Descriptions fit UC's limit",
          done: activities.fits,
          detail: `UC allows ${ACTIVITY_DESC_LIMIT} characters per activity.`,
        },
        {
          id: "basics",
          label: "Role and time for every listed activity",
          done: acts.length > 0 && acts.every((a) => a.role.trim() && a.hoursPerWeek.trim()),
          detail: "Hours/week and weeks/year where the category asks for them.",
          optional: true,
        },
        {
          id: "impact",
          label: "Describe responsibilities and impact",
          done: acts.length > 0 && acts.every((a) => a.description.trim()),
          detail: "What you did, what you contributed, and what changed.",
          optional: true,
        },
        {
          id: "awards",
          label: "Add honors and awards",
          done: profile.awards.length > 0 || acts.some((a) => a.category === "award"),
          optional: true,
        },
      ],
    },
    {
      id: "essays",
      title: "Four Essays",
      short: "PIQs",
      tasks: [
        { id: "choose", label: "Choose four Personal Insight Questions", done: chosen.length >= PIQ_REQUIRED, detail: `${chosen.length} of 4 chosen` },
        { id: "details", label: "Share personal details Quill can't find in your activities", done: readyToGenerate(profile), detail: "Only for questions about your personal life.", optional: true },
        { id: "drafts", label: "Generate your four drafts", done: hasAllDrafts(profile), detail: "Written automatically once your activities are done · Profile → Essays.", optional: true },
        { id: "ready", label: "Get all four responses ready", done: chosen.length >= PIQ_REQUIRED && ready >= PIQ_REQUIRED, detail: `${ready} of 4 ready · ${PIQ_WORD_LIMIT} words max each` },
      ],
    },
  ];

  const prior = raw.map((c) => c.tasks.filter((t) => !t.optional).every((t) => t.done));
  raw.push({
    id: "review",
    title: "Review & Apply",
    short: "Apply",
    tasks: [
      { id: "academics", label: "Academic history started", done: academicsReady },
      { id: "selections", label: "Campus and major selections", done: prior[1] },
      { id: "activities", label: "Activities list ready", done: prior[2] },
      { id: "piqs", label: "Four PIQs ready", done: prior[3] },
      ...REVIEW_MANUAL.map((m) => ({ id: m.id, label: m.label, detail: m.detail, done: !!j.checks[m.id] })),
      { id: "submitted", label: "Submitted on the official UC application", done: j.submittedAt !== null, detail: "Only you can record this." },
    ],
  });

  // Financial aid comes from the same answers as Profile → Cost & support.
  const f = profile.preferences;
  const noAidNeeded = f.needsAid === "no";
  raw.push({
    id: "aid",
    title: "Financial Aid",
    short: "Aid",
    tasks: [
      { id: "needs", label: "Tell us whether you'll need financial aid", done: f.needsAid !== "", detail: "“Not sure” is a fine answer." },
      {
        id: "fafsa",
        label: "Submit the FAFSA or California Dream Act Application",
        done: f.fafsa === "done",
        detail: "It's how UC and California decide grants and aid. File early — aid deadlines come in the spring.",
        // Students who won't use aid can still file, but it doesn't hold up this step.
        optional: noAidNeeded,
      },
      { id: "income", label: "Share your household income range", done: f.incomeRange !== "", detail: "“Prefer not to say” is fine.", optional: true },
      { id: "budget", label: "Set a yearly budget you can plan for", done: f.maxAnnualCost.trim() !== "", optional: true },
    ],
  });

  const checkpoints: Checkpoint[] = raw.map((c) => {
    const counted = c.tasks.filter((t) => !t.optional);
    const done = counted.filter((t) => t.done).length;
    // Review & Apply finishes only when the student records submission — never from the checklist alone.
    const complete = c.id === "review" ? j.submittedAt !== null : done === counted.length;
    const summary = c.id === "essays" ? `${ready} of 4 ready` : `${done} of ${counted.length} tasks`;
    return { ...c, done, total: counted.length, complete, summary };
  });

  const completeCount = checkpoints.filter((c) => c.complete).length;
  const firstOpen = checkpoints.findIndex((c) => !c.complete);
  return { checkpoints, completeCount, current: firstOpen === -1 ? checkpoints.length - 1 : firstOpen, finished: firstOpen === -1 };
}

/** Adds/removes a PIQ choice; refuses a fifth. */
export function togglePiq(j: UcJourneyState, id: string): UcJourneyState {
  const piqs = { ...j.piqs };
  if (id in piqs) delete piqs[id];
  else if (Object.keys(piqs).length < PIQ_REQUIRED) piqs[id] = "not-started";
  return { ...j, piqs };
}

export function setPiqStatus(j: UcJourneyState, id: string, status: PiqStatus): UcJourneyState {
  return id in j.piqs ? { ...j, piqs: { ...j.piqs, [id]: status } } : j;
}

export function toggleCampus(profile: Profile, name: string, id: () => string): Profile {
  const key = name.toLowerCase();
  const on = profile.colleges.some((c) => c.name.toLowerCase() === key);
  return {
    ...profile,
    colleges: on
      ? profile.colleges.filter((c) => c.name.toLowerCase() !== key)
      : [...profile.colleges, { id: id(), name, status: "researching", plan: "UC", deadline: "", notes: "", major: "" }],
  };
}


