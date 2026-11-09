import { PROMPT } from "../host/content";

/** Chat apps that take a prompt in the URL. Support changes without notice, so a click also copies the prompt. */
const LAUNCHERS = [
  { name: "ChatGPT", url: (q: string) => `https://chatgpt.com/?q=${q}` },
  { name: "Claude", url: (q: string) => `https://claude.ai/new?q=${q}` },
  { name: "Gemini", url: (q: string) => `https://gemini.google.com/app?q=${q}` },
];

/** The prompt with the user's description in place of the bracketed "Case: [...]" placeholder. */
export function buildPrompt(description: string): string {
  const d = description.trim();
  return d ? PROMPT.replace(/^Case: \[.*\]$/m, () => `Case: ${d}`) : PROMPT;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch {}
    ta.remove();
  }
}

/** "Write a case with an agent": describe it, ask a chat agent, paste the output back. */
export function mountLlm(root: HTMLElement, openPaste: () => void, onOpenChange: (open: boolean) => void) {
  root.innerHTML = `
    <div class="llm-head">
      <h2 id="llmTitle">Write a case with an agent</h2>
      <button class="btn quiet" id="llmClose" type="button">Close</button>
    </div>
    <ol class="llm-steps">
      <li class="llm-step">
        <h3><span class="llm-num" aria-hidden="true">1</span>Describe the case</h3>
        <label for="llmDesc">Presenting complaint, setting, patient age/sex, intended diagnosis, difficulty. The prompt below updates as you type.</label>
        <textarea id="llmDesc" rows="3" spellcheck="true" placeholder="e.g. Chest pain, ED, 62-year-old man, NSTEMI, moderate difficulty"></textarea>
      </li>
      <li class="llm-step">
        <h3><span class="llm-num" aria-hidden="true">2</span>Ask agent</h3>
        <p>Copy the prompt, or open an agent with it filled in. Opening one also copies the prompt, in case the site ignores the link.</p>
        <div class="llm-actions">
          <button class="btn primary" id="llmCopy" type="button">Copy prompt</button>
          ${LAUNCHERS.map((l) => `<a class="btn" data-launch="${l.name}" href="#" target="_blank" rel="noopener noreferrer">${l.name} <span aria-hidden="true">→</span></a>`).join("")}
        </div>
        <details class="llm-details" id="llmDetails">
          <summary>Show prompt</summary>
          <pre class="llm-prompt" id="llmPrompt" aria-label="Prompt"></pre>
        </details>
      </li>
      <li class="llm-step">
        <h3><span class="llm-num" aria-hidden="true">3</span>Paste output</h3>
        <p>Copy the agent’s reply (the whole Markdown file), then load it here.</p>
        <div class="llm-actions"><button class="btn primary" id="llmPaste" type="button">Load from clipboard</button></div>
      </li>
    </ol>`;
  const $ = (id: string) => root.querySelector<HTMLElement>(`#${id}`) as HTMLElement;
  const desc = $("llmDesc") as HTMLTextAreaElement;
  let prompt = PROMPT;
  const links = [...root.querySelectorAll<HTMLAnchorElement>("[data-launch]")];
  const refresh = () => {
    prompt = buildPrompt(desc.value);
    $("llmPrompt").textContent = prompt;
    const q = encodeURIComponent(prompt);
    for (const a of links) a.href = LAUNCHERS.find((l) => l.name === a.dataset.launch)?.url(q) ?? "#";
  };
  desc.addEventListener("input", refresh);
  refresh();
  $("llmClose").addEventListener("click", () => setOpen(false));
  $("llmPaste").addEventListener("click", openPaste);
  $("llmCopy").addEventListener("click", async () => {
    const b = $("llmCopy");
    await copyText(prompt);
    b.textContent = "Copied";
    setTimeout(() => {
      b.textContent = "Copy prompt";
    }, 1400);
  });
  for (const a of links) a.addEventListener("click", () => copyText(prompt));
  function setOpen(open: boolean) {
    root.classList.toggle("hidden", !open);
    onOpenChange(open);
    if (open) {
      root.scrollIntoView({ block: "start" });
      desc.focus({ preventScroll: true });
    } else if (location.hash === "#llm") history.replaceState(null, "", location.pathname + location.search);
  }
  return { setOpen, toggle: () => setOpen(root.classList.contains("hidden")) };
}
