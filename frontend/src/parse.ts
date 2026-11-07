import type { Mood } from "./types";

export interface ParsedAnswer {
  answer: string;
  sources: string[];
  followups: string[];
  /** Answers to tap when the reply ends in a yes/no or pick-one question. */
  options: string[];
  mood?: Mood;
}

const MOODS: readonly Mood[] = ["neutral", "happy", "thinking", "concerned", "excited"];
const MOOD_LINE = /^\s*\**Mood\**\s*:\s*\**\s*([a-z]+)\**\s*$/gim;
/** The same tag stuck to the end of a sentence, sometimes with more text after it. */
const MOOD_INLINE = /(?<=[.?!:)*])[ \t]*\**Mood\**\s*:\s*\**\s*(neutral|happy|thinking|concerned|excited)\b\**[ \t]*/gi;

const OPTIONS_LINE = /^[ \t]*\**Options?\**[ \t]*:\**[ \t]*(.*\|.*)$/im;
/** Starts like a yes/no question, and doesn't ask for an explanation or offer a choice of its own. */
const YES_NO = /(?:^|[.!?]\s+)(?:do|does|did|are|is|was|were|have|has|would|should|will|can|could)\s[^.!?]*\?\s*$/i;
const NOT_YES_NO = /\b(?:or|tell|share|describe|explain|walk|give|name)\b/i;

function optionsFor(answer: string, listed?: string): string[] {
  if (listed) {
    const options = [...new Set(listed.split("|").map((o) => o.replace(/\*/g, "").trim()).filter(Boolean))];
    if (options.length >= 2 && options.length <= 6 && options.every((o) => o.length <= 40)) return options;
  }
  const yesNo = answer.match(YES_NO)?.[0];
  return yesNo && !NOT_YES_NO.test(yesNo) ? ["Yes", "No"] : [];
}

const FOLLOWUP_HEADER = /Follow-up Questions[^\n]*:/i;
const SOURCES_HEADER = /(^|\n)\s*Sources:/i;

function splitLines(block: string, prefix: RegExp): string[] {
  return block
    .split("\n")
    .map((line) => line.trim().replace(prefix, "").trim())
    .filter(Boolean);
}

/**
 * The backend returns one formatted string with "Answer:", "Sources:" and
 * "Follow-up Questions you might have:" sections. Out-of-scope replies have
 * no headers at all, so every section is optional.
 */
export function parseAssistantResponse(raw: string): ParsedAnswer {
  let text = raw.replace(/\r\n/g, "\n").trim();

  // Story mode adds a "Mood: <word>" line (leading from the backend, but models may put it anywhere).
  let mood: Mood | undefined;
  const readMood = (_: string, word: string) => {
    const candidate = word.toLowerCase() as Mood;
    if (MOODS.includes(candidate)) mood = candidate;
    return "";
  };
  text = text.replace(MOOD_LINE, readMood).replace(MOOD_INLINE, readMood).trim();

  const listed = text.match(OPTIONS_LINE)?.[1];
  text = text.replace(OPTIONS_LINE, "").trim();

  let followups: string[] = [];
  const followupIndex = text.search(FOLLOWUP_HEADER);
  if (followupIndex >= 0) {
    const block = text.slice(followupIndex).replace(FOLLOWUP_HEADER, "");
    followups = splitLines(block, /^(?:Q\d+[.):]?|[-•*]|\d+[.)])\s*/i);
    text = text.slice(0, followupIndex).trim();
  }

  let sources: string[] = [];
  const sourcesIndex = text.search(SOURCES_HEADER);
  if (sourcesIndex >= 0) {
    const block = text.slice(sourcesIndex).replace(/^\s*Sources:/i, "");
    sources = splitLines(block, /^[-•*]\s*/).filter((line) => !/^no relevant source/i.test(line));
    text = text.slice(0, sourcesIndex).trim();
  }

  const answer = text.replace(/^Answer:\s*/i, "").trim();
  return {
    answer,
    options: optionsFor(answer, listed),
    sources: [...new Set(sources)],
    followups: [...new Set(followups)],
    ...(mood ? { mood } : {}),
  };
}
