import type { PiqDraftResult } from "../api";
import type { PiqWork, Profile } from "../types";
import { journeyOf, PIQ_PROMPTS, PIQ_REQUIRED, PIQ_WORD_LIMIT, setPiqStatus } from "./logic";

export interface PiqDetailQuestion {
  id: string;
  question: string;
  placeholder: string;
  /** Optional questions can be skipped; the rest are needed before drafting. */
  optional?: boolean;
}

/**
 * Specific follow-up questions per PIQ. Each set covers what UC's own question asks plus its
 * "Things to consider" guidance (admission.universityofcalifornia.edu → Personal insight questions).
 * The draft is written only from these answers plus the profile, so they need real details.
 * Ids are stable so saved answers survive wording changes.
 */
export const PIQ_DETAIL_QUESTIONS: Record<string, PiqDetailQuestion[]> = {
  // UC: positively influenced others, helped resolve disputes, or contributed to group efforts over time.
  leadership: [
    {
      id: "situation",
      question:
        "Describe one time you led, mentored, took charge of a task, organized something, or helped resolve a dispute. Where was it, what was your role, and how long were you involved? (Helping run things at home counts too.)",
      placeholder: "e.g. For two years I scheduled and trained the volunteers at our church food bank…",
    },
    {
      id: "actions",
      question: "What were your responsibilities, and what did you actually do? How did it positively affect the people or the group?",
      placeholder: "Specific actions and what changed because of them…",
    },
    {
      id: "growth",
      question: "What did you accomplish or learn, and how did it change the way you think about leading others?",
      placeholder: "What you learned…",
    },
  ],
  // UC: describe how you express your creative side (problem solving, original thinking, artistic).
  creativity: [
    {
      id: "outlet",
      question: "How do you express your creative side — artistically, through problem solving, or through original ideas? What does creativity mean to you?",
      placeholder: "e.g. I redesign flyers for my family's small business…",
    },
    {
      id: "example",
      question: "Describe one specific thing you created or one problem you solved creatively. What was your solution, and what steps did you take?",
      placeholder: "The project or problem, and your process…",
    },
    {
      id: "meaning",
      question: "How does your creativity influence your decisions inside or outside the classroom? Does it connect to your major or a future career?",
      placeholder: "Where it shows up and where it's taking you…",
      optional: true,
    },
  ],
  // UC: greatest talent or skill; how you've developed AND demonstrated it over time.
  talent: [
    {
      id: "skill",
      question: "What's your greatest talent or skill, and why is it meaningful to you? (It doesn't need awards to count.)",
      placeholder: "e.g. Translating for my parents, coding, piano…",
    },
    {
      id: "development",
      question: "How have you developed it over time? Did it come naturally, or did you work hard at it? Include practice, setbacks, or milestones.",
      placeholder: "How you got better…",
    },
    {
      id: "showcase",
      question: "How have you demonstrated it? What opportunities has it opened up in or outside the classroom, and how do they fit into your schedule?",
      placeholder: "Performances, jobs, helping others, recognition…",
    },
  ],
  // UC: took advantage of a significant educational opportunity OR worked to overcome an educational barrier.
  opportunity: [
    {
      id: "what",
      question:
        "Which will you write about: an educational opportunity you took advantage of (e.g. an honors or enrichment program, a career academy, advanced courses) or an educational barrier you faced? Describe it.",
      placeholder: "e.g. A summer STEM program, or no AP classes at my school…",
    },
    {
      id: "how",
      question: "How did you make the most of the opportunity, or work to overcome the barrier? What personal qualities or skills did you rely on?",
      placeholder: "What you did…",
    },
    {
      id: "impact",
      question: "How did it prepare you for college or shape who you are today?",
      placeholder: "The result…",
      optional: true,
    },
  ],
  // UC: most significant challenge, steps taken to overcome it, and how it affected academic achievement.
  challenge: [
    {
      id: "what",
      question: "What is the most significant challenge you've faced (personal, at school, or in your community), and why was it significant to you?",
      placeholder: "The challenge and why it mattered…",
    },
    {
      id: "steps",
      question: "What steps did you take to overcome it? Did you have support from someone, or handle it alone? What did you learn?",
      placeholder: "What you did and learned…",
    },
    {
      id: "academics",
      question: "How has this challenge affected your academic achievement? If you're still working through it, what are you doing now?",
      placeholder: "Impact on grades or school, and where things are now…",
    },
  ],
  // UC: an academic subject that inspires you; how you've furthered it inside and/or outside the classroom.
  subject: [
    {
      id: "subject",
      question: "Which academic subject inspires you, and how did your interest in it develop?",
      placeholder: "e.g. Chemistry, after a lab in 10th grade…",
    },
    {
      id: "furthered",
      question:
        "How have you furthered it inside or outside class — higher-level courses (honors, AP, IB, college), clubs, volunteering, internships, jobs, or summer programs? What did you gain?",
      placeholder: "Specific experiences and what you got out of them…",
    },
    {
      id: "future",
      question: "Has it influenced your major or career plans? How might you keep pursuing it at UC?",
      placeholder: "Your plans…",
      optional: true,
    },
  ],
  // UC: what have you done to make your school or your community a better place?
  community: [
    {
      id: "community",
      question:
        "What community will you write about (your school, a team, your neighborhood, your home, or another group), and what's your role in it? What problem or need did you want to fix?",
      placeholder: "The community, your role, and the need…",
    },
    {
      id: "action",
      question: "Why were you inspired to act, and what did you do about it? Did you work alone or with others?",
      placeholder: "Your motivation and actions…",
    },
    {
      id: "result",
      question: "How did your actions benefit others or the wider community, and what did you learn from the effort?",
      placeholder: "The impact…",
      optional: true,
    },
  ],
  // UC: beyond what's already in your application, what makes you a strong candidate for UC?
  standout: [
    {
      id: "unshared",
      question: "What's something about you — a skill, talent, challenge, or opportunity — that the rest of your application doesn't show?",
      placeholder: "Something UC wouldn't otherwise know…",
    },
    {
      id: "example",
      question: "Give a specific example or story that shows it.",
      placeholder: "A moment that shows it…",
    },
    {
      id: "why-uc",
      question: "From your point of view, why does that make you a strong candidate for the University of California? Don't be afraid to brag a little.",
      placeholder: "Why you…",
    },
  ],
};

