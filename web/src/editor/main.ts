import { Editor } from "@tiptap/core";
import { downloadCase } from "../download";
import {
  docToCase,
  docToMarkdown,
  emptyDoc,
  type Fields,
  type LoadReport,
  textToDoc,
  textToFields,
} from "./model";
import "../styles.css";
import "./editor.css";
import { mountLlm } from "./llm";
import { mountPaste } from "./paste";
import { docJSON, extensions } from "./schema";
import { mountToolbar } from "./toolbar";

// The host page keeps its last case under this key; both pages watch it, which is how they share state.
const KEY = "osce-last-case";
const FIELD_IDS = ["title", "intro", "question", "answer"] as const;

const root = document.getElementById("editorRoot") as HTMLElement;
root.innerHTML = `
  <div id="edToolbar"></div>
  <p class="ed-notice hidden" id="edNotice" role="status"><span id="edNoticeText"></span><button class="btn quiet" id="edNoticeClose" type="button">Dismiss</button></p>
  <section class="ed-llm hidden" id="edLlm" aria-labelledby="llmTitle"></section>
  <section class="ed-fields" aria-label="Case details">
    <label>Title<input id="fTitle" autocomplete="off" spellcheck="false"></label>
    <label>Intro (read by the candidate at the door)<textarea id="fIntro" rows="2"></textarea></label>
    <label>Examiner question<textarea id="fQuestion" rows="2"></textarea></label>
    <label>Model answer<textarea id="fAnswer" rows="3"></textarea></label>
  </section>
  <div class="ed-surface" id="edSurface" aria-label="Case body"></div>`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const inputs = {
  title: $<HTMLInputElement>("fTitle"),
  intro: $<HTMLTextAreaElement>("fIntro"),
  question: $<HTMLTextAreaElement>("fQuestion"),
  answer: $<HTMLTextAreaElement>("fAnswer"),
};

const readFields = (): Fields => ({
  title: inputs.title.value.trim(),
  intro: inputs.intro.value.trim(),
  question: inputs.question.value.trim(),
  answer: inputs.answer.value.trim(),
});
const writeFields = (f: Fields) => {
  for (const k of FIELD_IDS) inputs[k].value = f[k];
};

let lastText = ""; // the last Markdown this page wrote to, or read from, storage

function setNotice(r: LoadReport | null) {
  const parts: string[] = [];
  if (r?.paragraphs)
    parts.push(`${r.paragraphs} paragraph${r.paragraphs === 1 ? "" : "s"} turned into bullets`);
  if (r?.blocks)
    parts.push(
      `${r.blocks} other block${r.blocks === 1 ? "" : "s"} (code, tables, quotes, numbered lists) turned into bullets`,
    );
  if (r?.promoted)
    parts.push(
      `${r.promoted} sub-heading${r.promoted === 1 ? "" : "s"} promoted to their own section${r.promoted === 1 ? "" : "s"}`,
    );
  $("edNotice").classList.toggle("hidden", !parts.length);
  $("edNoticeText").textContent = parts.length
    ? `This file was adjusted to fit the editor: ${parts.join("; ")}.`
    : "";
}
$("edNoticeClose").addEventListener("click", () => setNotice(null));

function persist() {
  const text = docToMarkdown(docJSON(editor), readFields());
  if (text === lastText) return;
  lastText = text;
  const sourceName = `${readFields().title || "case"}.md`;
  try {
    localStorage.setItem(KEY, JSON.stringify({ text, sourceName }));
  } catch {}
}
let timer: number | undefined;
const schedule = () => {
  clearTimeout(timer);
  timer = window.setTimeout(persist, 300);
};

/** Put Markdown into the fields and the editor without treating it as a user edit. */
function show(text: string, sourceName: string) {
  const { doc, report } = textToDoc(text);
  writeFields(textToFields(text, sourceName));
  editor.commands.setContent(doc, { emitUpdate: false });
  setNotice(report);
  toolbar.sync();
}

function loadText(text: string, name: string) {
  show(text, name);
  clearTimeout(timer);
  lastText = ""; // force a write so the station page picks it up
  persist();
  llm.setOpen(false);
}
const loadFile = async (f: File) => loadText(await f.text(), f.name);

const editor = new Editor({
  element: $("edSurface"),
  extensions,
  content: emptyDoc(),
  editorProps: { attributes: { class: "ed-doc", "aria-label": "Case body", spellcheck: "true" } },
  onUpdate: schedule,
  onSelectionUpdate: () => toolbar.sync(),
  onTransaction: () => toolbar.sync(),
});

const paste = mountPaste((text) => loadText(text, "pasted.md"));
// While the agent panel is open the editor is hidden; a successful load (or Close) brings it back.
const llm = mountLlm(
  $("edLlm"),
  () => paste.open(),
  (open) => root.classList.toggle("agent-mode", open),
);
const toolbar = mountToolbar($("edToolbar"), () => editor, {
  save: () => downloadCase(docToCase(docJSON(editor), readFields())),
  load: loadFile,
  paste: () => paste.open(),
  llm: () => llm.toggle(),
});

for (const k of FIELD_IDS) inputs[k].addEventListener("input", schedule);
window.addEventListener("pagehide", persist);

// Changes made on the station page (loading a case) arrive here; removal there ("Reset case") is ignored.
window.addEventListener("storage", (e) => {
  if (e.key !== KEY || !e.newValue) return;
  try {
    const saved = JSON.parse(e.newValue);
    if (!saved?.text || saved.text === lastText) return;
    clearTimeout(timer);
    lastText = saved.text;
    show(saved.text, saved.sourceName || "case.md");
  } catch {}
});

// Open any .md dropped on the page.
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener(
  "drop",
  (e) => {
    const f = e.dataTransfer?.files[0];
    if (!f) return;
    e.preventDefault();
    e.stopPropagation();
    loadFile(f);
  },
  true,
);

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || "null");
  if (saved?.text) {
    lastText = saved.text;
    show(saved.text, saved.sourceName || "case.md");
  }
} catch {}
const openFromHash = () => {
  if (location.hash === "#llm") llm.setOpen(true);
};
window.addEventListener("hashchange", openFromHash);
openFromHash();
toolbar.sync();
