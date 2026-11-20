import type { PiqDraftResult } from "../api";
import type { ActivityCategory, ActivitySectionId, Message, PiqWork, Profile, UcJourneyState } from "../types";
import { ACTIVITY_SECTIONS, activitySection, journeyOf, PIQ_PROMPTS, PIQ_REQUIRED, PIQ_WORD_LIMIT, setPiqStatus } from "./logic";

/** Answer key for what the student told Quill about an essay. */
export const PERSONAL_ANSWER = "personal";

export function piqWorkOf(profile: Profile, piqId: string): PiqWork {
  return profile.piqWork?.[piqId] ?? { answers: {} };
}

/** Chosen PIQ ids in the official order (at most four). */
export function chosenPiqs(profile: Profile): string[] {
  const picked = journeyOf(profile).piqs;
  return PIQ_PROMPTS.filter((q) => q.id in picked)
    .map((q) => q.id)
    .slice(0, PIQ_REQUIRED);
}

/** Any chosen PIQ can be written: the draft draws on whatever the student has shared, and stays general if it's little. */
export function canGeneratePiq(profile: Profile, piqId: string): boolean {
  return chosenPiqs(profile).includes(piqId);
}

/**
 * The student's essay for this PIQ. Drafts the app wrote on its own before students could choose
 * (no `requested`) stay in Profile → Essays, but Quill still starts those essays from the beginning.
 */
export function startedDraft(profile: Profile, piqId: string) {
  const draft = piqWorkOf(profile, piqId).draft;
  return draft?.requested && draft.text.trim() ? draft : undefined;
}

/** Any essay with text in it counts as ready. */
export function essayHasText(profile: Profile, piqId: string): boolean {
  return !!piqWorkOf(profile, piqId).draft?.text.trim();
}

export function essaysReadyCount(profile: Profile): number {
  return chosenPiqs(profile).filter((id) => essayHasText(profile, id)).length;
}

/**
 * Asking Quill about an essay: the chat shows a short line, and the model gets the essay itself.
 * The draft is the saved one, since leaving the essay's page asks about anything unsaved.
 */
export function essayHelpRequest(profile: Profile, piqId: string): { display: string; query: string } {
  const meta = PIQ_PROMPTS.find((q) => q.id === piqId);
  const display = `I need help with my essay on ${meta?.title}.`;
  const essay = piqWorkOf(profile, piqId).draft?.text.trim();
  const body = essay ? `Here's my essay, which only you can see in this chat:\n\n${essay}` : "I haven't written anything for it yet.";
  return { display, query: `${display}\n\nThe question: "${meta?.prompt}"\n\n${body}` };
}

/** This essay is filled out, so Quill moves on. An essay marked ready back when that was a button counts too. */
export function essayDone(profile: Profile, piqId: string): boolean {
  return journeyOf(profile).piqs[piqId] === "ready" || !!startedDraft(profile, piqId);
}

/** The essay Quill is on: the first unfinished one the student hasn't skipped, or if all are skipped, the first unfinished. */
export function currentEssay(profile: Profile): string | null {
  const j = journeyOf(profile);
  const ids = chosenPiqs(profile);
  if (ids.length < PIQ_REQUIRED) return null;
  const open = ids.filter((id) => !essayDone(profile, id));
  return open.find((id) => !j.skippedPiqs?.includes(id)) ?? open[0] ?? null;
}

/** How many of the chosen essays are filled out. */
export function essaysDoneCount(profile: Profile): number {
  return chosenPiqs(profile).filter((id) => essayDone(profile, id)).length;
}

export function setPiqAnswer(profile: Profile, piqId: string, questionId: string, value: string): Profile {
  const work = piqWorkOf(profile, piqId);
  return {
    ...profile,
    piqWork: { ...profile.piqWork, [piqId]: { ...work, answers: { ...work.answers, [questionId]: value.trim() } } },
  };
}

const GENERIC_WORDS = new Set(["team", "club", "the", "school", "high", "varsity", "jv", "member", "group", "program", "society", "association", "of", "and", "at", "my"]);

