export type Role = "user" | "assistant";
/** Character expression for Story mode; sent by the model or inferred on the client. */
export type Mood = "neutral" | "happy" | "thinking" | "concerned" | "excited";

export interface Message {
  id: string;
  role: Role;
  content: string;
  sources?: string[];
  followups?: string[];
  mood?: Mood;
  /** Story-mode mentor who answered (see game/characters.ts). */
  mentorId?: string;
  responseTimeMs?: number;
  error?: boolean;
  /** The full question sent to the model, when the chat shows a shorter one (`content`). */
  sentAs?: string;
  /** Milo's "add them in Profile" reply for this question: shows the button that goes there. */
  fillInProfile?: ActivitySectionId;
  /** Answers to tap when this reply asks a yes/no or pick-one question. The student can still type. */
  options?: string[];
  /** Quill's one question for this essay (PIQ id): the student's next message answers it. */
  essayFollowUp?: string;
  /** The essay (PIQ id) this message asks Quill to write, or holds once written. */
  essayFor?: string;
  /** Sent by a ready-made button (not typed): long ones show collapsed with "See more". */
  preset?: boolean;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  sessionId: string | null;
  /** Advisor this chat belongs to; each advisor keeps its own history. Missing on older chats (treated as Sage). */
  mentorId?: string;
  /** The guide's opening message when this chat started, kept at the top of the thread. */
  intro?: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface Account {
  id: string;
  name: string;
  email: string;
  createdAt: number;
}

export type GradeLevel = "" | "9" | "10" | "11" | "12" | "gap" | "transfer";
export type CollegeStatus = "researching" | "applying" | "submitted" | "accepted" | "waitlisted" | "denied";
/** Legacy application plans kept for stored JSON; UC-facing UI only uses "UC". */
export type ApplicationPlan = "" | "ED" | "EA" | "REA" | "RD" | "Rolling" | "UC" | "CSU";
export type ProgressStatus = "" | "not-started" | "in-progress" | "done";

/** UC Activities & Awards categories (first-year application). */
export type ActivityCategory =
  | ""
  | "award"
  | "educational-prep"
  | "extracurricular"
  | "other-coursework"
  | "volunteering"
  | "work";

/** The questions Milo's chapter asks, each with its own number and chat. */
export type ActivitySectionId = "activities" | "volunteering" | "job" | "awards";

export interface ActivitySectionState {
  /** How many the student wants to report (3 means 3 or more). */
  count?: number;
  /** Milo's questions and the student's answers, saved when they hit Done. */
  notes?: string;
}

export interface Activity {
  id: string;
  name: string;
  role: string;
  hoursPerWeek: string;
  /** Average weeks per year (UC activity detail). */
  weeksPerYear: string;
  years: string;
  description: string;
  category: ActivityCategory;
}

export interface Award {
  id: string;
  title: string;
  level: "" | "school" | "regional" | "state" | "national" | "international";
}

export interface TargetCollege {
  id: string;
  name: string;
  status: CollegeStatus;
  plan: ApplicationPlan;
  deadline: string;
  notes: string;
  /** Intended major at this campus (UC Journey Map → Choose UCs). */
  major?: string;
}

export interface Profile {
  basics: {
    firstName: string;
    lastName: string;
    gradeLevel: GradeLevel;
    graduationYear: string;
    highSchool: string;
    city: string;
    state: string;
    firstGen: "" | "yes" | "no";
  };
  academics: {
    /** School-reported unweighted GPA (optional; distinct from any calculated estimate). */
    gpaUnweighted: string;
    /** School-reported weighted GPA (optional). */
    gpaWeighted: string;
    /** Optional AP/IB/English-proficiency exam notes — separate from coursework. */
    exams: string;
    /** @deprecated Kept for stored profiles; not shown in UC-first UI. */
    classRank: string;
    /** @deprecated Prefer structured transcript courses. */
    apIbCourses: string;
    /** @deprecated UC does not use SAT/ACT in admissions decisions. */
    sat: string;
    /** @deprecated UC does not use SAT/ACT in admissions decisions. */
    act: string;
    /** @deprecated */
    testPlan: "" | "submitting" | "test-optional" | "undecided";
    /** @deprecated Prefer structured transcript courses. */
    coursework: string;
  };
  goals: {
    /** General major interests for advising (from onboarding). */
    majors: string[];
    /**
     * The one major the student applies for at every UC campus: one of UC_MAJORS, "Other", or ""
     * (not chosen yet). Replaces the old per-campus colleges[].major.
     */
    intendedMajor: string;
    /** @deprecated Not required for UC prep; preserved if previously saved. */
    careers: string;
    /** @deprecated Not required for UC prep; preserved if previously saved. */
    whyCollege: string;
  };
  activities: Activity[];
  awards: Award[];
  colleges: TargetCollege[];
  preferences: {
    /** Student's optional annual budget — not a university's net cost. */
    maxAnnualCost: string;
    needsAid: "" | "yes" | "no" | "unsure";
    incomeRange: "" | "under-30k" | "30-60k" | "60-110k" | "110-175k" | "over-175k" | "prefer-not";
    /** FAFSA or California Dream Act Application progress (journey/checklist context). */
    fafsa: ProgressStatus;
    /** @deprecated Prefer regions not collected in UC-first Profile UI. */
    regions: string;
    /** @deprecated */
    campusSize: "" | "small" | "medium" | "large" | "any";
    /** @deprecated */
    setting: "" | "urban" | "suburban" | "rural" | "any";
    /** @deprecated PIQ status lives in ucJourney.piqs. */
    essays: ProgressStatus;
    /** @deprecated Recommendations only when a campus/program specifically asks. */
    recommendations: ProgressStatus;
  };
  /** Manual checklist ticks (item id → done). */
  checklistDone: Record<string, boolean>;
  /**
   * Guided track onboarding. Lives in profile JSON (Supabase `profiles.data`).
   * Answers that don't fit other fields stay here; mapped fields also update basics/goals/etc.
   */
  onboarding: OnboardingState;
  /** UC Journey Map progress that has no other home (statuses only — never essay text). */
  ucJourney?: UcJourneyState;
  /** Per-PIQ follow-up answers and the generated draft (keyed by PIQ id). */
  piqWork?: Record<string, PiqWork>;
  updatedAt: number;
}

export type PiqStatus = "not-started" | "drafting" | "ready";

export interface PiqWork {
  /** Follow-up question id → the student's answer ("" = skipped). */
  answers: Record<string, string>;
  /** `requested`: written because the student asked, or edited by them. Missing on drafts the app wrote on its own. */
  draft?: { text: string; words: number; generatedAt: number; requested?: boolean };
}

/** One activity or honor waiting in the Google waitlist (see UcJourneyState.googleWaitlist). */
export interface WaitlistItem {
  id: string;
  /** Activities, volunteering, job, or awards (honors and awards). */
  section: ActivitySectionId;
  name: string;
  role: string;
  description: string;
  /** Awards only: school, regional, state, national, or international. */
  level: string;
}

export interface UcJourneyState {
  /** Chosen Personal Insight Question id → status (at most four). */
  piqs: Record<string, PiqStatus>;
  /** Manual review-checklist ticks (items we can't derive from saved data). */
  checks: Record<string, boolean>;
  /** Set only when the student explicitly records submitting on the official UC site. */
  submittedAt: number | null;
  /** Post-submission follow-up ticks. */
  followUps: Record<string, boolean>;
  /** Essays the student set aside for now: Quill moves on to the next one. */
  skippedPiqs?: string[];
  /** How many activities the student told Milo they want to report (3 means 3 or more). */
  activityCount?: number;
  /** Milo's questions and the student's answers, saved for essay drafting when they hit Done. */
  activityNotes?: string;
  /** The same count and saved chat for the volunteering and job questions. */
  activitySections?: Partial<Record<Exclude<ActivitySectionId, "activities">, ActivitySectionState>>;
  /** The old activity questions (ACTIVITY_QUESTIONS id) → how many, the entry it created, and the optional details reply. */
  activitySurvey?: Record<string, ActivitySurveyAnswer>;
  /** Student said they're done with (or skipping) activities on the Profile page. */
  activitiesReviewed?: boolean;
  /**
   * What the Google scan found, waiting for the student's OK. Not in the profile yet: Milo's Confirm
   * moves it into the activities and awards lists; Edit opens a popup to change or add to it first.
   */
  googleWaitlist?: WaitlistItem[];
  /** Apply: what the agent has done for the student after story mode. */
  agent?: AgentState;
}

/** Birthday and birthplace from the voice counselor call. Stored on its own, never in the Profile. */
export interface PersonalInfo {
  /** YYYY-MM-DD */
  birthDate?: string;
  birthCountry?: string;
  birthCity?: string;
}

export interface CallLine {
  role: "student" | "counselor";
  text: string;
}

/** How Sage helps on story mode's Review & Apply step. */
export type ReviewMode = "counselor" | "assistant";

/** A story step's mode, sent with the chat so the guide's prompt follows it. */
export type StoryMode = ReviewMode;

export interface AgentState {
  /** Story mode's Review & Apply step: Counselor or Application assistant (switchable any time). */
  reviewMode?: ReviewMode;
  /** Which counselor tool is open: the AI voice call or the student's own school counselor. */
  counselorMode?: "virtual" | "school";
  /** Counselor the student confirmed. */
  counselor?: { name: string; email: string; title: string; serves: string; sourceUrl: string; confirmedAt: number };
  /** Email to the counselor: drafted here, sent by the student from Gmail. */
  counselorEmail?: { subject: string; body: string; openedAt?: number; sentAt?: number };
  /** Last voice call with the practice counselor; the email is drafted from it. */
  counselorCall?: { endedAt: number; lines: CallLine[] };
  /** Student clicked "Done with counselor" after a full meeting with Jordan; that finishes the meeting task. */
  counselorDoneAt?: number;
  /** Student marked the FAFSA / CA Dream Act Application submitted. */
  fafsaDoneAt?: number;
  /** Student marked their UC Statement of Intent to Register submitted. */
  sirDoneAt?: number;
  /**
   * UC apply finished in the tool this visit, but Applied isn't committed until the popup ✕.
   * Survives Local → Cloud remounts so closing still checks the map off.
   */
  pendingApply?: boolean;
  /** UC application login. Saved only once UC has accepted it (a new account or a sign-in). */
  ucAccount?: {
    email: string;
    /** Missing on records saved while passwords were kept elsewhere; the UC task fills it in. */
    password?: string;
    generatedAt: number;
    /** UC accepted the sign-up form. */
    createdAt?: number;
    /** The verification code went through (or a sign-in got past it). */
    verifiedAt?: number;
    /** Application level and start term were filled in on UC. */
    setupAt?: number;
    /** UC's "About you" category was completed. */
    aboutAt?: number;
    /** Personal insight answers were entered on UC; set when the student closes the apply tool. */
    piqAt?: number;
    signedInAt?: number;
  };
}

export interface ActivitySurveyAnswer {
  /** 0 = "No". */
  count: number;
  activityId?: string;
  /** Undefined until the details question is answered; "" when submitted empty. */
  details?: string;
}

export interface OnboardingState {
  /** Explicit completion — gates the main app. */
  completed: boolean;
  /** Active checkpoint index 0–6, or 7 on the editable summary before finish. */
  checkpoint: number;
  /** Favorite subjects (chips); also mirrored into profile summary text. */
  subjects: string[];
  /** Still exploring majors/careers. */
  exploringMajors: boolean;
  /** GPA scale label, e.g. "4.0" — not a separate DB column. */
  gpaScale: string;
  /** Preferred distance from home. */
  distance: string;
  /** What matters most: programs | affordability | community | other. */
  priorities: string[];
  /** Biggest college question/concern. */
  biggestQuestion: string;
  /** What they want help with first. */
  helpFocus: string;
  /** Optional short note about an experience they care about. */
  activityNote: string;
  completedAt: number | null;
}

export type AgArea = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "none" | "unknown";
export type CourseLevel = "regular" | "honors" | "ap" | "ib" | "dual-enrollment";
export type HighSchoolGrade = "9" | "10" | "11" | "12";
export type CourseStatus = "completed" | "in-progress" | "planned";

export interface TranscriptCourse {
  id: string;
  name: string;
  gradeLevel: HighSchoolGrade | "other";
  term: string;
  grade: string;
  level: CourseLevel;
  /** A–G area; "unknown" means the student left it for review — never invent a classification. */
  area: AgArea;
  semesters: number;
  /** School where the course was taken (defaults to transcript.school when empty). */
  school?: string;
  status?: CourseStatus;
}

export interface Transcript {
  id: string;
  fileName: string;
  uploadedAt: number;
  /** Path of the original file in object storage; null when only the extracted data is kept. */
  storagePath: string | null;
  studentName: string;
  school: string;
  /** School's US state (2-letter code) when the transcript lists it. */
  state?: string;
  reportedGpa: { unweighted: string; weighted: string };
  courses: TranscriptCourse[];
  summary: string;
  strengths: string[];
  concerns: string[];
}
