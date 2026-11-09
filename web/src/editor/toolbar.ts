import type { Editor } from "@tiptap/core";
import { toBody, toHeader } from "./blocks";

export type ToolbarActions = { save: () => void; load: (file: File) => void; help: () => void };

const btn = (id: string, label: string, cls = "btn") =>
  `<button class="${cls}" id="${id}" type="button">${label}</button>`;

export function mountToolbar(root: HTMLElement, getEditor: () => Editor, a: ToolbarActions) {
  root.innerHTML = `
    <div class="ed-bar" role="toolbar" aria-label="Editor toolbar">
      ${btn("tbSave", "Save", "btn primary")}
      ${btn("tbLoad", "Load")}
      <input type="file" id="tbFile" accept=".md,.markdown,.txt,text/markdown,text/plain" class="hidden">
      <span class="ed-sep" aria-hidden="true"></span>
      <label class="ed-style">Style
        <select id="tbStyle" aria-label="Text style"><option value="body">Body</option><option value="header">Header</option></select>
      </label>
      <button class="btn ed-fmt" id="tbBold" type="button" aria-label="Bold" aria-pressed="false"><b>B</b></button>
      <button class="btn ed-fmt" id="tbItalic" type="button" aria-label="Italic" aria-pressed="false"><i>I</i></button>
      <span class="ed-spacer"></span>
      ${btn("tbHelp", "How to write a case", "btn quiet")}
    </div>`;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`) as T;
  const file = $<HTMLInputElement>("tbFile");
  $("tbSave").addEventListener("click", a.save);
  $("tbLoad").addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    file.value = "";
    if (f) a.load(f);
  });
  $("tbHelp").addEventListener("click", a.help);
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
