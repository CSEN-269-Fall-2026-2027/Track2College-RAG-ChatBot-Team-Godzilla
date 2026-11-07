import { agentOf, setAgent, sirDeadlineDate } from "../agent/logic";
import { MAJOR_CHOICES } from "../constants";
import type { Mentor } from "../game/characters";
import type { ActivitySectionId, Award, GradeLevel, Profile } from "../types";
import {
  ACTIVITY_DESC_LIMIT,
  ACTIVITY_SECTIONS,
  AFTER_APPLY,
  activitiesStatus,
  activitySection,
  activitySectionAnswered,
  computeJourney,
  isUc,
  journeyOf,
  withActivitySection,
  PIQ_PROMPTS,
  PIQ_REQUIRED,
  toggleCampus,
  togglePiq,
  type Checkpoint,
  type CheckpointId,
} from "./logic";
import { ADD_INFO_LABEL, chosenPiqs, essayDone, essayNeedsFollowUp } from "./piqs";

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
  /** How many of this section's things the student wants to report (3 means 3 or more). */
  | { type: "setActivityCount"; section: ActivitySectionId; count: number }
  /** Saves what the student told Milo and adds it to their list; the view builds it from the chat (see finishActivities). */
  | { type: "saveActivitySection"; section: ActivitySectionId; notes: string; items: ActivityItem[] }
  /** The student is done telling Milo about this section. */
  | { type: "finishActivities"; section: ActivitySectionId }
  /** 3 or more: the student fills these in on the Profile page, so this question is finished. */
  | { type: "fillInProfile"; section: ActivitySectionId }
  | { type: "toggleCampus"; campus: string }
  /** Replace the UC campus list with these names (checkbox picker submit). */
  | { type: "setCampuses"; campuses: string[] }
  | { type: "togglePiq"; piqId: string }
  /** Replace chosen PIQs with exactly these ids (checkbox picker; expect four). */
  | { type: "setPiqs"; piqIds: string[] }
  | { type: "toggleCheck"; checkId: string }
  | { type: "markSubmitted" }
  /** UC Statement of Intent to Register: submitted on UC's site, recorded here (true) or undone (false). */
  | { type: "setSirDone"; done: boolean }
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

/** One row for the activities list, read out of the student's chat with Milo. */
export interface ActivityItem {
  name: string;
  role: string;
  description: string;
  /** Honors and awards only. */
  level?: string;
}

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
  /** Show all 8 PIQs as checkboxes; submit fires setPiqs with exactly 4. */
  piqPicker?: boolean;
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
 * Apply unlocks at Review & Apply: every checkpoint before it is complete, so Apply takes over.
 * Financial Aid comes after Review & Apply and doesn't hold Apply up.
 */
export function storyComplete(profile: Profile, sections: Record<string, number>) {
  const { checkpoints } = computeJourney(profile, sections, academicStarted(profile));
  return checkpoints.filter((c) => !AFTER_APPLY.includes(c.id)).every((c) => c.complete);
}

/**
 * Opening the Review & Apply planet from another stop:
 * - `revisit`: on Financial Aid after Apply is unlocked — show Counselor and Application assistant
 * - `locked`: earlier steps still open — Application Assistant stays unavailable
 */
