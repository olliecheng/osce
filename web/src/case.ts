export type Section = { title: string; md: string };
export type CaseData = {
  title: string;
  intro: string;
  question: string;
  answer: string;
  sections: Section[];
};
export type FrontMatter = { meta: Record<string, string>; body: string };

export function parseFrontMatter(text: string): FrontMatter {
  text = text.replace(/^\uFEFF/, "");
  const m = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const km = lines[i].match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!km) continue;
    const key = km[1].toLowerCase().replace(/-/g, "_");
    let val = km[2].trim();
    if (/^[|>][-+]?$/.test(val)) {
      const fold = val[0] === ">";
      const buf: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) {
        buf.push(lines[++i].replace(/^\s+/, ""));
      }
      val = fold ? buf.join(" ").replace(/\s+/g, " ").trim() : buf.join("\n").trim();
    } else if (/^".*"$/.test(val)) {
      val = val.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    } else if (/^'.*'$/.test(val)) {
      val = val.slice(1, -1).replace(/''/g, "'");
    }
    meta[key] = val;
  }
  return { meta, body: text.slice(m[0].length) };
}

export function splitSections(body: string): Section[] {
  const lines = body.split(/\r?\n/);
  let inFence = false,
    minLevel = 7;
  const isHead: ({ level: number; title: string } | null)[] = [];
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) inFence = !inFence;
    const h = !inFence && l.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    isHead[i] = h ? { level: h[1].length, title: h[2] } : null;
    if (h && h[1].length < minLevel) minLevel = h[1].length;
  });
  if (minLevel === 7) return body.trim() ? [{ title: "Case", md: body.trim() }] : [];
  const sections: { title: string | null; buf: string[] }[] = [];
  let cur: { title: string | null; buf: string[] } = { title: null, buf: [] };
  lines.forEach((l, i) => {
    const h = isHead[i];
    if (h && h.level === minLevel) {
      if (cur.title !== null || cur.buf.join("").trim()) sections.push(cur);
      cur = { title: h.title, buf: [] };
    } else cur.buf.push(l);
  });
  sections.push(cur);
  return sections
    .map((s) => ({ title: s.title || "Notes", md: s.buf.join("\n").trim() }))
    .filter((s) => s.title !== "Notes" || s.md);
}

/** Build a case from file text. Returns null when it has no front matter or headings. */
export function parseCase(text: string, sourceName: string): CaseData | null {
  const { meta, body } = parseFrontMatter(text);
  const intro = meta.intro || meta.introduction || meta.stem || meta.intro_sentence || "";
  const question = meta.question || meta.final_question || meta.examiner_question || "";
  const sections = splitSections(body);
  if (!sections.length && !intro && !question) return null;
  const title = meta.title || (sourceName || "Case").replace(/\.(md|markdown|txt)$/i, "");
  return { title, intro, question, answer: meta.answer || "", sections };
}
