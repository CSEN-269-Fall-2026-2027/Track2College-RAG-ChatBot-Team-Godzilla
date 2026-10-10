export interface ParsedAnswer {
  answer: string;
  sources: string[];
  followups: string[];
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
  };
}
