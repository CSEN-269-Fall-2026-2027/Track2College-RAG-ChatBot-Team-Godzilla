import type { Mentor } from "../game/characters";
import type { GradeLevel, Profile } from "../types";
import {
  ACTIVITY_DESC_LIMIT,
  AFTER_APPLY,
  ACTIVITY_QUESTIONS,
  computeJourney,
  isUc,
  journeyOf,
  PIQ_PROMPTS,
  PIQ_REQUIRED,
  PIQ_WORD_LIMIT,
  REVIEW_MANUAL,
  setCampusMajor,
  setPiqStatus,
  toggleCampus,
  togglePiq,
  type Checkpoint,
  type CheckpointId,
} from "./logic";
import { canGeneratePiq, chosenPiqs, needsPersonalInfo, PERSONAL_ANSWER, PERSONAL_PIQS, personalAnswered, piqWorkOf, setPiqAnswer } from "./piqs";

/** Rough unweighted GPA choices (4.0 scale). */
export const GPA_RANGES = [
  { id: "under25", label: "Below 2.5", value: "below 2.5" },
  { id: "25-29", label: "2.5–2.9", value: "2.5–2.9" },
  { id: "30-34", label: "3.0–3.4", value: "3.0–3.4" },
  { id: "35-37", label: "3.5–3.7", value: "3.5–3.7" },
  { id: "38-40", label: "3.8–4.0", value: "3.8–4.0" },
] as const;

/** What happens when the student picks a choice or submits text. */
export type GuidedEffect =
  /** Defer this turn for the session; the story moves on to the next open task. */
  | { type: "noop" }
  | { type: "setBasics"; patch: Partial<Profile["basics"]> }
  | { type: "setAcademics"; patch: Partial<Profile["academics"]> }
  | { type: "setGoals"; patch: Partial<Profile["goals"]> }
  /** Financial-aid answers (Profile → Cost & support). */
  | { type: "setPreferences"; patch: Partial<Profile["preferences"]> }
  /** Answer to a direct activity question; count > 0 adds the entry. */
  | { type: "answerActivity"; questionId: string; count: number }
  /** Optional extra details for a "yes" answer ("" = submitted empty). */
  | { type: "activityDetails"; questionId: string; value: string }
  | { type: "toggleCampus"; campus: string }
  /** Replace the UC campus list with these names (checkbox picker submit). */
  | { type: "setCampuses"; campuses: string[] }
  | { type: "setMajor"; campus: string; major: string }
  | { type: "togglePiq"; piqId: string }
  /** Replace chosen PIQs with exactly these ids (checkbox picker; expect four). */
  | { type: "setPiqs"; piqIds: string[] }
  | { type: "setPiqReady"; piqId: string }
  | { type: "toggleCheck"; checkId: string }
  | { type: "markSubmitted" }
  | { type: "applyText"; field: TextField; value: string }
  | { type: "setPiqAnswer"; piqId: string; questionId: string; value: string }
  /** Draft these PIQs with Groq (one as soon as its follow-ups are done); results land in Profile → Essays. */
  | { type: "generatePiqs"; piqIds: string[] }
  | { type: "openEssays" }
  /** Hand off to a guide in the chat with a starter question. */
  | { type: "ask"; mentorId: Mentor["id"]; prompt: string }
  /** Put the cursor in the chat box so the student can ask their own question. */
  | { type: "focusChat" }
  /** Bring back everything deferred this session. */
  | { type: "resume" };

export type TextField =
  | "firstName"
  | "highSchool"
  | "graduationYear"
  | "gpaUnweighted"
  | "exams"
  | "major"
  | "activityDetails"
  | "piqAnswer";

export interface GuidedChoice {
  id: string;
  label: string;
  effect: GuidedEffect;
}