export const SKIPPED = "";

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

/** Next follow-up question the student hasn't answered or skipped yet. */
export function nextDetailQuestion(profile: Profile, piqId: string): PiqDetailQuestion | null {
  const answers = piqWorkOf(profile, piqId).answers;
  // A required question that was skipped earlier (e.g. it used to be optional) is asked again.
  return (PIQ_DETAIL_QUESTIONS[piqId] ?? []).find((q) => (q.optional ? !(q.id in answers) : !answers[q.id]?.trim())) ?? null;
}

/** All required follow-ups for this PIQ have real answers. */
export function detailsComplete(profile: Profile, piqId: string): boolean {
  const answers = piqWorkOf(profile, piqId).answers;
  return (PIQ_DETAIL_QUESTIONS[piqId] ?? []).every((q) => (q.optional ? q.id in answers : !!answers[q.id]?.trim()));
}

/** This PIQ's follow-ups are done, so its essay can be generated on its own. */
export function canGeneratePiq(profile: Profile, piqId: string): boolean {
  return chosenPiqs(profile).includes(piqId) && detailsComplete(profile, piqId);
}

/** Four PIQs chosen and every follow-up answered (map milestone only — essays generate one at a time). */
export function readyToGenerate(profile: Profile): boolean {
  const ids = chosenPiqs(profile);
  return ids.length === PIQ_REQUIRED && ids.every((id) => detailsComplete(profile, id));
}

export function hasAllDrafts(profile: Profile): boolean {
  const ids = chosenPiqs(profile);
  return ids.length === PIQ_REQUIRED && ids.every((id) => !!piqWorkOf(profile, id).draft);
}

export function setPiqAnswer(profile: Profile, piqId: string, questionId: string, value: string): Profile {
  const work = piqWorkOf(profile, piqId);
  return {
    ...profile,
    piqWork: { ...profile.piqWork, [piqId]: { ...work, answers: { ...work.answers, [questionId]: value.trim() } } },
  };
}

/** Request body for /essay/piqs: the given PIQs (default: every chosen one) with their answered follow-ups. */
export function piqRequest(profile: Profile, ids: string[] = chosenPiqs(profile)) {
  return ids.map((id) => ({
    id,
    answers: (PIQ_DETAIL_QUESTIONS[id] ?? [])
      .map((q) => ({ question: q.question, answer: piqWorkOf(profile, id).answers[q.id] ?? "" }))
      .filter((a) => a.answer.trim()),
  }));
}

/** Saves generated drafts and moves those PIQs to "drafting" (never straight to ready — regenerates demote too). */
export function applyDrafts(profile: Profile, drafts: PiqDraftResult[], now = Date.now()): Profile {
  let journey = journeyOf(profile);
  const piqWork = { ...profile.piqWork };
  for (const d of drafts) {
    const work = piqWork[d.id] ?? { answers: {} };
    piqWork[d.id] = { ...work, draft: { text: d.essay, words: d.wordCount, generatedAt: now } };
    journey = setPiqStatus(journey, d.id, "drafting");
  }
  return { ...profile, piqWork, ucJourney: journey };
}

/** Student edits to a draft in Materials. */
export function editDraft(profile: Profile, piqId: string, text: string): Profile {
  const work = piqWorkOf(profile, piqId);
  if (!work.draft) return profile;
  return {
    ...profile,
    piqWork: { ...profile.piqWork, [piqId]: { ...work, draft: { ...work.draft, text, words: countWords(text) } } },
  };
}

export const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);
export const overLimit = (text: string) => countWords(text) > PIQ_WORD_LIMIT;
