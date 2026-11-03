import { Marked, marked } from "marked";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

export const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"]/g, (c) => ESC[c]);

export function md(text: string | null | undefined): string {
  try {
    return marked.parse(text || "", { async: false }) as string;
  } catch {
    const e = (text || "").replace(/[&<>]/g, (c) => ESC[c]);
    return `<p style="white-space:pre-wrap">${e}</p>`;
  }
}

const SAFE_URL = /^(https?:|mailto:|#|\/)/i;
const safeMarked = new Marked({
  renderer: {
    html: ({ text }) => esc(text), // raw HTML is shown as text, never parsed
    link({ href, tokens }) {
      const inner = this.parser.parseInline(tokens);
      return SAFE_URL.test(href) ? `<a href="${esc(href)}" rel="noopener noreferrer">${inner}</a>` : inner;
    },
    image: ({ text }) => esc(text),
  },
});

/** Like `md`, for text that arrived over the network (display screens). */
export function mdSafe(text: string | null | undefined): string {
  try {
    return safeMarked.parse(text || "", { async: false }) as string;
  } catch {
    return `<p style="white-space:pre-wrap">${esc(text)}</p>`;
  }
}