export interface GuidedTurn {
  id: string;
  checkpointId: CheckpointId | "done";
  /** Guide who speaks this turn: each chapter belongs to the guide who knows it best. */
  speaker: Mentor["id"];
  /** Progress label, e.g. "Profile · 1/3" */
  chapter: string;
  /** Guide's question or statement. */
  prompt: string;
  /** Up to four selectable replies. */
  choices: GuidedChoice[];
  /** Optional free-text answer instead of / in addition to choices. */
  input?: {
    placeholder: string;
    field: TextField;
    submitLabel: string;
    campus?: string;
    /** For "piqAnswer": which PIQ the personal information is for. */
    piqId?: string;
    /** PIQ answer key, or ACTIVITY_QUESTIONS id for "activityDetails". */
    questionId?: string;
    multiline?: boolean;
    /** Submitting an empty box is a valid answer. */
    allowEmpty?: boolean;
  };
  /** Show all UC campuses as checkboxes; submit fires setCampuses. */
  campusPicker?: boolean;
  /** Show all 8 PIQs as checkboxes; submit fires setPiqs with exactly 4. */
  piqPicker?: boolean;
  finished: boolean;
}

/** Effect for a typed reply to this turn. */
export function inputEffect(turn: GuidedTurn, value: string): GuidedEffect | null {
  const input = turn.input;
  if (input?.field === "activityDetails" && input.questionId) {
    return { type: "activityDetails", questionId: input.questionId, value: value.trim() };
  }
  // Personal PIQ info: anything goes to the draft, even an empty box.
  if (input?.field === "piqAnswer" && input.piqId && input.questionId) {
    return { type: "setPiqAnswer", piqId: input.piqId, questionId: input.questionId, value: value.trim() };
  }
  if (!input || !value.trim()) return null;
  if (input.field === "major" && input.campus) return { type: "setMajor", campus: input.campus, major: value };
  return { type: "applyText", field: input.field, value };
}

const GRADES: { id: GradeLevel; label: string }[] = [
  { id: "9", label: "9th grade" },
  { id: "10", label: "10th grade" },
  { id: "11", label: "11th grade" },
  { id: "12", label: "12th grade" },
];

const filled = (v: string) => v.trim().length > 0;

export const academicStarted = (profile: Profile) =>
  filled(profile.academics.gpaUnweighted) || filled(profile.academics.gpaWeighted) || filled(profile.academics.exams);

/**
 * Apply unlocks at Review & Apply: every checkpoint before it is complete, so Apply takes over.
 * Financial Aid comes after Review & Apply and doesn't hold Apply up.
 */
export function storyComplete(profile: Profile, sections: Record<string, number>) {
  const { checkpoints } = computeJourney(profile, sections, academicStarted(profile));
  return checkpoints.filter((c) => !AFTER_APPLY.includes(c.id)).every((c) => c.complete);
}
const DEFER = { type: "noop" } as const;

type Draft = Omit<GuidedTurn, "checkpointId" | "chapter" | "finished">;

/**
 * Next single story turn. Walks the open checkpoints in order starting at the
 * current one and returns the first question the student hasn't deferred, so
 * deferring always moves the story forward instead of stalling.
 * Every requirement in `computeJourney` has a matching question here.
 */
export function nextGuidedTurn(
  profile: Profile,
  sections: Record<string, number>,
  studentName = "",
  skipIds: ReadonlySet<string> = new Set(),
): GuidedTurn {
  const name = studentName.trim().split(/\s+/)[0] ?? "";
  const hi = (s: string) => (name ? `${name}, ${s}` : s[0].toUpperCase() + s.slice(1));
  const journey = computeJourney(profile, sections, academicStarted(profile));

  if (journey.finished) {
    return {
      id: "done",
      checkpointId: "done",
      speaker: "sage",
      chapter: "Finish",
      prompt: hi("you've submitted your UC application and sorted out financial aid — that's the whole path! Next up: watch your email and keep your grades steady."),
      choices: [
        { id: "aid", label: "Ask Penny what comes next for aid", effect: { type: "ask", mentorId: "penny", prompt: "I submitted my UC application and my FAFSA or CA Dream Act. What should I watch for next with financial aid, like Cal Grant and my aid offers?" } },
        { id: "next", label: "What happens after I submit?", effect: { type: "ask", mentorId: "sage", prompt: "I submitted my UC application. What happens next and what should I watch for?" } },
        { id: "manual", label: "Ask my own question", effect: { type: "focusChat" } },
      ],
      finished: true,
    };
  }

  const order = [
    ...journey.checkpoints.slice(journey.current),
    ...journey.checkpoints.slice(0, journey.current),
  ].filter((c) => !c.complete);

  for (const cp of order) {
    const turn = turnsFor(cp, profile, sections, hi).find((t) => !skipIds.has(t.id));
    if (turn) {
      return { ...turn, checkpointId: cp.id, chapter: `${cp.short} · ${cp.done}/${cp.total} done`, finished: false };
    }
  }

  const cp = journey.checkpoints[journey.current];
  return {
    id: "idle",
    checkpointId: cp.id,
    speaker: "sage",
    chapter: `${journey.completeCount} of ${journey.checkpoints.length} steps done`,
    prompt: hi(`you've set aside everything that's left for now. Next time, we'll start with “${cp.title}”.`),
    choices: [
      { id: "resume", label: "Go back to what I skipped", effect: { type: "resume" } },
      { id: "manual", label: "Ask a guide a question instead", effect: { type: "focusChat" } },
    ],
    finished: false,
  };
}

