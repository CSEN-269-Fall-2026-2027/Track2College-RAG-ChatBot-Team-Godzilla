import type { ActivitySectionId, Message } from "../types";
import { ACTIVITY_SECTIONS } from "./logic";
import { activityReportMessage } from "./piqs";

/**
 * Milo's questions are the same for every student, so they're written here and cost no model
 * tokens. The model only steps in when the student asks a question of their own.
 */
export interface MiloLine {
  content: string;
  options?: string[];
}

const SKIP = " You can skip this if you want.";
const KINDS: Record<string, string> = { sport: "sport", club: "club", band: "band or group" };
const KIND_OPTIONS = ["Sport", "Club", "Band"];
const CLOSING = "That's everything I need. Hit Done to save it.";

function firstQuestion(section: ActivitySectionId, item: number, kind: string | null): string {
  if (section === "volunteering") return item ? "Where else do you volunteer, and what do you do there?" : "Where do you volunteer, and what do you do there?";
  if (section === "job") return item ? "Where's your other job, and what do you do there?" : "Where do you work, and what's your job there?";
  if (section === "awards") return item ? "What's your other honor or award called?" : "What's the honor or award called?";
  return `What's the ${kind ?? "activity"}, and what's your role?`;
}

function detailQuestion(section: ActivitySectionId): string {
  if (section === "volunteering") return `What's a moment from volunteering there that you remember?${SKIP}`;
  if (section === "awards") return `What level was it (school, regional, state, national, or international), and what did you do to earn it?${SKIP}`;
  return `What did you do in this role, and is there a moment you remember?${SKIP}`;
}

/** Which section and how many this chat is about, from its opening message. */
function reportIn(first: Message | undefined): { section: ActivitySectionId; count: number } | null {
  if (first?.role !== "user") return null;
  for (const { id } of ACTIVITY_SECTIONS) {
    for (const count of [1, 2]) {
      if (first.content === activityReportMessage(id, count)) return { section: id, count };
    }
  }
  return null;
}

/** Milo's next line, or null when the model should answer (a question of their own, or the script is over). */
export function miloNextLine(messages: Message[]): MiloLine | null {
  const report = reportIn(messages[0]);
  const last = messages.at(-1);
  if (!report || last?.role !== "user" || (messages.length > 1 && last.content.trim().endsWith("?"))) return null;

  const { section, count } = report;
  const answers = messages.slice(1).filter((m) => m.role === "user" && !m.content.trim().endsWith("?"));
  let item = 0;
  let step: "kind" | "first" | "detail" = section === "activities" ? "kind" : "first";
  let kind: string | null = null;
  for (const answer of answers) {
    if (item >= count) return null;
    if (step === "kind") {
      const word = answer.content.trim().toLowerCase();
      if (KINDS[word] || word === "something else") {
        kind = KINDS[word] ?? null;
        step = "first";
      } else {
        // They typed the activity itself, so its first question is already answered.
        step = "detail";
      }
    } else if (step === "first") {
      step = "detail";
    } else {
      item += 1;
      kind = null;
      step = section === "activities" ? "kind" : "first";
    }
  }
  if (item >= count) return { content: CLOSING };
  if (step === "kind") return { content: item ? "Do you want to add another sport, club, or band?" : "Do you want to add a sport, club, or band?", options: KIND_OPTIONS };
  return { content: step === "first" ? firstQuestion(section, item, kind) : detailQuestion(section) };
}
