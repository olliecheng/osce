/** Modal with a textarea for pasting case Markdown (front matter included). */
export function mountPaste(onLoad: (text: string) => void) {
  const dlg = document.createElement("dialog");
  dlg.className = "ed-dlg";
  dlg.setAttribute("aria-labelledby", "pasteTitle");
  dlg.innerHTML = `
    <form method="dialog" id="pasteForm">
      <h2 id="pasteTitle">Load from clipboard</h2>
      <label for="pasteText">Paste the case Markdown, including the front matter</label>
      <textarea id="pasteText" spellcheck="false" autocomplete="off" placeholder="---&#10;intro: &quot;...&quot;&#10;question: &quot;...&quot;&#10;---&#10;&#10;## Introduction&#10;- ..."></textarea>
      <div class="ed-dlg-actions">
        <button class="btn primary" id="pasteLoad" type="submit" disabled>Load</button>
        <button class="btn quiet" id="pasteCancel" type="button">Cancel</button>
      </div>
    </form>`;
  document.body.append(dlg);
  const ta = dlg.querySelector("#pasteText") as HTMLTextAreaElement;
  const go = dlg.querySelector("#pasteLoad") as HTMLButtonElement;
  ta.addEventListener("input", () => {
    go.disabled = !ta.value.trim();
  });
  dlg.querySelector("#pasteCancel")?.addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.querySelector("form")?.addEventListener("submit", () => {
    if (ta.value.trim()) onLoad(ta.value);
  });
  return {
    open() {
      ta.value = "";
      go.disabled = true;
      dlg.showModal();
      ta.focus();
    },
  };
}