/** Questions for one checkpoint, in story order. Only unanswered ones are returned. */
function turnsFor(
  cp: Checkpoint,
  profile: Profile,
  sections: Record<string, number>,
  hi: (s: string) => string,
): Draft[] {
  const out: Draft[] = [];
  const { basics: b, academics: a } = profile;

  if (cp.id === "profile") {
    if (sections.basics < 1) {
      if (!filled(b.firstName)) {
        out.push({
          id: "name",
          speaker: "sage",
          prompt: "Hi, I'm Sage — I'll walk you through your UC application one step at a time. First, what should I call you?",
          choices: [],
          input: { placeholder: "Your first name…", field: "firstName", submitLabel: "That's me" },
        });
      }
      if (!b.gradeLevel) {
        out.push({
          id: "grade",
          speaker: "sage",
          prompt: hi("let's start your profile — it's what every UC application builds on. What grade are you in right now?"),
          choices: GRADES.map((gr) => ({ id: gr.id, label: gr.label, effect: { type: "setBasics", patch: { gradeLevel: gr.id } } })),
        });
      }
      if (!filled(b.graduationYear)) {
        const y = new Date().getFullYear();
        out.push({
          id: "grad-year",
          speaker: "sage",
          prompt: hi("when do you graduate high school? That tells us which application cycle you're in."),
          choices: [0, 1, 2, 3].map((i) => {
            const year = String(y + i);
            return { id: year, label: year, effect: { type: "setBasics" as const, patch: { graduationYear: year } } };
          }),
          input: { placeholder: "Or type a year…", field: "graduationYear", submitLabel: "Save year" },
        });
      }
      if (!filled(b.highSchool)) {
        out.push({
          id: "school",
          speaker: "sage",
          prompt: hi("what's the name of your high school? You'll list it on the application."),
          choices: [],
          input: { placeholder: "Type your school name…", field: "highSchool", submitLabel: "Save school" },
        });
      }
      if (!filled(b.state)) {
        out.push({
          id: "state",
          speaker: "sage",
          prompt: hi("where do you go to school? (Living in California is not the same as qualifying for California residency for tuition.)"),
          choices: [
            { id: "CA", label: "California", effect: { type: "setBasics", patch: { state: "CA" } } },
            { id: "us", label: "Another U.S. state", effect: { type: "setBasics", patch: { state: "Other U.S." } } },
            { id: "intl", label: "Outside the U.S.", effect: { type: "setBasics", patch: { state: "International" } } },
          ],
        });
      }
    }

    const academicStarted = filled(a.gpaUnweighted) || filled(a.gpaWeighted) || filled(a.exams);
    if (!academicStarted) {
      if (!filled(a.gpaUnweighted) && !filled(a.gpaWeighted)) {
        out.push({
          id: "gpa",
          speaker: "sage",
          prompt: hi("now academic history. What's your school-reported unweighted GPA, roughly? You can add courses later — an upload is never required."),
          choices: [
            ...GPA_RANGES.slice(1).map((r) => ({ id: `gpa-${r.id}`, label: r.label, effect: { type: "setAcademics" as const, patch: { gpaUnweighted: r.value } } })),
            { id: "later", label: "I'll enter courses later", effect: DEFER },
          ],
          input: { placeholder: "Or type your exact GPA…", field: "gpaUnweighted", submitLabel: "Save GPA" },
        });
      }
      if (!filled(a.exams)) {
        out.push({
          id: "exams",
          speaker: "sage",
          prompt: hi("any AP, IB, or English-proficiency exam scores to note? Courses stay in Academic History — this is exams only."),
          choices: [
            { id: "none", label: "None yet", effect: { type: "setAcademics", patch: { exams: "None yet" } } },
            { id: "later", label: "Skip for now", effect: DEFER },
          ],
          input: { placeholder: "e.g. AP Calc BC 4…", field: "exams", submitLabel: "Save exams" },
        });
      }
    }
  }

  if (cp.id === "ucs") {
    const ucs = profile.colleges.filter(isUc);
    if (!ucs.length) {
      out.push({
        id: "pick-uc",
        speaker: "sage",
        prompt: hi(
          "profile done! Next, choose your UC campuses. One application covers all nine — check every campus you'll apply to, then hit Submit.",
        ),
        choices: [],
        campusPicker: true,
      });
    }
    for (const c of ucs.filter((u) => !u.major?.trim())) {
      const own = profile.goals.majors.find((m) => m && m !== "Undeclared");
      out.push({
        id: `major-${c.name}`,
        speaker: "milo",
        prompt: hi(`each campus asks for a major. What do you want to study at ${c.name}?`),
        choices: [
          ...(own ? [{ id: "same", label: `${own} (your interest)`, effect: { type: "setMajor" as const, campus: c.name, major: own } }] : []),
          { id: "und", label: "Undeclared / exploring", effect: { type: "setMajor", campus: c.name, major: "Undeclared" } },
          {
            id: "ask",
            label: `Help me pick a major at ${c.name}`,
            effect: { type: "ask", mentorId: "milo", prompt: `Help me choose a major to apply for at ${c.name}. Which majors there fit my interests, and are any impacted?` },
          },
        ],
        input: { placeholder: "Or type a major…", field: "major", submitLabel: "Save major", campus: c.name },
      });
    }
  }

  if (cp.id === "activities") {
    const survey = journeyOf(profile).activitySurvey ?? {};
    ACTIVITY_QUESTIONS.forEach((q, i) => {
      const answer = survey[q.id];
      if (!answer) {
        const answerWith = (count: number) => ({ type: "answerActivity" as const, questionId: q.id, count });
        out.push({
          id: `activity-${q.id}`,
          speaker: "sage",
          prompt: hi(i === 0 ? `time for your activities — I'll ask a few quick questions. First: ${q.question}` : q.question),
          choices: q.counted
            ? [
                { id: "no", label: "No", effect: answerWith(0) },
                { id: "1", label: "Yes — 1", effect: answerWith(1) },
                { id: "2", label: "Yes — 2", effect: answerWith(2) },
                { id: "3", label: "Yes — 3 or more", effect: answerWith(3) },
              ]
            : [
                { id: "yes", label: "Yes", effect: answerWith(1) },
                { id: "no", label: "No", effect: answerWith(0) },
              ],
        });
      } else if (answer.count > 0 && answer.details === undefined) {
        out.push({
          id: `activity-details-${q.id}`,
          speaker: "sage",
          prompt: hi(`nice! Any details to add about ${q.name.toLowerCase()}? ${q.details} Or leave it blank and hit Submit.`),
          choices: [],
          input: { placeholder: "Optional details…", field: "activityDetails", submitLabel: "Submit", questionId: q.id, multiline: true, allowEmpty: true },
        });
      }
    });
  }

  if (cp.id === "essays") {
    const j = journeyOf(profile);
    const chosen = Object.keys(j.piqs);
    if (chosen.length < PIQ_REQUIRED) {
      out.push({
        id: "pick-piq",
        speaker: "quill",
        prompt: hi(
          `Time for essays! UC asks for 4 of 8 Personal Insight Questions (${PIQ_WORD_LIMIT} words each). Check the four you like best and hit Submit — I'll write the drafts for you from your activities and profile.`,
        ),
        choices: [],
        piqPicker: true,
      });
    }

    // Personal-life PIQs need one answer the activities list can't give; everything else drafts on its own.
    for (const piqId of chosenPiqs(profile)) {
      const meta = PIQ_PROMPTS.find((p) => p.id === piqId);
      if (!meta || !needsPersonalInfo(piqId) || personalAnswered(profile, piqId)) continue;
      out.push({
        id: `piq-personal-${piqId}`,
        speaker: "quill",
        prompt: hi(`“${meta.title}” is about your personal life, so I can't pull it from your activities. UC asks: “${meta.prompt}” ${PERSONAL_PIQS[piqId]} Whatever you write — even nothing — I'll turn into a draft.`),
        choices: [],
        input: { placeholder: "Anything you want Quill to know…", field: "piqAnswer", submitLabel: "Submit", piqId, questionId: PERSONAL_ANSWER, multiline: true, allowEmpty: true },
      });
    }

    // Drafts start automatically once activities are done; this turn shows progress and allows a retry.
    for (const piqId of chosenPiqs(profile)) {
      const meta = PIQ_PROMPTS.find((p) => p.id === piqId);
      if (!meta || piqWorkOf(profile, piqId).draft || !canGeneratePiq(profile, piqId)) continue;
      out.push({
        id: `generate-${piqId}`,
        speaker: "quill",
        prompt: hi(`I'm writing your “${meta.title}” essay from your activities and profile — no questions needed. It'll show up in Profile → Essays in a few seconds.`),
        choices: [
          { id: "generate", label: `Write my “${meta.title}” essay now`, effect: { type: "generatePiqs", piqIds: [piqId] } },
          { id: "later", label: "Keep going", effect: DEFER },
        ],
      });
    }

    for (const [piqId, status] of Object.entries(j.piqs)) {
      if (status === "ready") continue;
      const draft = piqWorkOf(profile, piqId).draft;
      if (!draft) continue;
      const meta = PIQ_PROMPTS.find((q) => q.id === piqId);
      const title = meta?.title ?? "PIQ";
      out.push({
        id: `piq-ready-${piqId}`,
        speaker: "quill",
        prompt: hi(
          `your “${title}” draft is in Profile → Essays (${draft.words}/${PIQ_WORD_LIMIT} words). Read it, change anything that doesn't sound like you, then mark it ready.`,
        ),
        choices: [
          { id: "open", label: "Open my essays", effect: { type: "openEssays" } },
          { id: "ready", label: "It's finished — mark it ready", effect: { type: "setPiqReady", piqId } },
          { id: "regen", label: "Regenerate a fresh draft", effect: { type: "generatePiqs", piqIds: [piqId] } },
          {
            id: "revise",
            label: "Help me revise it",
            effect: {
              type: "ask",
              mentorId: "quill",
              prompt: `Help me revise my UC PIQ response for "${meta?.prompt ?? title}" so it sounds more like me and stays under ${PIQ_WORD_LIMIT} words:\n\n${draft.text}`,
            },
          },
          { id: "later", label: "Come back later", effect: DEFER },
        ],
      });
    }
  }

  if (cp.id === "review") {
    const j = journeyOf(profile);
    for (const m of REVIEW_MANUAL) {
      if (j.checks[m.id]) continue;
      const fee = m.id === "fees";
      out.push({
        id: `check-${m.id}`,
        speaker: fee ? "penny" : "sage",
        prompt: hi(`almost there! ${m.detail} Have you taken care of this?`),
        choices: [
          { id: "yes", label: "Yes — mark it done", effect: { type: "toggleCheck", checkId: m.id } },
          fee
            ? { id: "ask", label: "Do I qualify for a fee waiver?", effect: { type: "ask", mentorId: "penny", prompt: "How do UC application fee waivers work, and how do I know if I qualify?" } }
            : { id: "ask", label: "Check my major's extra steps", effect: { type: "ask", mentorId: "milo", prompt: "Do any of my UC campuses or majors need supplemental steps like portfolios, auditions, or extra questions?" } },
          { id: "later", label: "Not yet", effect: DEFER },
        ],
      });
    }
    out.push({
      id: "submit",
      speaker: "sage",
      prompt: hi("the last step happens on the official UC site, apply.universityofcalifornia.edu. Once you've submitted there, record it here."),
      choices: [
        { id: "submitted", label: "I submitted — mark it!", effect: { type: "markSubmitted" } },
        { id: "how", label: "Walk me through submitting", effect: { type: "ask", mentorId: "sage", prompt: "Walk me through the final steps to submit my UC application, and what to double-check before I do." } },
        { id: "later", label: "Not submitted yet", effect: DEFER },
      ],
    });
  }

  if (cp.id === "aid") {
    const f = profile.preferences;
    if (f.needsAid === "") {
      out.push({
        id: "aid-needs",
        speaker: "penny",
        prompt: hi("last stop: paying for college. Do you think you'll need financial aid — grants, scholarships, or work-study?"),
        choices: [
          { id: "yes", label: "Yes, I'll need aid", effect: { type: "setPreferences", patch: { needsAid: "yes" } } },
          { id: "unsure", label: "Not sure yet", effect: { type: "setPreferences", patch: { needsAid: "unsure" } } },
          { id: "no", label: "No, we've got it covered", effect: { type: "setPreferences", patch: { needsAid: "no" } } },
        ],
      });
    }
    if (f.fafsa !== "done" && f.needsAid !== "no") {
      const started = f.fafsa === "in-progress";
      out.push({
        id: started ? "aid-fafsa-finish" : "aid-fafsa",
        speaker: "penny",
        prompt: started
          ? hi("how's the FAFSA or California Dream Act Application going? Once it's submitted, this step is done.")
          : hi("the FAFSA (or the California Dream Act Application, if FAFSA isn't right for you) is how UC and California decide your aid. Have you filed it?"),
        choices: started
          ? [
              { id: "done", label: "It's submitted!", effect: { type: "setPreferences", patch: { fafsa: "done" } } },
              { id: "help", label: "Help me finish it", effect: { type: "ask", mentorId: "penny", prompt: "I started the FAFSA or California Dream Act Application. What do I still need to finish it, and what documents should I have ready?" } },
              { id: "later", label: "Not yet", effect: DEFER },
            ]
          : [
              { id: "done", label: "Yes, it's submitted", effect: { type: "setPreferences", patch: { fafsa: "done" } } },
              { id: "started", label: "I've started it", effect: { type: "setPreferences", patch: { fafsa: "in-progress" } } },
              { id: "which", label: "Which one should I file?", effect: { type: "ask", mentorId: "penny", prompt: "Should I file the FAFSA or the California Dream Act Application, and how do I get started?" } },
              { id: "later", label: "Not yet", effect: DEFER },
            ],
      });
    }
  }

  return out;
}

