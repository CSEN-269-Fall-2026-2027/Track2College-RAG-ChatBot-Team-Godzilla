import { PIQ_PROMPTS, journeyOf } from "../journey/logic";
import type { Profile } from "../types";
import type { Mentor } from "./characters";

export type OpenerAction =
  | { kind: "ask"; label: string; prompt: string }
  /** Saves the PIQ as chosen, then asks Quill to start on it. */
  | { kind: "pickPiq"; label: string; piqId: string; prompt: string };

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

/** First thing a guide says in an empty Manual chat, based on what the profile already shows. */
export function openerFor(mentor: Mentor, profile: Profile, name: string): Opener {
  const hi = `Hey${name ? ` ${name}` : ""}!`;

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

  if (mentor.id === "milo" && !profile.goals.majors.length) {
    return {
      text: `${hi} Not sure what to major in yet? Tell me which classes or activities you enjoy, and I'll suggest a few majors to explore.`,
      actions: [],
    };
  }

  return { text: mentor.greeting(name), actions: [] };
}
