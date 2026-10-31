import type { PiqDraftResult } from "../api";
import type { PiqWork, Profile } from "../types";
import { activitiesStatus, journeyOf, PIQ_PROMPTS, PIQ_REQUIRED, PIQ_WORD_LIMIT, setPiqStatus } from "./logic";

/**
 * PIQs about personal life that the activities list and profile can't answer. Quill asks one
 * open question for each; every other PIQ is drafted straight from activities and the profile.
 */
export const PERSONAL_PIQS: Record<string, string> = {
  opportunity:
    "Please enter any information to answer this prompt — an opportunity you took (a program, advanced classes, an academy) or a barrier you faced at school, and what you did about it.",
  challenge:
    "Please enter any information to answer this prompt — what the challenge was, how you handled it, who helped, and how it affected school.",
  standout:
    "Please enter any information to answer this prompt — something about you the rest of your application doesn't show, and why it makes you a strong UC candidate.",
};

/** Answer key for the one personal-information question. */
export const PERSONAL_ANSWER = "personal";

export const needsPersonalInfo = (piqId: string) => piqId in PERSONAL_PIQS;

/** The student answered the personal question (an empty answer counts — the draft just stays general). */
export function personalAnswered(profile: Profile, piqId: string): boolean {
  return PERSONAL_ANSWER in piqWorkOf(profile, piqId).answers;
}

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

/** Quill has what this PIQ needs: activities/profile always, plus a personal answer where required. */
export function canGeneratePiq(profile: Profile, piqId: string): boolean {
  return chosenPiqs(profile).includes(piqId) && (!needsPersonalInfo(piqId) || personalAnswered(profile, piqId));
}

/** Chosen PIQs to draft automatically: the activities step is done and they have no draft yet. */
export function piqsToAutoDraft(profile: Profile): string[] {
  if (!activitiesStatus(profile).done) return [];
  return chosenPiqs(profile).filter((id) => !piqWorkOf(profile, id).draft && canGeneratePiq(profile, id));
}

/** Four PIQs chosen and every personal question answered. */
export function readyToGenerate(profile: Profile): boolean {
  const ids = chosenPiqs(profile);
  return ids.length === PIQ_REQUIRED && ids.every((id) => canGeneratePiq(profile, id));
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

/** Request body for /essay/piqs: the given PIQs (default: every chosen one) with any personal answer. */
export function piqRequest(profile: Profile, ids: string[] = chosenPiqs(profile)) {
  return ids.map((id) => {
    const answer = piqWorkOf(profile, id).answers[PERSONAL_ANSWER] ?? "";
    return { id, answers: needsPersonalInfo(id) && answer.trim() ? [{ question: PERSONAL_PIQS[id], answer }] : [] };
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
  return [...acts, ...awards].join("\n");
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

/** Student edits to a draft in Profile → Essays. */
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