export function reviewVisitKind(currentStage: CheckpointId, applyUnlocked: boolean): "revisit" | "locked" {
  return applyUnlocked && currentStage === "aid" ? "revisit" : "locked";
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
    // After admission offers, the last real step is accepting one: UC's Statement of Intent to Register.
    const sirDone = !!agentOf(profile).sirDoneAt;
    const sirDue = new Date(`${sirDeadlineDate(profile)}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" });
    return {
      id: sirDone ? "done-sir" : "done",
      checkpointId: "done",
      speaker: "sage",
      chapter: "Finish",
      prompt: sirDone
        ? hi("you've submitted your UC application, sorted out financial aid, and accepted your spot. Congratulations — you did the whole path!")
        : hi(`you've submitted your UC application and sorted out financial aid — that's the whole path! Next up: watch your email and keep your grades steady. Once offers come in, accept one by submitting your Statement of Intent to Register by ${sirDue}.`),
      choices: [
        sirDone
          ? { id: "sir-undo", label: "I haven't submitted my Intent to Register", effect: { type: "setSirDone", done: false } }
          : { id: "sir", label: "I submitted my Intent to Register", effect: { type: "setSirDone", done: true } },
        { id: "dates", label: "What dates are coming up?", effect: { type: "ask", mentorId: "sage", prompt: "Looking at my upcoming dates, what's next for me and when is each one due?" } },
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
    const turns = turnsFor(cp, profile, sections, hi, skipIds).filter((t) => !skipIds.has(t.id));
    if (turns.length) {
      const chapter = `${cp.short} · ${turns.length} question${turns.length === 1 ? "" : "s"} left`;
      return { ...turns[0], checkpointId: cp.id, chapter, finished: false };
    }
    // Review is finished by the counselor / application tools, not chat turns. If Applied is
    // checked but Counselor or UC account isn't, don't skip ahead to Financial Aid — that left
    // "questions left" on Aid while the map and chat stayed on Review.
    if (cp.id === "review") {
      const left = cp.tasks.filter((t) => !t.done).length;
      return {
        id: "review-tools",
        checkpointId: "review",
        speaker: "sage",
        chapter: `${cp.short} · ${left} task${left === 1 ? "" : "s"} left`,
        prompt: hi(
          "finish Review & Apply with the tools on the right — meet your virtual counselor, email your school counselor, and run the Application assistant until you've applied. The map moves on once those are checked off.",
        ),
        choices: [{ id: "manual", label: "Ask a guide a question instead", effect: { type: "focusChat" } }],
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

  if (cp.id === "activities" && !activitiesStatus(profile).answered) {
    const journey = journeyOf(profile);
    for (const section of ACTIVITY_SECTIONS.filter((s) => !activitySectionAnswered(profile, s.id))) {
      const { count } = activitySection(journey, section.id);
      const saveWhat = section.id === "job" ? (count === 1 ? "job" : "jobs") : section.id === "awards" ? "honors and awards" : section.id;
      out.push({
        id: section.turnId,
        speaker: "milo",
        prompt: hi(!count ? section.question : count >= 3 ? `${section.question} Add them in your profile.` : `${section.question} Answer Milo's questions in the chat, then hit Done.`),
        stackedChoices: true,
        choices: [
          ...[0, 1, 2, 3].map((n) => ({
            id: `count-${n}`,
            label: n === 3 ? "3+" : String(n),
            selected: count === n,
            effect: { type: "setActivityCount" as const, section: section.id, count: n },
          })),
          ...(count && count >= 3
            ? [{ id: "profile", label: "Go to Activities & awards", highlight: true, effect: { type: "fillInProfile" as const, section: section.id } }]
            : []),
          ...(count && count < 3 ? [{ id: "done", label: `Done — save my ${saveWhat}`, highlight: true, effect: { type: "finishActivities" as const, section: section.id } }] : []),
        ],
      });
    }
  }

  if (cp.id === "essays") {
    const j = journeyOf(profile);
    const chosen = Object.keys(j.piqs);
    if (chosen.length < PIQ_REQUIRED) {
      out.push({
        id: "pick-piq",
        speaker: "quill",
        prompt: hi("please choose 4 essay topics."),
        choices: [],
        piqPicker: true,
      });
    }

    // One essay at a time, in order. Once one is filled out, the next comes up. Skipped essays wait.
    const skipped = j.skippedPiqs ?? [];
    chosenPiqs(profile).forEach((piqId, i) => {
      const meta = PIQ_PROMPTS.find((q) => q.id === piqId);
      if (!meta || essayDone(profile, piqId) || skipped.includes(piqId)) return;
      out.push({
        id: `generate-${piqId}`,
        speaker: "quill",
        prompt: hi(`essay ${i + 1} of ${PIQ_REQUIRED}: ${meta.title}. Want me to write it?`),
        ...(essayNeedsFollowUp(profile, piqId) ? { note: `*Essay generation would improve with more information. Please select "${ADD_INFO_LABEL}" in the chat.` } : {}),
        choices: [
          { id: "generate", label: "Generate my essay", highlight: true, effect: { type: "generatePiqs", piqIds: [piqId] } },
          { id: "paste", label: "I already wrote my essay", effect: { type: "pasteEssay", piqId } },
          { id: "skip", label: "Skip this essay for now", effect: { type: "skipPiq", piqId } },
        ],
      });
    });
  }

  if (cp.id === "review") {
    // Counselor + Application assistant drive this stop (see ReviewPersonaPicker). Guided only
    // offers a manual "I submitted" fallback when the assistant hasn't finished PIQs yet.
    const j = journeyOf(profile);
    const applied = !!j.agent?.ucAccount?.piqAt || j.submittedAt !== null;
    if (!applied) {
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
    case "setActivityCount":
      // A new number restarts the chat, so anything saved from the last one goes with it.
      return { ...profile, ucJourney: withActivitySection(journeyOf(profile), effect.section, { count: effect.count }) };
    case "saveActivitySection": {
      const journey = journeyOf(profile);
      const { count } = activitySection(journey, effect.section);
      return {
        ...profile,
        ...(effect.section === "awards"
          ? { awards: mergeAwards(profile.awards, effect.items, newId) }
          : { activities: mergeActivities(profile.activities, effect.section, effect.items, newId) }),
        ucJourney: withActivitySection(journey, effect.section, { count, notes: effect.notes }),
      };
    }
    case "fillInProfile":
      return applyGuidedEffect(profile, { type: "saveActivitySection", section: effect.section, notes: "", items: [] }, newId);
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
      const prev = journeyOf(profile).piqs;
      const piqs: Record<string, "not-started" | "drafting" | "ready"> = {};
      for (const id of ids) piqs[id] = prev[id] ?? "not-started";
      return { ...profile, ucJourney: { ...journeyOf(profile), piqs } };
    }
    case "toggleCheck": {
      const cur = journeyOf(profile);
      const checks = { ...cur.checks };
      if (checks[effect.checkId]) delete checks[effect.checkId];
      else checks[effect.checkId] = true;
      return { ...profile, ucJourney: { ...cur, checks } };
    }
    case "markSubmitted":
      return { ...profile, ucJourney: { ...journeyOf(profile), submittedAt: Date.now() } };
    case "setSirDone":
      return setAgent(profile, (a) => ({ ...a, sirDoneAt: effect.done ? Date.now() : undefined }));
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

/** Adds what Milo heard to the list. Telling Milo about the same thing again updates its row instead of adding another. */
function mergeActivities(list: Profile["activities"], section: ActivitySectionId, items: ActivityItem[], newId: () => string): Profile["activities"] {
  const category = ACTIVITY_SECTIONS.find((s) => s.id === section)!.category;
  const key = (name: string) => name.trim().toLowerCase();
  return items.reduce((acts, item) => {
    const description = item.description.slice(0, ACTIVITY_DESC_LIMIT);
    const same = acts.find((a) => a.category === category && key(a.name) === key(item.name));
    if (same) {
      return acts.map((a) => (a === same ? { ...a, role: item.role || a.role, description: description || a.description } : a));
    }
    return [...acts, { id: newId(), name: item.name, role: item.role, hoursPerWeek: "", weeksPerYear: "", years: "", description, category }];
  }, list);
}

const AWARD_LEVELS: Award["level"][] = ["school", "regional", "state", "national", "international"];

/** Adds what Milo heard to the honors and awards list, updating an award already there. */
function mergeAwards(list: Award[], items: ActivityItem[], newId: () => string): Award[] {
  const key = (title: string) => title.trim().toLowerCase();
  return items.reduce((awards, item) => {
    const level = AWARD_LEVELS.find((l) => l === item.level) ?? "";
    const same = awards.find((a) => key(a.title) === key(item.name));
    if (same) return awards.map((a) => (a === same ? { ...a, level: level || a.level } : a));
    return [...awards, { id: newId(), title: item.name, level }];
  }, list);
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
    case "markSubmitted":
      return "Recorded your UC submission";
    case "setSirDone":
      return effect.done ? "Recorded your Intent to Register" : "Marked Intent to Register not done";
    case "setActivityCount":
      return null;
    case "saveActivitySection":
      if (!effect.items.length) return "Saved for your essays";
      return effect.section === "awards" ? "Added to your honors and awards" : "Added to your activities list";
    case "finishActivities":
      return null;
    case "setGoals":
      return effect.patch.intendedMajor ? `Saved your major: ${effect.patch.intendedMajor}` : "Saved to your profile";
    default:
      return "Saved to your profile";
  }
}
