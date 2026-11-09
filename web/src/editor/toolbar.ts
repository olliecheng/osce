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
      <span class="ed-menu-wrap">
        <button class="btn primary" id="tbSave" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="tbSaveMenu">Export <span aria-hidden="true">▾</span></button>
        <div class="ed-menu hidden" id="tbSaveMenu" role="menu">
          <button class="btn" id="tbSaveMd" type="button" role="menuitem">Export as .md</button>
          <button class="btn" id="tbSavePdf" type="button" role="menuitem">Export as PDF</button>
        </div>
      </span>
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
      ${btn("tbLlm", "Use LLM", "btn quiet")}
    </div>`;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`) as T;
  const file = $<HTMLInputElement>("tbFile");
  // Two dropdown menus (Export, Load); opening one closes the other, Escape or an outside click closes both.
  const menus = [
    { trigger: $("tbSave"), menu: $("tbSaveMenu") },
    { trigger: $("tbLoad"), menu: $("tbMenu") },
  ];
  const setMenu = (m: (typeof menus)[number] | null, open: boolean) => {
    for (const x of menus) {
      const on = open && x === m;
      x.menu.classList.toggle("hidden", !on);
      x.trigger.setAttribute("aria-expanded", String(on));
    }
  };
  for (const m of menus) {
    m.trigger.addEventListener("click", () => setMenu(m, m.menu.classList.contains("hidden")));
  }
  const pick = (id: string, fn: () => void) =>
    $(id).addEventListener("click", () => {
      setMenu(null, false);
      fn();
    });
  pick("tbSaveMd", a.save);
  pick("tbSavePdf", a.pdf);
  pick("tbLoadFile", () => file.click());
  pick("tbLoadClip", a.paste);
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".ed-menu-wrap")) setMenu(null, false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setMenu(null, false);
  });
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    file.value = "";
    if (f) a.load(f);
  });
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
