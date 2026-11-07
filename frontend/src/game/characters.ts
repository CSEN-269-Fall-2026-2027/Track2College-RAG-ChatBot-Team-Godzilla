import type { Mood } from "../types";

export type Species = "owl" | "fox" | "cat" | "human";
export type SceneId = "campus" | "office" | "library";

export interface Palette {
  body: string;
  belly: string;
  accent: string;
  dark: string;
}

export interface Mentor {
  /** Also the backend persona id (backend/persona.py). */
  id: "sage" | "theo" | "penny" | "quill" | "milo" | "counselor" | "assistant";
  name: string;
  title: string;
  specialty: string;
  species: Species;
  palette: Palette;
  scene: SceneId;
  /** Base frequency (Hz) for the typing blips. */
  voice: number;
  greeting: (name: string) => string;
  suggestions: { title: string; prompt: string }[];
}

export const MENTORS: Mentor[] = [
  {
    id: "sage",
    name: "Sage",
    title: "General Admissions Guide",
    specialty: "UC requirements, deadlines, and how applications work",
    species: "human",
    palette: { body: "#8b6b4e", belly: "#f1e2c6", accent: "#2f6fb5", dark: "#3b2a1e" },
    scene: "campus",
    voice: 330,
    greeting: (name) =>
      `Hey${name ? ` ${name}` : ""}! What would you like to work on today?`,
    suggestions: [
      { title: "What UCs look for", prompt: "What do UC schools look for in freshman applicants?" },
      { title: "A–G requirements", prompt: "What are the A–G course requirements for UC campuses?" },
      { title: "My major", prompt: "Do I need to pick a major when I apply to a UC?" },
      { title: "Help me figure it out", prompt: "I'm not sure where to start with UC applications. What should I focus on first?" },
    ],
  },
  {
    id: "theo",
    name: "Theo",
    title: "Campus Guide",
    specialty: "What each UC campus is like and which ones fit you",
    species: "human",
    palette: { body: "#6e2a3a", belly: "#f6e8d0", accent: "#6e2a3a", dark: "#3a2420" },
    scene: "campus",
    voice: 350,
    greeting: (name) => `Hey${name ? ` ${name}` : ""}! I've walked all nine UC campuses. Which one are you curious about?`,
    suggestions: [
      { title: "Meet all nine", prompt: "Tell me a little about each UC campus." },
      { title: "What's special", prompt: "What's special about each UC compared to the others?" },
      { title: "Find my fit", prompt: "Based on my profile, which UC campuses might fit me, and why?" },
      { title: "Compare two", prompt: "How do UCLA and UC Berkeley feel different as places to go to school?" },
    ],
  },
  {
    id: "penny",
    name: "Penny",
    title: "Financial Aid Guide",
    specialty: "FAFSA, Cal Grant, scholarships, and what college will really cost",
    species: "fox",
    palette: { body: "#e07a3a", belly: "#fff3e6", accent: "#1f9d55", dark: "#4a2412" },
    scene: "office",
    voice: 440,
    greeting: (name) =>
      `Hey${name ? ` ${name}` : ""}! Money stuff doesn't have to be scary — what do you want to tackle?`,
    suggestions: [
      { title: "FAFSA basics", prompt: "What do I need to complete the FAFSA, and when is it due?" },
      { title: "Scholarships", prompt: "How do I find scholarships I'm eligible for?" },
      { title: "Cal Grant", prompt: "What is the Cal Grant and how do I qualify?" },
      { title: "Cost & aid", prompt: "How do I estimate what a UC will actually cost me after aid?" },
    ],
  },
  {
    id: "quill",
    name: "Quill",
    title: "Essay Guide",
    specialty: "Choosing your UC Personal Insight Questions and writing strong responses",
    species: "cat",
    palette: { body: "#56607a", belly: "#e9ecf5", accent: "#b7791f", dark: "#1f2433" },
    scene: "library",
    voice: 290,
    greeting: (name) =>
      `Hey${name ? ` ${name}` : ""}. Every student has a story — what should we write about?`,
    suggestions: [
      { title: "UC PIQs", prompt: "What are the UC Personal Insight Questions and how should I approach them?" },
      { title: "Brainstorm topics", prompt: "Help me brainstorm college essay topics from my experiences." },
      { title: "Personal statement", prompt: "How should I structure a strong personal statement?" },
      { title: "Recommendation letters", prompt: "Who should I ask for recommendation letters, and when?" },
    ],
  },
  {
    id: "milo",
    name: "Milo",
    title: "Activities Guide",
    specialty: "Getting to know what you do outside of class, so your essays sound like you",
    species: "human",
    palette: { body: "#1f6b4f", belly: "#f7ecd0", accent: "#1f6b4f", dark: "#14213d" },
    scene: "campus",
    voice: 370,
    greeting: (name) =>
      `Hey${name ? ` ${name}` : ""}! I want to learn more about you and what you do outside of class.`,
    suggestions: [
      { title: "What counts", prompt: "What counts as an activity for a UC application?" },
      { title: "Work & family", prompt: "Do a job or family responsibilities count as activities?" },
      { title: "Not much to report", prompt: "I don't think I've done much outside of class. What could I talk about?" },
      { title: "Awards", prompt: "Should I mention awards or honors, even small ones?" },
    ],
  },
];

