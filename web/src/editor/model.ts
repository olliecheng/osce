// DOM-free conversion between case Markdown and the editor's document (ProseMirror JSON).
// The editor only allows `#` headers and bullets (bold/italic inline), so loading normalises other Markdown.
import { marked, type Token, type Tokens } from "marked";
import { type CaseData, caseToMarkdown, parseFrontMatter } from "../case";

export type Mark = { type: "bold" | "italic" };
export type PMNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: Mark[];
};
export type Doc = { type: "doc"; content: PMNode[] };
export type Fields = { title: string; intro: string; question: string; answer: string };
/** What loading had to change so the user can be told. */
export type LoadReport = { paragraphs: number; blocks: number; promoted: number };

export const emptyDoc = (): Doc => ({
  type: "doc",
  content: [heading("")],
});

const text = (t: string, marks: Mark[] = []): PMNode =>
  marks.length ? { type: "text", text: t, marks } : { type: "text", text: t };
const para = (nodes: PMNode[]): PMNode =>
  nodes.length ? { type: "paragraph", content: nodes } : { type: "paragraph" };
const item = (t: string, nested?: PMNode): PMNode => ({
  type: "listItem",
  content: [para(t ? [text(t)] : []), ...(nested ? [nested] : [])],
});
const list = (items: PMNode[]): PMNode => ({ type: "bulletList", content: items });
function heading(t: string): PMNode {
  const h: PMNode = { type: "heading", attrs: { level: 1 } };
  if (t) h.content = [text(t)];
  return h;
}

// ---------- Markdown -> doc ----------

function inline(tokens: Token[] | undefined, marks: Mark[] = []): PMNode[] {
  return mergeText(inlineRaw(tokens, marks));
}

/** Adjacent text nodes with identical marks become one node (as ProseMirror would do anyway). */
function mergeText(nodes: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (last && JSON.stringify(last.marks) === JSON.stringify(n.marks))
      last.text = (last.text ?? "") + (n.text ?? "");
    else out.push({ ...n });
  }
  return out;
}

function inlineRaw(tokens: Token[] | undefined, marks: Mark[]): PMNode[] {
  const out: PMNode[] = [];
  for (const t of tokens ?? []) {
    if (t.type === "strong") out.push(...inlineRaw((t as Tokens.Strong).tokens, withMark(marks, "bold")));
    else if (t.type === "em") out.push(...inlineRaw((t as Tokens.Em).tokens, withMark(marks, "italic")));
    else if (t.type === "escape") out.push(text((t as Tokens.Escape).text, marks));
    else if (t.type === "br") continue;
    else if (t.raw) out.push(text(t.raw.replace(/\n/g, " "), marks)); // text, codespan, link, ...: kept verbatim
  }
  return out;
}
const withMark = (marks: Mark[], type: Mark["type"]): Mark[] =>
  marks.some((m) => m.type === type) ? marks : [...marks, { type }];

type Counters = LoadReport;

/** Anything that is not a list: one bullet per non-empty source line. */
function linesToItems(raw: string): PMNode[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => item(l));
}

function listItems(tok: Tokens.List, n: Counters): PMNode[] {
  const out: PMNode[] = [];
  for (const it of tok.items) {
    let own: PMNode[] | null = null;
    let nested: PMNode[] = [];
    const extra: PMNode[] = [];
    for (const child of it.tokens) {
      if ((child.type === "text" || child.type === "paragraph") && own === null) {
        own = inline(
          (child as Tokens.Text).tokens ?? [{ type: "text", raw: child.raw, text: child.raw } as Token],
        );
      } else if (child.type === "list") {
        nested = nested.concat(listItems(child as Tokens.List, n));
      } else if (child.type === "space") {
      } else {
        n.blocks++;
        extra.push(...linesToItems(child.raw));
      }
    }
    out.push({
      type: "listItem",
      content: [para(own ?? []), ...(nested.length ? [list(nested)] : [])],
    });
    out.push(...extra);
  }
  return out;
}

export function textToDoc(src: string): { doc: Doc; report: LoadReport } {
  const report: Counters = { paragraphs: 0, blocks: 0, promoted: 0 };
  const { body } = parseFrontMatter(src);
  const tokens = marked.lexer(body);
  const minDepth = Math.min(
    7,
    ...tokens.filter((t) => t.type === "heading").map((t) => (t as Tokens.Heading).depth),
  );
  const content: PMNode[] = [];
  const push = (items: PMNode[]) => {
    if (!items.length) return;
    const last = content[content.length - 1];
    if (last?.type === "bulletList") last.content = [...(last.content ?? []), ...items];
    else content.push(list(items));
  };
  for (const t of tokens) {
    if (t.type === "heading") {
      const h = t as Tokens.Heading;
      if (h.depth > minDepth) report.promoted++;
      content.push(heading(h.text.trim()));
    } else if (t.type === "list") {
      if ((t as Tokens.List).ordered) report.blocks++;
      push(listItems(t as Tokens.List, report));
    } else if (t.type === "paragraph") {
      report.paragraphs++;
      push(paragraphItems(t as Tokens.Paragraph));
    } else if (t.type === "space" || t.type === "hr") {
    } else {
      report.blocks++;
      push(linesToItems(t.raw));
    }
  }
  return { doc: { type: "doc", content: content.length ? content : emptyDoc().content }, report };
}