/** What an activity goes by in an essay: "Soccer Team" is "soccer". A short word like "Key" stays "key club", so "the key" doesn't match. */
export function activityKey(name: string): string {
  const full = name.trim().toLowerCase();
  const key = full.split(/\s+/).filter((w) => !GENERIC_WORDS.has(w)).join(" ");
  return key.length >= 5 ? key : full;
}

/** The student's activities and awards, by name. */
export function activityNames(profile: Profile): string[] {
  return [...profile.activities.map((a) => a.name), ...profile.awards.map((a) => a.title)].filter((n) => n.trim());
}

/** Most essays one activity can carry. It only gets a second one once every activity has had a first. */
const MAX_ESSAYS_PER_ACTIVITY = 2;

/**
 * The activities this essay can't use, from the other essays' text and what the student told Quill for them.
 * Major and interests aren't limited.
 */
export function usedActivities(profile: Profile, exceptId?: string): string[] {
  const keys = [...new Set(activityNames(profile).map(activityKey))];
  const texts = chosenPiqs(profile)
    .filter((id) => id !== exceptId)
    .map((id) => {
      const work = piqWorkOf(profile, id);
      const told = (work.answers[PERSONAL_ANSWER] ?? "").split("\n").filter((line) => line.startsWith("Student:")).join(" ");
      return `${startedDraft(profile, id)?.text ?? ""} ${told}`.toLowerCase();
    });
  const uses = new Map(
    keys.map((key) => {
      const word = new RegExp(`\\b${key.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&")}\\b`);
      return [key, texts.filter((text) => word.test(text)).length];
    }),
  );
  const someUnused = [...uses.values()].some((n) => n === 0);
  return keys.filter((key) => {
    const n = uses.get(key) ?? 0;
    return n >= MAX_ESSAYS_PER_ACTIVITY || (n >= 1 && someUnused);
  });
}

/**
 * What points an activity at each PIQ. An activity matches when its name, role, or description
 * hits `words`, or its category is in `categories`.
 */
const PIQ_SIGNALS: { piq: string; words: RegExp; categories?: ActivityCategory[] }[] = [
  {
    piq: "leadership",
    words: /\b(captain|president|vice president|officer|treasurer|secretary|leader|lead|founder|co-?founder|chair|head|manager|organizer|mentor|coach)\b/,
  },
  {
    piq: "creativity",
    words: /\b(art|arts|paint\w*|draw\w*|music|band|orchestra|choir|theat(er|re)|drama|film\w*|photo\w*|design\w*|cod(e|ing)|programm\w*|robot\w*|engineer\w*|maker\w*|hackathon|writ\w*|poet\w*|invent\w*|creat\w*)\b/,
  },
  {
    piq: "talent",
    words: /\b(piano|violin|guitar|cello|sing\w*|swim\w*|soccer|basketball|tennis|track|cross country|football|volleyball|baseball|softball|chess|debate|speech|martial arts|karate|dance|athlet\w*|varsity|competit\w*)\b/,
    categories: ["award"],
  },
  {
    piq: "opportunity",
    words: /\b(summer program|research|academy|dual enrollment|community college|college course|enrichment|honors program|upward bound|avid|stem program)\b/,
    categories: ["educational-prep", "other-coursework"],
  },
  {
    piq: "challenge",
    words: /\b(job|part-time|employ\w*|cashier|barista|caregiv\w*|take care|family responsibilit\w*|siblings?|translat\w*)\b/,
    categories: ["work"],
  },
  {
    piq: "community",
    words: /\b(volunteer\w*|community|tutor\w*|nonprofit|food bank|habitat|service|charity|fundrais\w*|outreach|clean-?up)\b/,
    categories: ["volunteering"],
  },
];

