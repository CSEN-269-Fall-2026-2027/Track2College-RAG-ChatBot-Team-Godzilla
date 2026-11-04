import { Fragment, memo, type ReactNode } from "react";

type ListBlock = { type: "ul" | "ol"; items: string[] };
type Block = { type: "p"; lines: string[] } | { type: "heading"; text: string } | ListBlock;

const isList = (block: Block | null): block is ListBlock => block?.type === "ul" || block?.type === "ol";

// Links, bold, inline code, italics, and bare URLs. Models sometimes add more Markdown than asked;
// anything here renders, and the block rules below drop or convert the rest (---, #, tables, fences).
const INLINE_TOKEN =
  /(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|(?<![\w*])\*(?![\s*])[^*\n]+?(?<![\s*])\*(?![\w*])|(?<![\w_])_(?![\s_])[^_\n]+?(?<![\s_])_(?![\w_])|https?:\/\/[^\s<>()]+)/g;
const LINK = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/;
const BULLET = /^(?:•\s*|[-*–+]\s+)(.+)$/;
const NUMBERED = /^\d+[.)]\s+(.+)$/;
const RULE = /^(?:[-*_=]\s*){3,}$/;
const HASH_HEADING = /^#{1,6}\s+(.+?)\s*#*$/;
const TABLE_ROW = /^\|.*\|$/;
const TABLE_DIVIDER = /^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?$/;
const FENCE = /^(```|~~~)/;

function renderInline(text: string): ReactNode[] {
  return text
    .split(INLINE_TOKEN)
    .filter(Boolean)
    .map((part, i) => {
      const link = part.match(LINK);
      if (link) {
        return (
          <a key={i} href={link[2]} target="_blank" rel="noreferrer noopener">
            {link[1]}
          </a>
        );
      }
      if (part.length > 6 && part.startsWith("***") && part.endsWith("***")) {
        return (
          <strong key={i}>
            <em>{part.slice(3, -3)}</em>
          </strong>
        );
      }
      if (part.length > 4 && ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__")))) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        return <code key={i}>{part.slice(1, -1)}</code>;
      }
      if (part.length > 2 && ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_")))) {
        return <em key={i}>{part.slice(1, -1)}</em>;
      }
      if (/^https?:\/\//.test(part)) {
        const url = part.replace(/[.,;:!?]+$/, "");
        return (
          <Fragment key={i}>
            <a href={url} target="_blank" rel="noreferrer noopener">
              {url}
            </a>
            {part.slice(url.length)}
          </Fragment>
        );
      }
      return <Fragment key={i}>{part}</Fragment>;
    });
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (const raw of text.split("\n")) {
    let line = raw.trim();
    // Horizontal rules, code fences, and table dividers carry no text: they just end the block.
    if (!line || RULE.test(line) || FENCE.test(line) || TABLE_DIVIDER.test(line)) {
      current = null;
      continue;
    }
    line = line.replace(/^>\s?/, "");

    const hashHeading = line.match(HASH_HEADING);
    if (hashHeading) {
      blocks.push({ type: "heading", text: hashHeading[1].replace(/^\*\*(.+)\*\*$/, "$1") });
      current = null;
      continue;
    }

    // A table row becomes a bullet: "| UC Davis | Nov 30 |" → "UC Davis — Nov 30".
    if (TABLE_ROW.test(line)) {
      const cells = line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean);
      if (!cells.length) continue;
      line = `- ${cells.join(" — ")}`;
    }

    const bullet = line.match(BULLET);
    const numbered = bullet ? null : line.match(NUMBERED);
    const listType = bullet ? "ul" : numbered ? "ol" : null;

    if (listType) {
      let list: ListBlock | null = isList(current) && current.type === listType ? current : null;
      if (!list) {
        list = { type: listType, items: [] };
        blocks.push(list);
        current = list;
      }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }

    if (isList(current) && /^\s{2,}/.test(raw)) {
      current.items[current.items.length - 1] += ` ${line}`;
      continue;
    }

    if (line.endsWith(":") && line.length <= 70 && current?.type !== "p") {
      blocks.push({ type: "heading", text: line });
      current = null;
      continue;
    }

    if (current?.type === "p") {
      current.lines.push(line);
    } else {
      current = { type: "p", lines: [line] };
      blocks.push(current);
    }
  }

  return blocks;
}

/** Minimal, XSS-safe renderer for the plain-text formatting the advisor model produces. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="prose">
      {parseBlocks(text).map((block, i) => {
        switch (block.type) {
          case "heading":
            return (
              <p key={i} className="prose-heading">
                {renderInline(block.text)}
              </p>
            );
          case "ul":
          case "ol": {
            const List = block.type;
            return (
              <List key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </List>
            );
          }
          default:
            return (
              <p key={i}>
                {block.lines.map((line, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    {renderInline(line)}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
});
