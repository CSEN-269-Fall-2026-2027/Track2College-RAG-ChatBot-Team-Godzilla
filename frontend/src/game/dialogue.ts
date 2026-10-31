/**
 * Turns one assistant answer into visual-novel "pages": short spoken lines for
 * the dialogue box, with bullet/numbered lists split out into a notebook card
 * (lists read badly when chopped up into speech).
 */
export interface DialoguePage {
  /** Plain text the character says (markdown emphasis stripped). */
  say: string;
  /** Markdown list shown on the notebook card alongside this line. */
  list?: string;
}

export const MAX_PAGE_CHARS = 240;

const LIST_ITEM = /^(?:•\s*|[-*–]\s+|\d+[.)]\s+)/;
const SENTENCE = /[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g;

/** Strips the markdown the dialogue box can't render inline. */
export function plainText(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitSentences(text: string): string[] {
  return (text.match(SENTENCE) ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/** Greedily packs sentences into pages of at most `max` characters (a longer sentence gets its own page). */
export function packSentences(sentences: string[], max = MAX_PAGE_CHARS): string[] {
  const pages: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + 1 + sentence.length > max) {
      pages.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) pages.push(current);
  return pages;
}

export function paginate(answer: string, max = MAX_PAGE_CHARS): DialoguePage[] {
  const lines = answer.replace(/\r\n/g, "\n").split("\n");
  const pages: DialoguePage[] = [];
  let prose: string[] = [];
  let list: string[] = [];

  const flushProse = () => {
    const text = plainText(prose.join(" "));
    prose = [];
    if (text) for (const say of packSentences(splitSentences(text), max)) pages.push({ say });
  };

  const flushList = () => {
    if (!list.length) return;
    // An intro line like "Here's what you need:" becomes the spoken part of the list page.
    const intro = pages.at(-1);
    const markdown = list.join("\n");
    list = [];
    if (intro && !intro.list && /:\s*$/.test(intro.say)) intro.list = markdown;
    else pages.push({ say: "Here's what to keep in mind:", list: markdown });
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (LIST_ITEM.test(line)) {
      flushProse();
      list.push(line);
    } else if (!line) {
      flushProse();
      flushList();
    } else if (list.length && /^\s{2,}/.test(raw)) {
      // Indented continuation of the previous list item.
      list[list.length - 1] += ` ${line}`;
    } else {
      flushList();
      prose.push(line);
    }
  }
  flushProse();
  flushList();

  return pages.length ? pages : [{ say: plainText(answer) || "…" }];
}