/** Points per activity that matches a PIQ (once per PIQ, however many words hit). */
const ACTIVITY_POINTS = 2;
/** A declared major means Academic subject always has something to say. */
const MAJOR_POINTS = 3;
/** Awards point at Talent; state-level and above count a little more. */
const AWARD_POINTS = 1;
const BIG_AWARD_POINTS = 2;
/** Standout works for anyone, so it starts with a small head start. */
const STANDOUT_POINTS = 1;
/**
 * Ties go to the questions most students can answer without a matching activity
 * (instead of alphabetically, which used to pick "challenge" for everyone).
 */
const TIE_ORDER = ["subject", "standout", "challenge", "opportunity", "community", "leadership", "creativity", "talent"];

/** One activity or honor that could carry a PIQ, and how strongly. */
interface Support {
  /** Activity or award id. */
  source: string;
  points: number;
}

/**
 * For each PIQ: points that never run out (major, background, Standout's head start) and the
 * activities and honors that point at it. Each source shows up once per PIQ.
 */
export function piqEvidence(profile: Profile) {
  const base = new Map<string, number>(PIQ_PROMPTS.map((q) => [q.id, 0]));
  const support = new Map<string, Support[]>(PIQ_PROMPTS.map((q) => [q.id, []]));
  const addBase = (id: string, n: number) => base.set(id, (base.get(id) ?? 0) + n);
  const addSupport = (id: string, source: string, points: number) => support.get(id)?.push({ source, points });

  for (const a of profile.activities) {
    const text = [a.name, a.role, a.description].join(" ").toLowerCase();
    for (const signal of PIQ_SIGNALS) {
      if (signal.words.test(text) || signal.categories?.includes(a.category)) addSupport(signal.piq, a.id, ACTIVITY_POINTS);
    }
  }

  for (const award of profile.awards) {
    if (!award.title.trim()) continue;
    addSupport("talent", award.id, ["state", "national", "international"].includes(award.level) ? BIG_AWARD_POINTS : AWARD_POINTS);
  }

  // The major can back any number of essays, so it isn't limited like activities.
  if (profile.goals.intendedMajor.trim()) addBase("subject", MAJOR_POINTS);
  // First in the family to go to college: an educational barrier or challenge often fits.
  if (profile.basics.firstGen === "yes") {
    addBase("opportunity", 1);
    addBase("challenge", 1);
  }
  addBase("standout", STANDOUT_POINTS);
  return { base, support };
}

/**
 * Deterministic Top 4 PIQs from the student's activities, awards, major, and background (no model call).
 * Picks one essay at a time, so no activity or honor carries more than
 * MAX_ESSAYS_PER_ACTIVITY of the four; once it's used up it stops counting toward the rest.
 * Returned in official PIQ order for Quill's essay queue.
 */
export function autoPickPiqs(profile: Profile): string[] {
  const { base, support } = piqEvidence(profile);
  const uses = new Map<string, number>();
  const available = (s: Support) => (uses.get(s.source) ?? 0) < MAX_ESSAYS_PER_ACTIVITY;
  const score = (id: string) => (base.get(id) ?? 0) + (support.get(id) ?? []).filter(available).reduce((n, s) => n + s.points, 0);
  const rank = (id: string) => TIE_ORDER.indexOf(id);

  const picked: string[] = [];
  while (picked.length < PIQ_REQUIRED) {
    const next = PIQ_PROMPTS.map((q) => q.id)
      .filter((id) => !picked.includes(id))
      .sort((a, b) => score(b) - score(a) || rank(a) - rank(b))[0];
    if (!next) break;
    for (const s of (support.get(next) ?? []).filter(available)) uses.set(s.source, (uses.get(s.source) ?? 0) + 1);
    picked.push(next);
  }
  return PIQ_PROMPTS.filter((q) => picked.includes(q.id)).map((q) => q.id);
}

/** Labels for Quill's "I'll write about these — confirm?" turn (official UC prompt numbers). */
export function autoPickPiqLabels(profile: Profile): string[] {
  const ids = autoPickPiqs(profile);
  return ids.map((id) => {
    const index = PIQ_PROMPTS.findIndex((q) => q.id === id);
    const meta = index >= 0 ? PIQ_PROMPTS[index] : undefined;
    return `Essay #${index + 1}: ${meta?.title ?? id}`;
  });
}