/** Apply a guided effect to the profile. Hand-off effects (ask/focusChat/resume) leave it unchanged. */
export function applyGuidedEffect(profile: Profile, effect: GuidedEffect, newId: () => string): Profile {
  switch (effect.type) {
    case "setBasics":
      return { ...profile, basics: { ...profile.basics, ...effect.patch } };
    case "setAcademics":
      return { ...profile, academics: { ...profile.academics, ...effect.patch } };
    case "setGoals":
      return { ...profile, goals: { ...profile.goals, ...effect.patch } };
    case "setPreferences":
      return { ...profile, preferences: { ...profile.preferences, ...effect.patch } };
    case "answerActivity": {
      const q = ACTIVITY_QUESTIONS.find((x) => x.id === effect.questionId);
      if (!q) return profile;
      const cur = journeyOf(profile);
      const activity =
        effect.count > 0
          ? { id: newId(), name: effect.count > 1 ? `${q.name} (${effect.count}${effect.count >= 3 ? "+" : ""})` : q.name, role: "", hoursPerWeek: "", weeksPerYear: "", years: "", description: "", category: q.category }
          : null;
      return {
        ...profile,
        activities: activity ? [...profile.activities, activity] : profile.activities,
        ucJourney: { ...cur, activitySurvey: { ...cur.activitySurvey, [q.id]: { count: effect.count, activityId: activity?.id } } },
      };
    }
    case "activityDetails": {
      const cur = journeyOf(profile);
      const answer = cur.activitySurvey?.[effect.questionId];
      if (!answer) return profile;
      const details = effect.value.trim();
      return {
        ...profile,
        activities: details
          ? profile.activities.map((a) => (a.id === answer.activityId ? { ...a, description: details.slice(0, ACTIVITY_DESC_LIMIT) } : a))
          : profile.activities,
        ucJourney: { ...cur, activitySurvey: { ...cur.activitySurvey, [effect.questionId]: { ...answer, details } } },
      };
    }
    case "toggleCampus":
      return toggleCampus(profile, effect.campus, newId);
    case "setCampuses": {
      const byKey = new Map(profile.colleges.map((c) => [c.name.toLowerCase(), c]));
      const nonUc = profile.colleges.filter((c) => !isUc(c));
      const nextUc = effect.campuses.map((name) => {
        const prev = byKey.get(name.toLowerCase());
        return prev && isUc(prev)
          ? prev
          : { id: newId(), name, status: "researching" as const, plan: "UC" as const, deadline: "", notes: "", major: "" };
      });
      return { ...profile, colleges: [...nonUc, ...nextUc] };
    }
    case "setMajor":
      return setCampusMajor(profile, effect.campus, effect.major);
    case "togglePiq":
      return { ...profile, ucJourney: togglePiq(journeyOf(profile), effect.piqId) };
    case "setPiqs": {
      const ids = effect.piqIds.slice(0, PIQ_REQUIRED);
      const prev = journeyOf(profile).piqs;
      const piqs: Record<string, "not-started" | "drafting" | "ready"> = {};
      for (const id of ids) piqs[id] = prev[id] ?? "not-started";
      return { ...profile, ucJourney: { ...journeyOf(profile), piqs } };
    }
    case "setPiqReady":
      return { ...profile, ucJourney: setPiqStatus(journeyOf(profile), effect.piqId, "ready") };
    case "toggleCheck": {
      const cur = journeyOf(profile);
      const checks = { ...cur.checks };
      if (checks[effect.checkId]) delete checks[effect.checkId];
      else checks[effect.checkId] = true;
      return { ...profile, ucJourney: { ...cur, checks } };
    }
    case "markSubmitted":
      return { ...profile, ucJourney: { ...journeyOf(profile), submittedAt: Date.now() } };
    case "setPiqAnswer":
      return setPiqAnswer(profile, effect.piqId, effect.questionId, effect.value);
    case "applyText": {
      const v = effect.value.trim();
      if (!v) return profile;
      switch (effect.field) {
        case "firstName":
          return applyGuidedEffect(profile, { type: "setBasics", patch: { firstName: v } }, newId);
        case "highSchool":
          return applyGuidedEffect(profile, { type: "setBasics", patch: { highSchool: v } }, newId);
        case "graduationYear":
          return applyGuidedEffect(profile, { type: "setBasics", patch: { graduationYear: v } }, newId);
        case "gpaUnweighted":
          return applyGuidedEffect(profile, { type: "setAcademics", patch: { gpaUnweighted: v } }, newId);
        case "exams":
          return applyGuidedEffect(profile, { type: "setAcademics", patch: { exams: v } }, newId);
        case "major":
          return applyGuidedEffect(profile, { type: "setGoals", patch: { majors: [v] } }, newId);
        case "activityDetails":
        case "piqAnswer":
          return profile;
      }
      return profile;
    }
    default:
      return profile;
  }
}

