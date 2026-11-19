import { virtualCounselorDone } from "../agent/callState";
import { agentOf } from "../agent/logic";
import { COLLEGE_NAMES } from "../colleges";
import { OTHER_MAJOR, UC_MAJORS } from "../constants";
import { activitiesStatus, journeyOf, PIQ_PROMPTS, PIQ_REQUIRED } from "../journey/logic";
import { autoPickPiqLabels, autoPickPiqs, chosenPiqs, essayDone, piqWorkOf } from "../journey/piqs";
import type { AidMode, Profile, ReviewMode, StoryMode } from "../types";
import { CAMPUS_BLURBS, CAMPUS_TOUR, WHAT_COUNTS_ANSWER } from "./campusBlurbs";
import type { Mentor } from "./characters";

export type OpenerAction =
  /** `prompt` goes to the model; the chat shows `display`, or the label if there's none. A fixed `answer` skips the model. */
  | { kind: "ask"; label: string; prompt: string; display?: string; answer?: string }
  /** Opens this section of the Profile page. */
  | { kind: "profile"; label: string; section: string }
  /** Quill asks its one question for this essay. */
  | { kind: "followUp"; label: string; piqId: string }
  /** Has Quill write this essay. */
  | { kind: "write"; label: string; piqId: string }
  /** Confirm Quill's four picks and draft them all. */
  | { kind: "confirmPiqs"; label: string; piqIds: string[] }
  /** Open the essay-topic picker to swap Quill's picks. */
  | { kind: "swapPiqs"; label: string }
  /** Draft the listed PIQs (after topics are already chosen). */
  | { kind: "draftPiqs"; label: string; piqIds: string[] }
  /** Milo: save all Google-scanned activities. */
  | { kind: "confirmGoogle"; label: string }
  /** Milo: skip Google suggestions and open Profile activities. */
  | { kind: "declineGoogle"; label: string }
  /** Opens one of the application tools (agent/tasks) inside the chat (Review & Apply). */
  | { kind: "tool"; label: string; tool: ReviewTool };

/** The application tools the Review & Apply personas offer in the chat. */
export type ReviewTool = "email" | "call" | "apply";

export interface Opener {
  text: string;
  actions: OpenerAction[];
}

/** True when the profile shows no sign the student has looked into paying for college yet. */
export function financesUnknown(p: Profile): boolean {
  const f = p.preferences;
  return (
    (f.needsAid === "" || f.needsAid === "unsure") &&
    (f.fafsa === "" || f.fafsa === "not-started") &&
    !f.maxAnnualCost.trim() &&
    (f.incomeRange === "" || f.incomeRange === "prefer-not")
  );
}

/** The first thing the Review & Apply persona says (its buttons stay under this message). */
export function reviewModeLine(mode: ReviewMode, name: string, callDone = true, emailDone = false): string {
  const hi = `Hey${name ? ` ${name}` : ""}!`;
  if (mode === "counselor") {
    if (!emailDone) {
      return `${hi} First we'll email your school counselor — I'll find them and draft the message. Then you'll meet Jordan, your virtual counselor.`;
    }
    if (!callDone) {
      return `${hi} Email's done. Next, meet with Jordan, your virtual counselor.`;
    }
    return `${hi} You've emailed your counselor and met Jordan. Switch to the Application assistant when you're ready to apply.`;
  }
  // Application assistant: email → virtual counselor → apply.
  if (!emailDone) {
    return `${hi} First email your school counselor (Counselor tab), then meet Jordan — then I can fill in your UC application.`;
  }
  return callDone
    ? `${hi} Want me to fill in your UC application from your profile? I'll work in the background unless you want to watch.`
    : `${hi} First finish a full meeting with Jordan, your virtual counselor — then I can fill in your UC application.`;
}

/** The buttons under the Review & Apply persona's first message. Forced order: email → call → apply. */
export function reviewActions(mode: ReviewMode, callDone = true, emailDone = false): OpenerAction[] {
  if (mode === "counselor") {
    if (!emailDone) return [{ kind: "tool", label: "Email my counselor", tool: "email" }];
    if (!callDone) return [{ kind: "tool", label: "Meet with my virtual counselor", tool: "call" }];
    return [
      { kind: "tool", label: "Email my counselor again", tool: "email" },
      { kind: "tool", label: "Meet with my virtual counselor again", tool: "call" },
    ];
  }
  if (!emailDone) return [{ kind: "tool", label: "Email my counselor first", tool: "email" }];
  return callDone
    ? [{ kind: "tool", label: "Yes, help me apply", tool: "apply" }]
    : [{ kind: "tool", label: "Meet with my virtual counselor", tool: "call" }];
}

