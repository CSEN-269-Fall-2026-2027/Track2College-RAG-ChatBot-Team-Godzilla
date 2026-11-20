import { MAJOR_CHOICES } from "../constants";
import type { Mentor } from "../game/characters";
import type { GradeLevel, Profile } from "../types";
import { AFTER_APPLY, computeJourney, isReviewStage, isUc, journeyOf, PIQ_REQUIRED, toggleCampus, togglePiq, type Checkpoint, type CheckpointId } from "./logic";
import { chosenPiqs, essayDone } from "./piqs";

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
  | { type: "toggleCampus"; campus: string }
  /** Replace the UC campus list with these names (checkbox picker submit). */
  | { type: "setCampuses"; campuses: string[] }
  | { type: "togglePiq"; piqId: string }
  /** Replace chosen PIQs with exactly these ids (checkbox picker; expect four). */
  | { type: "setPiqs"; piqIds: string[] }
  | { type: "toggleCheck"; checkId: string }
  | { type: "applyText"; field: TextField; value: string }
  /** Sets an essay aside: Quill moves on to the next one. */
  | { type: "skipPiq"; piqId: string }
  /** Brings set-aside essays back. */
  | { type: "unskipPiqs" }
  /** Draft these PIQs with Groq (one as soon as its follow-ups are done); results land in Profile → Essays. */
  | { type: "generatePiqs"; piqIds: string[] }
  /** Opens this essay in Profile → Essays, ready for the student to paste in their own. */
  | { type: "pasteEssay"; piqId: string }
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
  | "exams";
export interface GuidedChoice {
  id: string;
  label: string;
  effect: GuidedEffect;
  /** Sets this option apart from the answers around it. */
  highlight?: boolean;
  /** The student's current answer, which stays on screen so they can change it. */
  selected?: boolean;
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
    multiline?: boolean;
    /** Submitting an empty box is a valid answer. */
    allowEmpty?: boolean;
  };
  /** Give each choice a whole row of its own. */
  stackedChoices?: boolean;
  /** A small note under the choices. */
  note?: string;
  /** Show all UC campuses as checkboxes; submit fires setCampuses. */
  campusPicker?: boolean;
  /** Hold the essays chapter without a guided bubble — Quill's chat opener owns the UI. */
  chatOnly?: boolean;
  finished: boolean;
}