/** Short confirmation shown after a reply changes the profile. */
export function savedLabel(effect: GuidedEffect): string | null {
  switch (effect.type) {
    case "noop":
    case "ask":
    case "focusChat":
    case "resume":
    case "generatePiqs":
    case "openEssays":
      return null;
    case "setPiqAnswer":
      return effect.value ? "Saved — Quill is writing your essay" : "Got it — Quill will keep that essay general";
    case "toggleCampus":
      return `Updated your campuses: ${effect.campus}`;
    case "setCampuses":
      return effect.campuses.length
        ? `Saved ${effect.campuses.length} UC campus${effect.campuses.length === 1 ? "" : "es"}`
        : null;
    case "setMajor":
      return `Saved major at ${effect.campus}: ${effect.major}`;
    case "togglePiq":
      return "Updated your PIQ choices";
    case "setPiqs":
      return effect.piqIds.length === PIQ_REQUIRED ? `Saved your 4 PIQ choices` : null;
    case "setPiqReady":
      return "Marked that PIQ ready";
    case "toggleCheck":
      return "Checked off on your review list";
    case "markSubmitted":
      return "Recorded your UC submission";
    case "answerActivity":
      return effect.count > 0 ? "Added to your activities list" : null;
    case "activityDetails":
      return effect.value.trim() ? "Saved your activity details" : null;
    default:
      return "Saved to your profile";
  }
}
