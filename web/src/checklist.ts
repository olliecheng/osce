/**
 * Marking off dot points. Bullets are plain <li> in rendered Markdown, so each one is keyed by
 * "<section>:<n>", where n is its position among the section's <li> elements. Host and viewer render
 * identical Markdown, so the keys line up.
 */

/** Give every <li> under each `.sec` a data-li key. */
export function indexListItems(root: ParentNode, sectionIdOf: (sec: HTMLElement) => number) {
  root.querySelectorAll<HTMLElement>(".sec").forEach((sec) => {
    const s = sectionIdOf(sec);
    sec.querySelectorAll<HTMLElement>("li").forEach((li, i) => {
      li.dataset.li = `${s}:${i}`;
    });
  });
}

export function applyChecked(root: ParentNode, checked: ReadonlySet<string>) {
  root.querySelectorAll<HTMLElement>("li[data-li]").forEach((li) => {
    li.classList.toggle("done", checked.has(li.dataset.li as string));
  });
}

/** Index by the section's position among its siblings. */
export const sectionIndex = (sec: HTMLElement) =>
  Array.prototype.indexOf.call(sec.parentElement?.children ?? [], sec);

/** Click an <li> inside `root` to toggle its mark (innermost item). `enabled` gates it per click. */
export function wireChecklist(root: HTMLElement, checked: Set<string>, enabled: () => boolean) {
  root.addEventListener("click", (e) => {
    if (!enabled()) return;
    const li = (e.target as HTMLElement).closest<HTMLElement>("li[data-li]");
    if (!li || !root.contains(li)) return;
    const key = li.dataset.li as string;
    if (checked.has(key)) checked.delete(key);
    else checked.add(key);
    li.classList.toggle("done", checked.has(key));
  });
}