export const DEFAULT_MENTOR = MENTORS[0];

/**
 * Review & Apply's two chat personalities. The student picks one on that step; they aren't in
 * the general mentor list. Their ids match the Review & Apply modes and the backend personas.
 */
export const REVIEW_GUIDES: Mentor[] = [
  {
    id: "counselor",
    name: "Counselor",
    title: "Reach your school counselor",
    specialty: "Emailing your school counselor and practice meetings with Jordan, your virtual counselor",
    species: "human",
    palette: { body: "#1f6b4f", belly: "#f7ecd0", accent: "#1f6b4f", dark: "#14213d" },
    scene: "office",
    voice: 350,
    greeting: (name) => `Hey${name ? ` ${name}` : ""}! Want help reaching your school counselor?`,
    suggestions: [],
  },
  {
    id: "assistant",
    name: "Application Assistant",
    title: "Fill in your UC application",
    specialty: "Opening the UC application and filling in what's in your profile",
    species: "human",
    palette: { body: "#1e3a6e", belly: "#e9dcc0", accent: "#d4a017", dark: "#14213d" },
    scene: "campus",
    voice: 360,
    greeting: (name) => `Hey${name ? ` ${name}` : ""}! Want help applying?`,
    suggestions: [],
  },
];

export function mentorById(id: string | null | undefined): Mentor {
  return MENTORS.find((m) => m.id === id) ?? REVIEW_GUIDES.find((m) => m.id === id) ?? DEFAULT_MENTOR;
}

const FINANCE = /\b(fafsa|financial aid|scholarship|grant|loan|tuition|cost|afford|money|pay|price|cal grant|dream act|work[- ]study|net price)\b/i;
const ESSAY = /\b(essay|personal statement|piq|insight question|prompt|recommendation|letter|write|writing|story)\b/i;
const CAMPUS = /\b(ucla|ucsd|ucsb|ucsc|uci|ucr|berkeley|davis|irvine|merced|riverside|san diego|santa barbara|santa cruz|campus|campuses|which ucs?)\b/i;
/** Application logistics stay with Sage even when a campus is named. */
const APPLICATION = /\b(deadlines?|requirements?|gpa|a[-–]g|submit|fill(ing)? (in|out)|application)\b/i;
const MAJOR = /\b(major|majors|undeclared|impacted|minor|what (should|to) (i )?study|career path)\b/i;

/** Background for a conversation, based on what the student is asking about. */
export function sceneFor(question: string | undefined, mentor: Mentor): SceneId {
  if (!question) return mentor.scene;
  if (FINANCE.test(question)) return "office";
  if (ESSAY.test(question)) return "library";
  return "campus";
}

/** Which mentor is best suited to a question, used to suggest a hand-off. */
export function specialistFor(question: string): Mentor["id"] {
  if (FINANCE.test(question)) return "penny";
  if (ESSAY.test(question)) return "quill";
  if (MAJOR.test(question)) return "theo";
  if (CAMPUS.test(question) && !APPLICATION.test(question)) return "theo";
  return "sage";
}

const OFF_TOPIC = /^I'm sorry, I can only help/i;

/** Expression to show when the model didn't send one. */
export function inferMood(message: { content: string; error?: boolean; mood?: Mood }): Mood {
  if (message.mood) return message.mood;
  if (message.error || OFF_TOPIC.test(message.content)) return "concerned";
  if (/\b(deadline|due|late|miss|penalt|warning|important)\b/i.test(message.content)) return "concerned";
  if (/\b(congrat|great news|good news|eligible|free|guaranteed)\b/i.test(message.content)) return "excited";
  return "happy";
}

export function isOffTopic(content: string) {
  return OFF_TOPIC.test(content);
}