/** A paragraph's source lines become separate bullets, keeping their bold/italic. */
function paragraphItems(p: Tokens.Paragraph): PMNode[] {
  const lines: PMNode[][] = [[]];
  for (const t of p.tokens ?? []) {
    if (t.type === "br") lines.push([]);
    else {
      const nodes = inline([t]);
      for (const nd of nodes) {
        const parts = (nd.text ?? "").split("\n");
        parts.forEach((part, i) => {
          if (i > 0) lines.push([]);
          if (part) lines[lines.length - 1].push({ ...nd, text: part });
        });
      }
    }
  }
  return lines
    .filter((l) => l.some((nd) => nd.text?.trim()))
    .map((l) => ({
      type: "listItem",
      content: [para(l)],
    }));
}

export function textToFields(src: string, sourceName = ""): Fields {
  const { meta } = parseFrontMatter(src);
  return {
    title: meta.title || (sourceName || "").replace(/\.(md|markdown|txt)$/i, ""),
    intro: meta.intro || meta.introduction || meta.stem || meta.intro_sentence || "",
    question: meta.question || meta.final_question || meta.examiner_question || "",
    answer: meta.answer || "",
  };
}

// ---------- doc -> Markdown ----------

/** Escape characters that would otherwise be read as emphasis, except inside code spans. */
function escapePlain(s: string): string {
  return s
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 ? part : part.replace(/[\\*_]/g, "\\$&")))
    .join("");
}

function escapeLead(s: string): string {
  return s.replace(/^([#>+-])/, "\\$1").replace(/^(\d+)([.)])/, "$1\\$2");
}

function serializeInline(nodes: PMNode[] | undefined): string {
  let out = "";
  const open: Mark["type"][] = []; // outermost first
  const close = (to: number) => {
    // Move trailing whitespace outside the closing markers: `**a **` does not parse.
    const ws = out.match(/\s*$/)?.[0] ?? "";
    out = out.slice(0, out.length - ws.length);
    while (open.length > to) out += open.pop() === "bold" ? "**" : "*";
    out += ws;
  };
  for (const nd of nodes ?? []) {
    const t = nd.text ?? "";
    if (!t) continue;
    const want = t.trim() ? (nd.marks ?? []).map((m) => m.type) : [];
    const wantOrdered = (["bold", "italic"] as const).filter((m) => want.includes(m));
    // Keep the longest prefix of open marks that is still wanted; close the rest.
    let keep = 0;
    while (keep < open.length && open[keep] === wantOrdered[keep]) keep++;
    close(keep);
    const opening = wantOrdered.slice(keep);
    const lead = opening.length ? (t.match(/^\s*/)?.[0] ?? "") : "";
    out += lead;
    for (const m of opening) {
      out += m === "bold" ? "**" : "*";
      open.push(m);
    }
    out += escapePlain(t.slice(lead.length));
  }
  close(0);
  return out;
}

function serializeList(l: PMNode, indent: string): string[] {
  const lines: string[] = [];
  for (const li of l.content ?? []) {
    const p = li.content?.find((c) => c.type === "paragraph");
    const nested = li.content?.find((c) => c.type === "bulletList");
    const body = serializeInline(p?.content).trim();
    const sub = nested ? serializeList(nested, `${indent}  `) : [];
    if (!body && !sub.length) continue;
    lines.push(`${indent}- ${escapeLead(body)}`.trimEnd());
    lines.push(...sub);
  }
  return lines;
}

const plain = (n: PMNode): string => (n.text ?? "") + (n.content ?? []).map(plain).join("");

export function docToCase(doc: Doc, f: Fields): CaseData {
  const sections: { title: string; lines: string[] }[] = [];
  for (const block of doc.content) {
    if (block.type === "heading") {
      sections.push({ title: plain(block).trim() || "Untitled", lines: [] });
    } else if (block.type === "bulletList") {
      if (!sections.length) sections.push({ title: "Notes", lines: [] });
      sections[sections.length - 1].lines.push(...serializeList(block, ""));
    }
  }
  return {
    title: f.title,
    intro: f.intro,
    question: f.question,
    answer: f.answer,
    sections: sections
      .filter((s) => s.title !== "Notes" || s.lines.length)
      .map((s) => ({ title: s.title, md: s.lines.join("\n") })),
  };
}

export const docToMarkdown = (doc: Doc, f: Fields): string => caseToMarkdown(docToCase(doc, f));
