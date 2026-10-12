export type Role = "user" | "assistant";

export interface Message {
  id: string;
  role: Role;
  content: string;
  sources?: string[];
  followups?: string[];
  responseTimeMs?: number;
  error?: boolean;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  sessionId: string | null;
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
export type ApplicationPlan = "" | "ED" | "EA" | "REA" | "RD" | "Rolling" | "UC" | "CSU";
export type ProgressStatus = "" | "not-started" | "in-progress" | "done";

export interface Activity {
  id: string;
  name: string;
  role: string;
  hoursPerWeek: string;
  years: string;
  description: string;
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
    gpaUnweighted: string;
    gpaWeighted: string;
    classRank: string;
    apIbCourses: string;
    sat: string;
    act: string;
    testPlan: "" | "submitting" | "test-optional" | "undecided";
    coursework: string;
  };
  goals: {
    majors: string[];
    careers: string;
    whyCollege: string;
  };
  activities: Activity[];
  awards: Award[];
  colleges: TargetCollege[];
  preferences: {
    regions: string;
    campusSize: "" | "small" | "medium" | "large" | "any";
    setting: "" | "urban" | "suburban" | "rural" | "any";
    maxAnnualCost: string;
    needsAid: "" | "yes" | "no" | "unsure";
    incomeRange: "" | "under-30k" | "30-60k" | "60-110k" | "110-175k" | "over-175k" | "prefer-not";
    fafsa: ProgressStatus;
    essays: ProgressStatus;
    recommendations: ProgressStatus;
  };
  updatedAt: number;
}

export type AgArea = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "none";
export type CourseLevel = "regular" | "honors" | "ap" | "ib" | "dual-enrollment";
export type HighSchoolGrade = "9" | "10" | "11" | "12";

export interface TranscriptCourse {
  id: string;
  name: string;
  gradeLevel: HighSchoolGrade | "other";
  term: string;
  grade: string;
  level: CourseLevel;
  area: AgArea;
  semesters: number;
}

export interface Transcript {
  id: string;
  fileName: string;
  uploadedAt: number;
  /** Path of the original file in object storage; null when only the extracted data is kept. */
  storagePath: string | null;
  studentName: string;
  school: string;
  reportedGpa: { unweighted: string; weighted: string };
  courses: TranscriptCourse[];
  summary: string;
  strengths: string[];
  concerns: string[];
}

export interface PlannedCourse {
  name: string;
  area: AgArea;
  level: CourseLevel;
  status: "completed" | "planned";
  note: string;
}

export interface CoursePlan {
  id: string;
  college: string;
  major: string;
  createdAt: number;
  summary: string;
  requirements: { area: string; detail: string }[];
  years: { grade: HighSchoolGrade; courses: PlannedCourse[] }[];
  tips: string[];
  sources: string[];
}

export type Fit = "reach" | "target" | "likely" | "unknown";

export interface ProfileAnalysis {
  summary: string;
  strengths: string[];
  gaps: string[];
  colleges: { name: string; fit: Fit; reasoning: string; sources: string[] }[];
  actions: { title: string; detail: string; timeframe: string }[];
  generatedAt: number;
  profileHash: string;
}
