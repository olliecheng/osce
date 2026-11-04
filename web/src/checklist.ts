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

export function applyChecked(root: ParentNode, checked: ReadonlySet<string>, flagged: ReadonlySet<string>) {
  root.querySelectorAll<HTMLElement>("li[data-li]").forEach((li) => paint(li, checked, flagged));
}

function paint(li: HTMLElement, checked: ReadonlySet<string>, flagged: ReadonlySet<string>) {
  const key = li.dataset.li as string;
  li.classList.toggle("done", checked.has(key));
  li.classList.toggle("flag", flagged.has(key));
}

/** Index by the section's position among its siblings. */
export const sectionIndex = (sec: HTMLElement) =>
  Array.prototype.indexOf.call(sec.parentElement?.children ?? [], sec);

/**
 * Click an <li> inside `root` to toggle its grey strike-through; right-click to toggle red. The two
 * marks are mutually exclusive, so left-clicking a red bullet turns it grey. `enabled` gates it per event.
 */
export function wireChecklist(
  root: HTMLElement,
  checked: Set<string>,
  flagged: Set<string>,
  enabled: () => boolean,
) {
  const target = (e: Event) => {
    if (!enabled()) return null;
    const li = (e.target as HTMLElement).closest<HTMLElement>("li[data-li]");
    return li && root.contains(li) ? li : null;
  };
  root.addEventListener("click", (e) => {
    const li = target(e);
    if (!li) return;
    const key = li.dataset.li as string;
    if (flagged.delete(key)) checked.add(key);
    else if (!checked.delete(key)) checked.add(key);
    paint(li, checked, flagged);
  });
  root.addEventListener("contextmenu", (e) => {
    const li = target(e);
    if (!li) return;
    e.preventDefault();
    const key = li.dataset.li as string;
    checked.delete(key);
    if (!flagged.delete(key)) flagged.add(key);
    paint(li, checked, flagged);
  });
}
