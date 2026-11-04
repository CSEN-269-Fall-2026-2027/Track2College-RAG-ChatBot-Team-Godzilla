import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../components/Markdown";

const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

describe("chat Markdown", () => {
  it("drops horizontal rules and code fences instead of showing them", () => {
    const out = html("First part.\n\n---\n\nSecond part.\n```\nnpm run dev\n```");
    expect(out).not.toContain("---");
    expect(out).not.toContain("```");
    expect(out).toContain("<p>First part.</p>");
    expect(out).toContain("<p>Second part.</p>");
  });

  it("turns # headings into section labels", () => {
    expect(html("## Next steps\n- File FAFSA")).toBe('<div class="prose"><p class="prose-heading">Next steps</p><ul><li>File FAFSA</li></ul></div>');
  });

  it("renders tables as bullets", () => {
    const out = html("| Campus | Deadline |\n|---|---|\n| UC Davis | Nov 30 |");
    expect(out).toContain("<li>UC Davis — Nov 30</li>");
    expect(out).not.toContain("|");
  });

  it("renders links, italics, and inline code", () => {
    const out = html("See [UC Admissions](https://admission.universityofcalifornia.edu) for *official* dates, or run `npm test`.");
    expect(out).toContain('<a href="https://admission.universityofcalifornia.edu" target="_blank" rel="noreferrer noopener">UC Admissions</a>');
    expect(out).toContain("<em>official</em>");
    expect(out).toContain("<code>npm test</code>");
  });

  it("leaves snake_case words and lone asterisks alone", () => {
    const out = html("Use my_profile_name and 5 * 3 = 15.");
    expect(out).not.toContain("<em>");
  });
});
