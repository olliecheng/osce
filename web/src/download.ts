import { type CaseData, caseToMarkdown } from "./case";
import { applyChecked, indexListItems, sectionIndex } from "./checklist";
import { esc, mdSafe } from "./markdown";

const slug = (c: CaseData) =>
  (c.title || "case")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "case";

/**
 * Save the finished case as a PDF via the browser's print dialog (choose "Save as PDF").
 * Written feedback, if any, goes at the very top. Bullets the examiner marked off keep their grey strike-through, and flagged ones stay red, so candidates can see what they got.
 */
export function printCase(
  c: CaseData,
  checked: ReadonlySet<string>,
  flagged: ReadonlySet<string>,
  feedback = "",
) {
  document.getElementById("printRoot")?.remove();
  const root = document.createElement("article");
  root.id = "printRoot";
  const block = (cls: string, label: string, body: string) =>
    body ? `<div class="${cls}"><p class="lbl">${label}</p>${body}</div>` : "";
  root.innerHTML =
    `<h1>${esc(c.title || "Case")}</h1>` +
    block("pf", "Assessor feedback", feedback.trim() ? `<p>${esc(feedback)}</p>` : "") +
    block("pq", "Examiner asks", c.question ? `<p>${esc(c.question)}</p>` : "") +
    block("pa", "Model answer", c.answer ? `<div class="md">${mdSafe(c.answer)}</div>` : "") +
    block("ps", "Candidate instructions", c.intro ? `<p>${esc(c.intro)}</p>` : "") +
    `<div class="sections">${c.sections
      .map(
        (s) => `<section class="sec"><h2>${esc(s.title)}</h2><div class="md">${mdSafe(s.md)}</div></section>`,
      )
      .join("")}</div>`;
  indexListItems(root, sectionIndex);
  applyChecked(root, checked, flagged);
  document.body.append(root);

  const prevTitle = document.title;
  document.title = slug(c);
  const cleanup = () => {
    root.remove();
    document.title = prevTitle;
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}

/** Offer the case as a downloaded .md file. */
export function downloadCase(c: CaseData) {
  const name = slug(c);
  const url = URL.createObjectURL(new Blob([caseToMarkdown(c)], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.md`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