/** What Penny says on Financial Aid, by the mode the student picked. */
export function aidModeLine(mode: AidMode, name: string): string {
  const hi = `Hey${name ? ` ${name}` : ""}!`;
  return mode === "fafsa"
    ? `${hi} Let's get your FAFSA (or California Dream Act Application) done. Tell me where you are with it, or pick an option on the left, and I'll walk you through it one step at a time.`
    : `${hi} Let's find you some scholarships. I'll use your profile to point you to ones you're likely to qualify for and help you plan your applications. Pick an option on the left or ask me anything.`;
}

/**
 * First thing a guide says in an empty Story chat, based on what the profile already shows.
 * `mode` is set when the chat is Penny's on Financial Aid. The Review & Apply personas
 * (Counselor, Application assistant) always open with their buttons.
 */
export function openerFor(mentor: Mentor, profile: Profile, name: string, mode?: StoryMode | null): Opener {
  const hi = `Hey${name ? ` ${name}` : ""}!`;

  if (mentor.id === "penny" && (mode === "fafsa" || mode === "scholarships")) {
    return {
      text: aidModeLine(mode, name),
      actions:
        mode === "fafsa"
          ? [
              { kind: "ask", label: "FAFSA or Dream Act?", prompt: "Should I file the FAFSA or the California Dream Act Application, and how do I get started?" },
              { kind: "ask", label: "What do I need to file?", prompt: "What documents and information do I need to complete the FAFSA, and when is it due?" },
            ]
          : [
              { kind: "ask", label: "Find scholarships for me", prompt: "Based on my profile, what kinds of scholarships am I likely to qualify for, and where should I look?" },
              { kind: "ask", label: "Help with a scholarship essay", prompt: "Can you help me write a scholarship essay? Start by asking me a few questions, and help me reuse stories from my Personal Insight answers." },
            ],
    };
  }

  if (mentor.id === "counselor" || mentor.id === "assistant") {
    const agent = agentOf(profile);
    const callDone = virtualCounselorDone(agent.counselorCall);
    const emailDone = !!agent.counselorEmail?.sentAt || !!agent.counselorEmail?.openedAt;
    return { text: reviewModeLine(mentor.id, name, callDone, emailDone), actions: reviewActions(mentor.id, callDone, emailDone) };
  }

  if (mentor.id === "quill") {
    const chosen = chosenPiqs(profile);
    const picking = !!journeyOf(profile).checks?.["choose-piqs"];
    if (chosen.length < PIQ_REQUIRED) {
      if (picking) {
        return {
          text: `${hi} Pick any four essay topics in the panel above.`,
          actions: [],
        };
      }
      const labels = autoPickPiqLabels(profile);
      const picks = labels.join("\n");
      const piqIds = autoPickPiqs(profile);
      return {
        text: `${hi} I'll be writing about these four essays:\n\n${picks}`,
        actions: [
          {
            kind: "ask",
            label: "Why?",
            prompt:
              `Why did you select these four essays for me?\n\nThe four you picked:\n${picks}\n\n` +
              "Explain briefly, in plain language, how they fit my activities and major.",
          },
          { kind: "confirmPiqs", label: "Sounds good", piqIds },
          { kind: "swapPiqs", label: "I want to swap" },
        ],
      };
    }

    const pending = chosen.filter((id) => !essayDone(profile, id));
    if (pending.length) {
      return {
        text: `${hi} I'll draft all four essays now — they'll land in Profile → Essays.`,
        actions: [{ kind: "draftPiqs", label: pending.length === PIQ_REQUIRED ? "Draft my essays" : "Finish drafting", piqIds: pending }],
      };
    }

    const written = chosen.flatMap((essayId) => {
      const q = PIQ_PROMPTS.find((x) => x.id === essayId);
      const text = piqWorkOf(profile, essayId).draft?.text.trim();
      return q && text ? [{ q, text }] : [];
    });
    return {
      text: `${hi} Your four essay drafts are ready. Would you like to add anything to the essays?`,
      actions: [
        {
          kind: "ask",
          label: "Yes, add something",
          prompt:
            "I'd like to add something to my essays. Ask me what I want to change or add, then help me revise.",
        },
        { kind: "profile", label: "Open essays in Profile", section: "essays" },
        ...written.map(({ q, text }) => ({
          kind: "ask" as const,
          label: `Analyze ${q.title}`,
          prompt: `Please analyze my essay about ${q.title}. The question is: ${q.prompt}\n\nMy essay:\n${text}`,
        })),
      ],
    };
  }

  if (mentor.id === "milo") {
    if (activitiesStatus(profile).done) {
      return {
        text: `${hi} Do you want to add more activities?`,
        actions: [
          { kind: "ask", label: "What counts as an activity?", prompt: "What counts as an activity on the UC application?", answer: WHAT_COUNTS_ANSWER },
          { kind: "profile", label: "Add an activity", section: "activities" },
        ],
      };
    }
    return {
      text: `${hi} I'm Milo — I'll help you build your activities list.`,
      actions: [
        { kind: "ask", label: "What counts as an activity?", prompt: "What counts as an activity on the UC application?", answer: WHAT_COUNTS_ANSWER },
        {
          kind: "ask",
          label: "How many should I list?",
          prompt: "How many activities should I list on the UC application, and what matters most to include?",
        },
        { kind: "profile", label: "Open activities in Profile", section: "activities" },
      ],
    };
  }

  if (mentor.id === "theo") {
    const chosen = profile.colleges.map((c) => c.name).filter((n) => COLLEGE_NAMES.includes(n));
    if (chosen.length) {
      const list = chosen.length > 1 ? `${chosen.slice(0, -1).join(", ")} and ${chosen[chosen.length - 1]}` : chosen[0];
      const major = profile.goals.intendedMajor;
      // Theo's chapter is finished: he offers the student's major at each of their schools.
      if (major) {
        const schools = `${chosen.length > 1 ? "your schools" : "your school"} (${list})`;
        const known = major !== OTHER_MAJOR;
        return {
          text: `${hi} Would you like to learn more about ${known ? major : "majors"} at ${schools}?`,
          actions: chosen.map((n) => ({
            kind: "ask",
            label: n,
            prompt: known ? `What's ${major} like at ${n}? What stands out about it there?` : `What majors stand out at ${n}?`,
          })),
        };
      }
      const where = chosen.length > 1 ? "each of these campuses" : "this campus";
      return {
        text: `${hi} You've got ${list} on your list. Would you like to learn more about a specific major at ${where}?`,
        actions: UC_MAJORS.map((m) => ({
          kind: "ask",
          label: m,
          prompt: `What's ${m} like at ${list}? What stands out at ${chosen.length > 1 ? "each one" : "this campus"}?`,
          display: `What's ${m} like at ${chosen.length > 1 ? "my campuses" : chosen[0]}?`,
        })),
      };
    }
    // Major often comes from onboarding before any campus is saved: bias the tour to that major.
    const major = profile.goals.intendedMajor;
    const knownMajor = !!major && major !== OTHER_MAJOR;
    const campusButtons: OpenerAction[] = COLLEGE_NAMES.map((n) =>
      knownMajor
        ? {
            kind: "ask" as const,
            label: n,
            prompt: `What's special about ${n} for someone interested in ${major}? Lead with what ${major} is like there (programs, strengths, how students in that field experience the campus), then add a little about the campus overall.`,
            display: `What's special about ${n}?`,
          }
        : {
            kind: "ask" as const,
            label: n,
            prompt: `What's special about ${n}? What sets it apart from the other UCs?`,
            display: `What's special about ${n}?`,
            answer: CAMPUS_BLURBS[n],
          },
    );
    const tour: OpenerAction = knownMajor
      ? {
          kind: "ask",
          label: "Tell me about each UC",
          prompt: `Tell me a little about each UC campus for someone interested in ${major}. For every campus, lead with what ${major} is like there, then one short line about the campus overall.`,
          display: "Tell me about each UC",
        }
      : { kind: "ask", label: "Tell me about each UC", prompt: "Tell me a little about each UC campus.", answer: CAMPUS_TOUR };
    return {
      text: knownMajor
        ? `${hi} I'm Theo, and I've walked all nine UC campuses. Want a quick tour for ${major}, or is there one campus you're curious about?`
        : `${hi} I'm Theo, and I've walked all nine UC campuses. Want the quick tour, or is there one you're curious about?`,
      actions: [tour, ...campusButtons],
    };
  }

  if (mentor.id === "penny" && financesUnknown(profile)) {
    return {
      text: `${hi} Paying for college can feel confusing — that's totally normal. Want me to walk you through how financial aid works, step by step?`,
      actions: [
        {
          kind: "ask",
          label: "Yes — explain financial aid basics",
          prompt: "I don't really know how paying for college works. Can you explain financial aid basics (FAFSA or CA Dream Act, Cal Grant, scholarships, and net cost) step by step?",
        },
      ],
    };
  }

  return { text: mentor.greeting(name), actions: [] };
}