/** Official PIQ titles Quill named in a "Suggest four essays" reply, in the order they appeared (Top 4 + Backup). */
export function suggestedPiqTitles(answer: string): string[] {
  const hits: { title: string; at: number }[] = [];
  for (const { title } of PIQ_PROMPTS) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`\\b${escaped}\\b`, "i").exec(answer);
    if (match) hits.push({ title, at: match.index });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.title);
}

/** Same ask Quill's opener buttons use when the student wants to learn about one PIQ. */
export function piqAboutAsk(title: string): { prompt: string; display: string } | null {
  const q = PIQ_PROMPTS.find((p) => p.title.toLowerCase() === title.trim().toLowerCase());
  if (!q) return null;
  return {
    prompt: `Tell me about the "${q.title}" question: ${q.prompt}`,
    display: `Tell me about the ${q.title} question.`,
  };
}

/** Quill's one question for an essay with no activity left to draw on. It's fixed, so it costs no tokens. */
export const ESSAY_FOLLOW_UPS: Record<string, string> = {
  leadership: "What's a time you helped a group or a person get something done, anywhere in your life?",
  creativity: "What's something you've made or solved in your own way?",
  talent: "What are you good at, and how did you get better at it?",
  opportunity: "What's a class, program, or barrier at school that shaped your education?",
  challenge: "What's the hardest thing you've dealt with, and what did you do about it?",
  subject: "Which subject do you love most, and what do you do with it outside of class?",
  community: "What's something you've done to help your school or community?",
  standout: "What's something about you that the rest of your application doesn't show?",
};
export const FOLLOW_UP_THANKS = "Thanks, that will help. You can generate your essay whenever you're ready.";

/** Request body for /essay/piqs: the given PIQs (default: every chosen one) with what the student told Quill. */
export function piqRequest(profile: Profile, ids: string[] = chosenPiqs(profile)) {
  return ids.map((id) => {
    const answer = piqWorkOf(profile, id).answers[PERSONAL_ANSWER] ?? "";
    return { id, answers: answer.trim() ? [{ question: "What the student told Quill about this essay", answer }] : [], used_activities: usedActivities(profile, id) };
  });
}

/** Every activity and award with its details, so drafts can draw on them. */
export function activitiesSummary(profile: Profile): string {
  const acts = profile.activities.map((a) =>
    [
      `- ${a.name || "Untitled activity"}`,
      a.role && `role: ${a.role}`,
      a.hoursPerWeek && `${a.hoursPerWeek} hrs/wk`,
      a.weeksPerYear && `${a.weeksPerYear} wks/yr`,
      a.years && `years: ${a.years}`,
      a.description && `details: ${a.description}`,
    ]
      .filter(Boolean)
      .join("; "),
  );
  const awards = profile.awards.map((x) => `- Award: ${x.title}${x.level ? ` (${x.level})` : ""}`);
  const notes = miloNotes(journeyOf(profile));
  return [...acts, ...awards, ...(notes ? [`What the student told Milo about their activities:\n${notes}`] : [])].join("\n");
}

/** Longest saved chat, leaving room in /essay/piqs' 16000-character activities field for the list itself. */
const ACTIVITY_NOTES_LIMIT = 10000;

const NOTES_LABELS: Record<Exclude<ActivitySectionId, "activities">, string> = { volunteering: "volunteering", job: "job", awards: "honors and awards" };

/** Everything the student told Milo, across the activity, volunteering, job and award questions. */
export function miloNotes(j: UcJourneyState): string {
  const parts = ACTIVITY_SECTIONS.flatMap((s) => {
    const notes = activitySection(j, s.id).notes;
    if (!notes) return [];
    return [s.id === "activities" ? notes : `About their ${NOTES_LABELS[s.id]}:\n${notes}`];
  });
  return parts.join("\n\n").slice(0, ACTIVITY_NOTES_LIMIT);
}