/** Effect for a typed reply to this turn. */
export function inputEffect(turn: GuidedTurn, value: string): GuidedEffect | null {
  const input = turn.input;
  if (!input || !value.trim()) return null;
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
 * The Counselor and Application assistant unlock once every checkpoint before the counselor stop
 * is complete. Financial Aid comes after Apply and doesn't hold it up.
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
    // Done after Apply: no more questions. The student can chat with any guide (each opens with
    // their own greeting), so there's no question box here.
    return {
      id: "done",
      checkpointId: "done",
      speaker: "sage",
      chapter: "Finish",
      prompt: "",
      choices: [],
      chatOnly: true,
      finished: true,
    };
  }

  // Onboarding prefills all nine UCs — ask Theo to confirm before moving on (even if the UC step is otherwise done).
  const ucCount = profile.colleges.filter(isUc).length;
  if (ucCount >= 9 && !journeyOf(profile).checks?.["ucs-confirmed"] && !skipIds.has("confirm-ucs")) {
    return {
      id: "confirm-ucs",
      checkpointId: "ucs",
      speaker: "theo",
      chapter: "Choose UCs",
      // Theo's chat opener carries Confirm / Decline; no multiple-choice box.
      chatOnly: true,
      prompt: hi("we'll apply to all nine UCs. You can unselect any in Profile anytime — sound good?"),
      choices: [
        { id: "confirm", label: "Yes, all nine", highlight: true, effect: { type: "toggleCheck", checkId: "ucs-confirmed" } },
        { id: "edit", label: "Let me pick which ones", effect: { type: "ask", mentorId: "theo", prompt: "I want to change which UC campuses I'm applying to. What should I consider?" } },
        { id: "later", label: "Ask me later", effect: DEFER },
      ],
      finished: false,
    };
  }

  const order = [
    ...journey.checkpoints.slice(journey.current),
    ...journey.checkpoints.slice(0, journey.current),
  ].filter((c) => !c.complete);

  for (const cp of order) {
    const turns = turnsFor(cp, profile, sections, hi, skipIds).filter((t) => !skipIds.has(t.id));
    if (turns.length) {
      const chapter = `${cp.short} · ${turns.length} question${turns.length === 1 ? "" : "s"} left`;
      return { ...turns[0], checkpointId: cp.id, chapter, finished: false };
    }
    // Activities is finished in Milo's chat: the list found (or added) there, then Confirm. No question box.
    if (cp.id === "activities") {
      return {
        id: "activities-list",
        checkpointId: cp.id,
        speaker: "milo",
        chapter: `${cp.short} · 1 task left`,
        prompt: "",
        choices: [],
        chatOnly: true,
        finished: false,
      };
    }
    // The counselor and apply stops are finished by the tools in their guide's chat, not chat turns.
    // Hold the story there (no bubble) so it never skips ahead to Financial Aid.
    if (isReviewStage(cp.id)) {
      const left = cp.tasks.filter((t) => !t.done).length;
      return {
        id: `${cp.id}-tools`,
        checkpointId: cp.id,
        speaker: cp.id === "counselor" ? "counselor" : "assistant",
        chapter: `${cp.short} · ${left} task${left === 1 ? "" : "s"} left`,
        prompt: "",
        choices: [],
        chatOnly: true,
        finished: false,
      };
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
  skipIds: ReadonlySet<string>,
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
      // A GPA alone starts academic history, so exams only come up when the GPA is put off.
      if (!filled(a.exams) && skipIds.has("gpa")) {
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
        speaker: "theo",
        prompt: hi("please choose the UCs you want to apply to."),
        choices: [],
        campusPicker: true,
      });
    } else if (ucs.length >= 9 && !(journeyOf(profile).checks?.["ucs-confirmed"])) {
      out.push({
        id: "confirm-ucs",
        speaker: "theo",
        chatOnly: true,
        prompt: hi("we'll apply to all nine UCs. You can unselect any in Profile anytime — sound good?"),
        choices: [
          { id: "confirm", label: "Yes, all nine", highlight: true, effect: { type: "toggleCheck", checkId: "ucs-confirmed" } },
          { id: "edit", label: "Let me pick which ones", effect: { type: "ask", mentorId: "theo", prompt: "I want to change which UC campuses I'm applying to. What should I consider?" } },
        ],
      });
    }
    // Onboarding usually sets the major already. It's the same one at every campus, so it's asked once.
    if (!profile.goals.intendedMajor) {
      out.push({
        id: "major",
        speaker: "theo",
        prompt: hi("please select your major."),
        choices: [
          ...MAJOR_CHOICES.map((m) => ({ id: `major-${m}`, label: m, effect: { type: "setGoals" as const, patch: { intendedMajor: m } } })),
          {
            id: "ask",
            label: "Help me pick a major",
            highlight: true,
            effect: { type: "ask", mentorId: "theo", prompt: "Can you help me pick a major?" },
          },
        ],
      });
    }
  }

  if (cp.id === "essays") {
    const j = journeyOf(profile);
    const chosen = Object.keys(j.piqs);
    if (chosen.length < PIQ_REQUIRED) {
      // Quill's chat opener lists the four picks + Why / Sounds good / Swap (swap opens a popup).
      // A leftover "choose-piqs" flag from the old in-chat picker is ignored.
      out.push({
        id: "confirm-piq-chat",
        speaker: "quill",
        prompt: "",
        choices: [],
        chatOnly: true,
      });
    } else {
      const pending = chosenPiqs(profile).filter((id) => !essayDone(profile, id));
      if (pending.length) {
        // Drafting happens from Quill's chat chips — keep the chapter from skipping ahead.
        out.push({
          id: "draft-piq-chat",
          speaker: "quill",
          prompt: "",
          choices: [],
          chatOnly: true,
        });
      }
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
    case "togglePiq":
      return { ...profile, ucJourney: togglePiq(journeyOf(profile), effect.piqId) };
    case "setPiqs": {
      const ids = effect.piqIds.slice(0, PIQ_REQUIRED);
      const cur = journeyOf(profile);
      const prev = cur.piqs;
      const piqs: Record<string, "not-started" | "drafting" | "ready"> = {};
      for (const id of ids) piqs[id] = prev[id] ?? "not-started";
      const checks = { ...cur.checks };
      delete checks["choose-piqs"];
      return { ...profile, ucJourney: { ...cur, piqs, checks } };
    }
    case "toggleCheck": {
      const cur = journeyOf(profile);
      const checks = { ...cur.checks };
      if (checks[effect.checkId]) delete checks[effect.checkId];
      else checks[effect.checkId] = true;
      return { ...profile, ucJourney: { ...cur, checks } };
    }
    case "skipPiq": {
      const cur = journeyOf(profile);
      return { ...profile, ucJourney: { ...cur, skippedPiqs: [...(cur.skippedPiqs ?? []), effect.piqId] } };
    }
    case "unskipPiqs":
      return { ...profile, ucJourney: { ...journeyOf(profile), skippedPiqs: [] } };
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
    case "pasteEssay":
      return null;
    case "skipPiq":
    case "unskipPiqs":
      return null;
    case "toggleCampus":
      return `Updated your campuses: ${effect.campus}`;
    case "setCampuses":
      return effect.campuses.length
        ? `Saved ${effect.campuses.length} UC campus${effect.campuses.length === 1 ? "" : "es"}`
        : null;
    case "togglePiq":
      return "Updated your PIQ choices";
    case "setPiqs":
      return effect.piqIds.length === PIQ_REQUIRED ? `Saved your 4 PIQ choices` : null;
    case "toggleCheck":
      return "Checked off on your review list";
    case "setGoals":
      return effect.patch.intendedMajor ? `Saved your major: ${effect.patch.intendedMajor}` : "Saved to your profile";
    default:
      return "Saved to your profile";
  }
}
