import type { Mood } from "./types";

export interface ParsedAnswer {
  answer: string;
  sources: string[];
  followups: string[];
  mood?: Mood;
}

const MOODS: readonly Mood[] = ["neutral", "happy", "thinking", "concerned", "excited"];
const MOOD_LINE = /^\s*\**Mood\**\s*:\s*\**\s*([a-z]+)\**\s*$/gim;

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
  text = text
    .replace(MOOD_LINE, (_, word: string) => {
      const candidate = word.toLowerCase() as Mood;
      if (MOODS.includes(candidate)) mood = candidate;
      return "";
    })
    .trim();

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

  return {
    answer: text.replace(/^Answer:\s*/i, "").trim(),
    sources: [...new Set(sources)],
    followups: [...new Set(followups)],
    ...(mood ? { mood } : {}),
  };
}
