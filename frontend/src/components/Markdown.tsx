import { Fragment, memo, type ReactNode } from "react";

type ListBlock = { type: "ul" | "ol"; items: string[] };
type Block = { type: "p"; lines: string[] } | { type: "heading"; text: string } | ListBlock;

const isList = (block: Block | null): block is ListBlock => block?.type === "ul" || block?.type === "ol";

const INLINE_TOKEN = /(\*\*[^*\n]+\*\*|https?:\/\/[^\s<>()]+)/g;
const BULLET = /^(?:•\s*|[-*–]\s+)(.+)$/;
const NUMBERED = /^\d+[.)]\s+(.+)$/;

function renderInline(text: string): ReactNode[] {
  return text
    .split(INLINE_TOKEN)
    .filter(Boolean)
    .map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
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
    const line = raw.trim();
    if (!line) {
      current = null;
      continue;
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

/** Minimal, XSS-safe renderer for the plain-text formatting the RAG model produces. */
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
