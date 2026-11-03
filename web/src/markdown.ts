import { marked } from "marked";

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
