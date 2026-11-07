import { virtualCounselorDone } from "../agent/callState";
import { COLLEGE_NAMES } from "../colleges";
import type { ActivityCategory, ActivitySectionId, ActivitySectionState, AgentState, PiqStatus, Profile, TargetCollege, UcJourneyState } from "../types";
import { chosenPiqs, essayDone, essaysDoneCount } from "./piqs";

/**
 * UC Journey Map: six checkpoints whose progress is derived from the student's
 * saved profile. Only PIQ statuses, manual review ticks, activity-question
 * answers and the UC agent milestones live in `profile.ucJourney`.
 */

/** True once Track2College has a saved UC login that UC accepted (verified or signed in). */
export function ucAccountReady(uc: AgentState["ucAccount"] | undefined): boolean {
  return !!(uc?.email && uc.password && (uc.verifiedAt || uc.signedInAt));
}

export const PIQ_WORD_LIMIT = 350;
export const PIQ_REQUIRED = 4;
/** UC activity/award description limit, in characters. */
export const ACTIVITY_DESC_LIMIT = 350;
export const UC_APPLY_URL = "https://apply.universityofcalifornia.edu/";

/** One plain sentence on what each PIQ is really about, for Quill's opening line. */
export const PIQ_ONE_LINERS: Record<string, string> = {
  leadership: "It's about a time you made things better for a group, with or without a title.",
  creativity: "It's about how you solve problems or make things in your own way.",
  talent: "It's about something you're really good at and how you built it.",
  opportunity: "It's about a chance you made the most of, or a school barrier you worked around.",
  challenge: "It's about the hardest thing you've faced and what you did about it.",
  subject: "It's about a subject you love and how you've taken it beyond class.",
  community: "It's about what you've done to make your school or community better.",
  standout: "It's about what makes you different that the rest of your application doesn't show.",
};

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
 * The activity questions the story used to ask. Milo's chat replaced them; students who finished
 * them still count as done with this step.
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

/** Milo's chapter, in order. Each has the same format: how many, a chat with Milo, then Done. */
export const ACTIVITY_SECTIONS: { id: ActivitySectionId; category: ActivityCategory; question: string; turnId: string }[] = [
  { id: "activities", category: "extracurricular", question: "are there any activities you want to report (sports, clubs, band)?", turnId: "activity-count" },
  { id: "volunteering", category: "volunteering", question: "do you do any volunteering?", turnId: "volunteering-count" },
  { id: "job", category: "work", question: "do you have a job?", turnId: "job-count" },
  { id: "awards", category: "award", question: "do you have any honors or awards to report?", turnId: "awards-count" },
];

const SECTION_LABEL: Record<ActivitySectionId, string> = {
  activities: "Activities",
  volunteering: "Volunteering",
  job: "Jobs",
  awards: "Honors and awards",
};

export function activitySection(j: UcJourneyState, id: ActivitySectionId): ActivitySectionState {
  return id === "activities" ? { count: j.activityCount, notes: j.activityNotes } : (j.activitySections?.[id] ?? {});
}

/** Replaces one question's number and saved chat. */
export function withActivitySection(j: UcJourneyState, id: ActivitySectionId, state: ActivitySectionState): UcJourneyState {
  if (id !== "activities") return { ...j, activitySections: { ...j.activitySections, [id]: state } };
  const { activityCount: _count, activityNotes: _notes, ...rest } = j;
  return {
    ...rest,
    ...(state.count !== undefined ? { activityCount: state.count } : {}),
    ...(state.notes !== undefined ? { activityNotes: state.notes } : {}),
  };
}

/** Answered with 0, or the student hit Done on Milo's chat. */
export function activitySectionDone(j: UcJourneyState, id: ActivitySectionId): boolean {
  const { count, notes } = activitySection(j, id);
  return count === 0 || notes !== undefined;
}

/** How many this student already has in this section of their list. */
export function activitySectionEntries(profile: Profile, id: ActivitySectionId): number {
  const category = ACTIVITY_SECTIONS.find((s) => s.id === id)!.category;
  const listed = profile.activities.filter((a) => a.category === category).length;
  return id === "awards" ? listed + profile.awards.length : listed;
}

/** Answered with Milo, or already on the student's list, so there's nothing to ask. */
export function activitySectionAnswered(profile: Profile, id: ActivitySectionId): boolean {
  return activitySectionDone(journeyOf(profile), id) || activitySectionEntries(profile, id) > 0;
}

