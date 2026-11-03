import { type CaseData, caseToMarkdown } from "./case";

/** Offer the case as a downloaded .md file. */
export function downloadCase(c: CaseData) {
  const name =
    (c.title || "case")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "case";
  const url = URL.createObjectURL(new Blob([caseToMarkdown(c)], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.md`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