/** A guide's questions and the student's typed answers. Ready-made button messages and the closing line are left out. */
export function chatNotes(messages: Message[], guide: string): string {
  const pairs: string[] = [];
  messages.forEach((m, i) => {
    const reply = messages[i + 1];
    if (m.role === "assistant" && !m.error && !m.essayFor && reply?.role === "user" && !reply.preset) pairs.push(`${guide}: ${m.content}\nStudent: ${reply.content}`);
  });
  return pairs.join("\n\n");
}

/** The latest of what the student told Quill about an essay, within /essay/piqs' 3000-character answer field. */
export const essayNotesFrom = (messages: Message[]) => chatNotes(messages, "Quill").slice(-3000);

/** Saves generated drafts and moves those PIQs to "drafting". */
export function applyDrafts(profile: Profile, drafts: PiqDraftResult[], now = Date.now()): Profile {
  let journey = journeyOf(profile);
  const piqWork = { ...profile.piqWork };
  for (const d of drafts) {
    const work = piqWork[d.id] ?? { answers: {} };
    const text = limitWords(d.essay);
    piqWork[d.id] = { ...work, draft: { text, words: countWords(text), generatedAt: now, requested: true } };
    journey = setPiqStatus(journey, d.id, "drafting");
  }
  const skippedPiqs = journey.skippedPiqs?.filter((id) => !drafts.some((d) => d.id === id));
  return { ...profile, piqWork, ucJourney: { ...journey, ...(skippedPiqs ? { skippedPiqs } : {}) } };
}

/** Student edits to a draft in Profile → Essays, or their own essay pasted in. Anything past UC's word limit is cut. */
export function editDraft(profile: Profile, piqId: string, text: string): Profile {
  const work = piqWorkOf(profile, piqId);
  const kept = limitWords(text);
  return {
    ...profile,
    piqWork: {
      ...profile.piqWork,
      [piqId]: { ...work, draft: { generatedAt: work.draft?.generatedAt ?? Date.now(), text: kept, words: countWords(kept), requested: true } },
    },
  };
}

export const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);
export const overLimit = (text: string) => countWords(text) > PIQ_WORD_LIMIT;

/** The text up to its last allowed word. Text within the limit comes back untouched, spaces included. */
export function limitWords(text: string, limit = PIQ_WORD_LIMIT): string {
  const words = [...text.matchAll(/\S+/g)];
  if (words.length <= limit) return text;
  const last = words[limit - 1];
  return text.slice(0, last.index + last[0].length);
}

/**
 * Swaps one chosen PIQ for another the student hasn't picked. The old question's work stays saved
 * (so switching back brings its draft back); the new one starts from whatever was saved for it.
 */
export function swapPiq(profile: Profile, from: string, to: string): Profile {
  const journey = journeyOf(profile);
  if (!(from in journey.piqs) || to in journey.piqs) return profile;
  const piqs = { ...journey.piqs };
  delete piqs[from];
  piqs[to] = piqWorkOf(profile, to).draft ? "drafting" : "not-started";
  return { ...profile, ucJourney: { ...journey, piqs } };
}

/** Starts the essays over: the four chosen questions go, along with their essays and what the student told Quill about them. */
export function resetEssays(profile: Profile): Profile {
  const { skippedPiqs: _skipped, ...journey } = journeyOf(profile);
  const piqWork = { ...profile.piqWork };
  for (const id of chosenPiqs(profile)) delete piqWork[id];
  return { ...profile, piqWork, ucJourney: { ...journey, piqs: {} } };
}

/** Deletes the student's response to a PIQ (keeps the question chosen and any personal answer). */
export function deleteDraft(profile: Profile, piqId: string): Profile {
  const work = piqWorkOf(profile, piqId);
  if (!work.draft) return profile;
  const { draft: _removed, ...rest } = work;
  return {
    ...profile,
    piqWork: { ...profile.piqWork, [piqId]: rest },
    ucJourney: setPiqStatus(journeyOf(profile), piqId, "not-started"),
  };
}
