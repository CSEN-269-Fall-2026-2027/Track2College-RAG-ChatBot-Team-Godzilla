import { COLLEGE_NAMES } from "../colleges";
import { PIQ_PROMPTS, journeyOf } from "../journey/logic";
import type { AidMode, Profile, ReviewMode, StoryMode } from "../types";
import type { Mentor } from "./characters";

export type OpenerAction =
  | { kind: "ask"; label: string; prompt: string }
  /** Saves the PIQ as chosen, then asks Quill to start on it. */
  | { kind: "pickPiq"; label: string; piqId: string; prompt: string }
  /** Opens one of the application tools (agent/tasks) inside the chat (Review & Apply). */
  | { kind: "tool"; label: string; tool: ReviewTool };

/** The application tools the Review & Apply personas offer in the chat. */
export type ReviewTool = "email" | "call" | "apply";

export interface Opener {
  text: string;
  actions: OpenerAction[];
}

const draftPrompt = (prompt: string) =>
  `Help me write my UC Personal Insight Question response for: "${prompt}" Start by asking me a few questions to find the right story, then help me outline and draft it (350 words max).`;

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
export function reviewModeLine(mode: ReviewMode, name: string): string {
  const hi = `Hey${name ? ` ${name}` : ""}!`;
  return mode === "counselor"
    ? `${hi} Want help sending an email to your school counselor? We'll find them first, then draft it together. Or you can meet with Jordan, your virtual counselor, on a video call.`
    : `${hi} Want help applying? I'll open the UC application and fill in what's in your profile. You can also ask me anything about the application.`;
}

/** The buttons under the Review & Apply persona's first message. */
export function reviewActions(mode: ReviewMode): OpenerAction[] {
  return mode === "counselor"
    ? [
        { kind: "tool", label: "Help me email my counselor", tool: "email" },
        { kind: "tool", label: "Meet with my virtual counselor", tool: "call" },
      ]
    : [{ kind: "tool", label: "Yes, help me apply", tool: "apply" }];
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
    return { text: reviewModeLine(mentor.id, name), actions: reviewActions(mentor.id) };
  }

  if (mentor.id === "quill") {
    const chosen = PIQ_PROMPTS.filter((q) => q.id in journeyOf(profile).piqs);
    if (!chosen.length) {
      return {
        text: `${hi} Before we write anything, let's pick a Personal Insight Question. You'll answer 4 of these 8 — which one do you want to start with?`,
        actions: PIQ_PROMPTS.map((q) => ({ kind: "pickPiq", label: q.title, piqId: q.id, prompt: draftPrompt(q.prompt) })),
      };
    }
    const titles = chosen.map((q) => q.title);
    const list = titles.length > 1 ? `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}` : titles[0];
    return {
      text: `${hi} You've picked ${list}. Which one should we work on writing today?`,
      actions: chosen.map((q) => ({ kind: "ask", label: `Write: ${q.title}`, prompt: draftPrompt(q.prompt) })),
    };
  }

  if (mentor.id === "theo") {
    const chosen = profile.colleges.map((c) => c.name).filter((n) => COLLEGE_NAMES.includes(n));
    const campusButtons: OpenerAction[] = COLLEGE_NAMES.map((n) => ({ kind: "ask", label: n, prompt: `What's special about ${n}? What sets it apart from the other UCs?` }));
    if (chosen.length > 1) {
      const list = `${chosen.slice(0, -1).join(", ")} and ${chosen[chosen.length - 1]}`;
      return {
        text: `${hi} You've got ${list} on your list. Want me to compare them, or tell you about another campus?`,
        actions: [{ kind: "ask", label: "Compare my campuses", prompt: `Compare ${list}. How do they feel different, and what is each known for?` }, ...campusButtons],
      };
    }
    return {
      text: `${hi} I'm Theo, and I've walked all nine UC campuses. Want the quick tour, or is there one you're curious about?`,
      actions: [{ kind: "ask", label: "Tell me about each UC", prompt: "Tell me a little about each UC campus." }, ...campusButtons],
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

  if (mentor.id === "milo" && !profile.goals.intendedMajor) {
    return {
      text: `${hi} Not sure what to major in yet? Tell me which classes or activities you enjoy, and I'll suggest a few majors to explore.`,
      actions: [],
    };
  }

  return { text: mentor.greeting(name), actions: [] };
}
