import type { Editor } from "@tiptap/core";
import { toBody, toHeader } from "./blocks";

export type ToolbarActions = {
  save: () => void;
  load: (file: File) => void;
  paste: () => void;
  pdf: () => void;
  llm: () => void;
};

const btn = (id: string, label: string, cls = "btn") =>
  `<button class="${cls}" id="${id}" type="button">${label}</button>`;

export function mountToolbar(root: HTMLElement, getEditor: () => Editor, a: ToolbarActions) {
  root.innerHTML = `
    <div class="ed-bar" role="toolbar" aria-label="Editor toolbar">
      ${btn("tbSave", "Save", "btn primary")}
      <span class="ed-menu-wrap">
        <button class="btn" id="tbLoad" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="tbMenu">Load <span aria-hidden="true">▾</span></button>
        <div class="ed-menu hidden" id="tbMenu" role="menu">
          <button class="btn" id="tbLoadFile" type="button" role="menuitem">Load from file</button>
          <button class="btn" id="tbLoadClip" type="button" role="menuitem">Load from clipboard</button>
        </div>
      </span>
      <input type="file" id="tbFile" accept=".md,.markdown,.txt,text/markdown,text/plain" class="hidden">
      <span class="ed-sep" aria-hidden="true"></span>
      <label class="ed-style">Style
        <span class="ed-select"><select id="tbStyle" aria-label="Text style"><option value="body">Body</option><option value="header">Header</option></select></span>
      </label>
      <button class="btn ed-fmt" id="tbBold" type="button" aria-label="Bold" aria-pressed="false"><b>B</b></button>
      <button class="btn ed-fmt" id="tbItalic" type="button" aria-label="Italic" aria-pressed="false"><i>I</i></button>
      <span class="ed-spacer"></span>
      ${btn("tbPdf", "Save as PDF", "btn quiet")}
      ${btn("tbLlm", "Use LLM", "btn quiet")}
    </div>`;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`) as T;
  const file = $<HTMLInputElement>("tbFile");
  $("tbSave").addEventListener("click", a.save);
  const menu = $("tbMenu");
  const setMenu = (open: boolean) => {
    menu.classList.toggle("hidden", !open);
    $("tbLoad").setAttribute("aria-expanded", String(open));
  };
  $("tbLoad").addEventListener("click", () => setMenu(menu.classList.contains("hidden")));
  $("tbLoadFile").addEventListener("click", () => {
    setMenu(false);
    file.click();
  });
  $("tbLoadClip").addEventListener("click", () => {
    setMenu(false);
    a.paste();
  });
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".ed-menu-wrap")) setMenu(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setMenu(false);
  });
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    file.value = "";
    if (f) a.load(f);
  });
  $("tbPdf").addEventListener("click", a.pdf);
  $("tbLlm").addEventListener("click", a.llm);
  $<HTMLSelectElement>("tbStyle").addEventListener("change", (e) => {
    const v = (e.target as HTMLSelectElement).value;
    if (v === "header") toHeader(getEditor());
    else toBody(getEditor());
    sync();
  });
  // Keep the editor selection when a toolbar button is pressed.
  root.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).closest("button")) e.preventDefault();
  });
  $("tbBold").addEventListener("click", () => getEditor().chain().focus().toggleBold().run());
  $("tbItalic").addEventListener("click", () => getEditor().chain().focus().toggleItalic().run());
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      a.save();
    }
  });

  function sync() {
    const ed = getEditor();
    const inHeader = ed.state.selection.$from.parent.type.name === "heading";
    $<HTMLSelectElement>("tbStyle").value = inHeader ? "header" : "body";
    for (const [id, mark] of [
      ["tbBold", "bold"],
      ["tbItalic", "italic"],
    ] as const) {
      const b = $<HTMLButtonElement>(id);
      b.setAttribute("aria-pressed", String(ed.isActive(mark)));
      b.classList.toggle("on", ed.isActive(mark));
      b.disabled = inHeader;
    }
  }
  return { sync };
}
