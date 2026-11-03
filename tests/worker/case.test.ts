import { describe, expect, it } from "vitest";
import { parseCase, parseFrontMatter, splitSections } from "../../web/src/case";
import { TEMPLATE } from "../../web/src/host/content";

describe("parseFrontMatter", () => {
  it("parses the example case front matter, including a | block", () => {
    const { meta, body } = parseFrontMatter(TEMPLATE);
    expect(meta.title).toBe("Chest pain in a 62-year-old man");
    expect(meta.intro).toMatch(/^You are a medical student/);
    expect(meta.question).toMatch(/most likely diagnosis/);
    expect(meta.answer).toBe(
      "Most likely: acute coronary syndrome (unstable angina / NSTEMI).\nDifferentials: aortic dissection, pulmonary embolism, pericarditis, GORD.",
    );
    expect(body.startsWith("\n## Introduction")).toBe(true);
  });
  it("returns the text untouched without front matter, and strips a BOM", () => {
    expect(parseFrontMatter("## A\nx")).toEqual({ meta: {}, body: "## A\nx" });
    expect(parseFrontMatter("﻿---\nintro: hi\n---\nbody").meta.intro).toBe("hi");
  });
  it("handles single quotes, escapes and folded values", () => {
    const { meta } = parseFrontMatter("---\na: 'it''s'\nb: \"x\\ny\"\nc: >\n  one\n  two\n---\n");
    expect(meta).toEqual({ a: "it's", b: "x\ny", c: "one two" });
  });
});

describe("splitSections", () => {
  it("splits the example into its ## sections", () => {
    const sections = splitSections(parseFrontMatter(TEMPLATE).body);
    expect(sections.map((s) => s.title)).toEqual([
      "Introduction",
      "Presenting complaint",
      "History of presenting complaint",
      "Systems review",
      "PMHx",
      "Medications",
      "Allergies",
      "FHx",
      "SHx",
      "ICE",
      "Role-player notes",
    ]);
    expect(sections[0].md).toContain("Peter Walsh");
  });
  it("keeps ### sub-headings inside their section and ignores headings in code fences", () => {
    const s = splitSections("## A\n### sub\ntext\n```\n## not a heading\n```\n## B\nb");
    expect(s.map((x) => x.title)).toEqual(["A", "B"]);
    expect(s[0].md).toContain("### sub");
    expect(s[0].md).toContain("## not a heading");
  });
  it("wraps heading-less bodies in a single section", () => {
    expect(splitSections("just text")).toEqual([{ title: "Case", md: "just text" }]);
  });
});

describe("parseCase", () => {
  it("builds the example case", () => {
    const c = parseCase(TEMPLATE, "example.md");
    expect(c?.title).toBe("Chest pain in a 62-year-old man");
    expect(c?.sections).toHaveLength(11);
    expect(c?.question).toBeTruthy();
  });
  it("rejects empty input and derives the title from the file name", () => {
    expect(parseCase("", "x.md")).toBeNull();
    expect(parseCase("---\nintro: hi\n---\n", "my-case.md")?.title).toBe("my-case");
  });
});
