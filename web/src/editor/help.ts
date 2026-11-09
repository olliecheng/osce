import { PROMPT, TEMPLATE } from "../host/content";

/** "How to write a case": format notes, the template and the agent prompt, with copy buttons. */
export function mountHelp(root: HTMLElement, loadTemplate: (text: string) => void) {
  root.innerHTML = `
    <div class="help-head">
      <h2 id="helpTitle">How to write a case file</h2>
      <button class="btn primary" type="button" data-copy="prompt">Copy agent prompt</button>
      <button class="btn" id="helpClose" type="button">Close</button>
    </div>
    <h3>Format</h3>
    <p>A case is one Markdown file with two parts.</p>
    <ul>
      <li><strong>Front matter</strong> between two <code>---</code> lines at the very top. <code>intro</code> is the sentence the candidate reads at the door. <code>question</code> is the examiner’s question in the final minute. <code>title</code> and <code>answer</code> (a model answer, revealed at the end) are optional. Use <code>|</code> for multi-line values. In this editor these are the fields above the text.</li>
      <li><strong>Body</strong> split into headers such as Introduction, Presenting complaint, HPC, PMHx, Medications, Allergies, FHx, SHx, Systems review, ICE and Role-player notes. Each header becomes a section on the role-player’s screen. Everything under a header is a bullet.</li>
      <li>Write content in the patient’s voice. Put things the patient only says when asked as <code>If asked about X: “…”</code> bullets, and things they never volunteer in bold.</li>
    </ul>
    <h3>Template</h3>
    <p><button class="btn" id="loadTpl" type="button">Load template into editor</button></p>
    <div class="codebox"><button class="btn primary" type="button" data-copy="tpl">Copy template</button><pre id="tpl"></pre></div>
    <h3>Prompt for an AI agent</h3>
    <p>Paste this into an assistant, replacing the bracketed part, and save the reply as a <code>.md</code> file. Load it here with the Load button.</p>
    <div class="codebox"><button class="btn primary" type="button" data-copy="prompt">Copy prompt</button><pre id="prompt"></pre></div>`;
  const $ = (id: string) => root.querySelector<HTMLElement>(`#${id}`) as HTMLElement;
  $("tpl").textContent = TEMPLATE;
  $("prompt").textContent = PROMPT;
  $("loadTpl").addEventListener("click", () => loadTemplate(TEMPLATE));
  $("helpClose").addEventListener("click", () => setOpen(false));
  root.querySelectorAll<HTMLElement>("[data-copy]").forEach((b) =>
    b.addEventListener("click", async () => {
      const text = $(b.dataset.copy as string).textContent ?? "";
      try {
        await navigator.clipboard.writeText(text);
      } catch (_e) {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
        } catch {}
        ta.remove();
      }
      const old = b.textContent;
      b.textContent = "Copied";
      setTimeout(() => {
        b.textContent = old;
      }, 1400);
    }),
  );
  function setOpen(open: boolean) {
    root.classList.toggle("hidden", !open);
    if (open) root.scrollIntoView({ block: "start" });
    else if (location.hash === "#help") history.replaceState(null, "", location.pathname + location.search);
  }
  return {
    setOpen,
    toggle: () => setOpen(root.classList.contains("hidden")),
  };
}
