import { PROMPT } from "../host/content";

/** Chat apps that take a prompt in the URL. Support changes without notice, so a click also copies the prompt. */
const LAUNCHERS = [
  { name: "ChatGPT", url: (q: string) => `https://chatgpt.com/?q=${q}` },
  { name: "Claude", url: (q: string) => `https://claude.ai/new?q=${q}` },
  { name: "Gemini", url: (q: string) => `https://gemini.google.com/app?q=${q}` },
];

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

/** "Use LLM" panel: copy the case-writing prompt, open it in a chat app, or read it. */
export function mountLlm(root: HTMLElement) {
  const q = encodeURIComponent(PROMPT);
  root.innerHTML = `
    <div class="llm-head">
      <h2 id="llmTitle">Use an LLM to draft a case</h2>
      <button class="btn quiet" id="llmClose" type="button">Close</button>
    </div>
    <p>Replace the bracketed part of the prompt with your case. Save the reply as a .md file and bring it in with Load. If a chat app doesn’t fill the prompt in, it’s already on your clipboard: paste it.</p>
    <div class="llm-actions">
      <button class="btn primary" id="llmCopy" type="button">Copy prompt</button>
      ${LAUNCHERS.map((l) => `<a class="btn" data-launch href="${l.url(q)}" target="_blank" rel="noopener noreferrer">${l.name}</a>`).join("")}
    </div>
    <pre class="llm-prompt" id="llmPrompt"></pre>`;
  const $ = (id: string) => root.querySelector<HTMLElement>(`#${id}`) as HTMLElement;
  $("llmPrompt").textContent = PROMPT;
  $("llmClose").addEventListener("click", () => setOpen(false));
  $("llmCopy").addEventListener("click", async () => {
    const b = $("llmCopy");
    await copyText(PROMPT);
    b.textContent = "Copied";
    setTimeout(() => {
      b.textContent = "Copy prompt";
    }, 1400);
  });
  root.querySelectorAll("[data-launch]").forEach((a) => a.addEventListener("click", () => copyText(PROMPT)));
  function setOpen(open: boolean) {
    root.classList.toggle("hidden", !open);
    if (open) root.scrollIntoView({ block: "start" });
    else if (location.hash === "#llm") history.replaceState(null, "", location.pathname + location.search);
  }
  return { setOpen, toggle: () => setOpen(root.classList.contains("hidden")) };
}