/** Restarting Milo's chat clears the number for the question in progress. Finished questions stay. */
export function clearOpenActivityAnswer(profile: Profile): Profile {
  const j = journeyOf(profile);
  const open = ACTIVITY_SECTIONS.find((s) => !activitySectionAnswered(profile, s.id));
  return open && activitySection(j, open.id).count !== undefined ? { ...profile, ucJourney: withActivitySection(j, open.id, {}) } : profile;
}

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
    ACTIVITY_SECTIONS.every((s) => activitySectionAnswered(profile, s.id)) ||
    activitySurveyDone(j) ||
    !!j.activitiesReviewed ||
    // Lists finished on the Profile page (or before the question flow existed) count too.
    (acts.length > 0 && acts.every((a) => a.role.trim() && a.hoursPerWeek.trim() && a.description.trim()));
  const fits = acts.every((a) => a.description.length <= ACTIVITY_DESC_LIMIT);
  return { answered, fits, done: answered && fits };
}

/** Starts the activities step over: everything told to Milo and the whole list and awards go. */
export function resetActivitiesStep(profile: Profile): Profile {
  const { activityCount: _count, activityNotes: _notes, activitySections: _sections, activitySurvey: _survey, activitiesReviewed: _reviewed, ...rest } = journeyOf(profile);
  return { ...profile, activities: [], awards: [], ucJourney: rest };
}

export const REVIEW_MANUAL = [
  { id: "supplements", label: "Checked campus or major supplements", detail: "Some majors ask for extra steps (portfolios, auditions, supplemental questions). Check each campus's major page." },
  { id: "fees", label: "Planned application fees or a fee waiver", detail: "UC charges a fee per campus; eligible students can get a fee waiver for up to four campuses inside the application." },
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
  const activities = activitiesStatus(profile);
  const chosen = Object.entries(j.piqs).slice(0, PIQ_REQUIRED);
  const written = essaysDoneCount(profile);
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
          label: "Add your GPA or courses",
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
        { id: "campus", label: "Pick your UC campuses", done: ucs.length > 0, detail: `${ucs.length} of 9 campuses saved` },
        {
          id: "majors",
          label: "Choose your major",
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
        // One line per question with its answer. Students who finished another way (the old questions,
        // or the Profile page) still get every check.
        ...ACTIVITY_SECTIONS.map((s) => {
          const entries = activitySectionEntries(profile, s.id);
          const count = activitySection(j, s.id).count ?? (entries || undefined);
          const answer = count === undefined ? "" : `: ${count >= 3 ? "3+" : count}`;
          return { id: s.id, label: `${SECTION_LABEL[s.id]}${answer}`, done: activities.answered || activitySectionAnswered(profile, s.id) };
        }),
        ...(activities.fits ? [] : [{ id: "limit", label: `Shorten descriptions to ${ACTIVITY_DESC_LIMIT} characters`, done: false }]),
      ],
    },
    {
      id: "essays",
      title: "Four Essays",
      short: "PIQs",
      tasks: [
        { id: "choose", label: "Choose four essay topics", done: chosen.length >= PIQ_REQUIRED, detail: `${chosen.length} of 4 chosen` },
        // One line per essay, in order.
        ...Array.from({ length: PIQ_REQUIRED }, (_, i) => {
          const id = chosenPiqs(profile)[i];
          const title = PIQ_PROMPTS.find((q) => q.id === id)?.title;
          const done = !!id && essayDone(profile, id);
          return { id: `essay-${i + 1}`, label: `Essay ${i + 1}${title ? ` (${title})` : ""}: ${done ? "Done" : "Not done"}`, done };
        }),
      ],
    },
  ];

  raw.push({
    id: "review",
    title: "Review & Apply",
    short: "Apply",
    tasks: [
      {
        id: "virtualCounselor",
        label: "Met with the virtual counselor",
        done: virtualCounselorDone(j.agent?.counselorCall),
      },
      {
        id: "emailCounselor",
        label: "Emailed your counselor",
        done: !!j.agent?.counselorEmail?.sentAt,
      },
      // Saved login that UC accepted (verified code or a successful sign-in).
      { id: "account", label: "Created your UC account", done: !!ucAccountReady(j.agent?.ucAccount) },
      // Agent finished Personal insight (committed when the student closes the tool), or they marked submission by hand.
      { id: "submitted", label: "Applied to the UCs", done: !!j.agent?.ucAccount?.piqAt || j.submittedAt !== null },
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
    const complete = done === counted.length;
    const summary = c.id === "essays" ? `${written} of 4 done` : `${done} of ${counted.length} tasks`;
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


