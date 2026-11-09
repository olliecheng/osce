import { describe, expect, it } from "vitest";
import { caseToMarkdown, parseCase } from "../../web/src/case";
import { docToCase, docToMarkdown, textToDoc, textToFields } from "../../web/src/editor/model";
import { TEMPLATE } from "../../web/src/host/content";

const roundTrip = (src: string) => {
  const { doc, report } = textToDoc(src);
  const f = textToFields(src, "x.md");
  return { md: docToMarkdown(doc, f), doc, report, fields: f };
};

describe("editor model", () => {
  it("round-trips the template without changing any section", () => {
    const before = parseCase(TEMPLATE, "t.md")!;
    const { md, report } = roundTrip(TEMPLATE);
    const after = parseCase(md, "t.md")!;
    expect(after.title).toBe(before.title);
    expect(after.intro).toBe(before.intro);
    expect(after.question).toBe(before.question);
    expect(after.answer).toBe(before.answer);
    expect(after.sections.map((s) => s.title)).toEqual(before.sections.map((s) => s.title));
    expect(after.sections.map((s) => s.md)).toEqual(before.sections.map((s) => s.md));
    expect(report).toEqual({ paragraphs: 0, blocks: 0, promoted: 0 });
  });

  it("is stable after one round trip", () => {
    const once = roundTrip(TEMPLATE).md;
    expect(roundTrip(once).md).toBe(once);
  });

  it("keeps bold, italic and nested bullets", () => {
    const src = "---\ntitle: T\n---\n\n## A\n- **bold** and *it* and ***both***\n  - nested **x**\n- plain\n";
    const { md } = roundTrip(src);
    expect(parseCase(md, "")!.sections[0].md).toBe(
      "- **bold** and *it* and ***both***\n  - nested **x**\n- plain",
    );
  });

  it("escapes literal emphasis characters", () => {
    const doc = {
      type: "doc" as const,
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "H" }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "a*b_c" }] }],
            },
          ],
        },
      ],
    };
    const md = docToMarkdown(doc, { title: "T", intro: "", question: "", answer: "" });
    expect(md).toContain("- a\\*b\\_c");
    expect(textToDoc(md).doc.content[1].content?.[0].content?.[0].content?.[0].text).toBe("a*b_c");
  });

  it("flattens all heading levels to sections and counts promoted sub-headings", () => {
    const src = "---\ntitle: T\n---\n\n# One\n- a\n### Sub\n- b\n#### Deep\n- c\n";
    const { md, report } = roundTrip(src);
    expect(parseCase(md, "")!.sections.map((s) => s.title)).toEqual(["One", "Sub", "Deep"]);
    expect(report.promoted).toBe(2);
  });

  it("normalises paragraphs and other blocks into bullets and reports them", () => {
    const src = "---\ntitle: T\n---\n\n## A\nline one\nline two\n\n```\ncode\n```\n\n1. first\n";
    const { md, report } = roundTrip(src);
    expect(report.paragraphs).toBe(1);
    expect(report.blocks).toBeGreaterThan(0);
    expect(
      parseCase(md, "")!
        .sections[0].md.split("\n")
        .every((l) => l.startsWith("- ")),
    ).toBe(true);
  });

  it("puts leading bullets in a Notes section and drops empty items", () => {
    const c = docToCase(textToDoc("- loose\n").doc, textToFields("", "n.md"));
    expect(c.sections).toEqual([{ title: "Notes", md: "- loose" }]);
    expect(caseToMarkdown(c)).toContain("# Notes");
  });
});
