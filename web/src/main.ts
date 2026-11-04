import "./styles.css";
import { flashClock } from "./bar";
import { bell, primeAudio, testBell } from "./bell";
import { mountDisplay } from "./display";
import { mountHost } from "./host";
import { isMuted, setMuted } from "./mute";

const muteBtn = document.getElementById("bellMute");
const testBtn = document.getElementById("bellTest");
// During a station the button reads "Ring bell": it rings once (silent while muted) and always flashes
// the clock like the 6-minute warning. Phase-end bells never flash. Outside a station it is "Test bell",
// which is inert while muted.
const inStation = () => document.body.classList.contains("in-station");
testBtn?.addEventListener("click", () => {
  if (inStation()) {
    if (!isMuted()) {
      primeAudio(true); // replaces the context; keep the station's keep-alive running on the new one
      bell(1);
    }
    for (const c of document.querySelectorAll<HTMLElement>(".clock")) {
      if (c.getClientRects().length) flashClock(c);
    }
  } else if (!isMuted()) testBell();
});
function renderMute() {
  const m = isMuted();
  muteBtn?.setAttribute("aria-pressed", String(m));
  muteBtn?.setAttribute("aria-label", m ? "Unmute bell" : "Mute bell");
  if (testBtn) {
    const idle = m && !inStation();
    testBtn.textContent = inStation() ? "Ring bell" : m ? "Muted" : "Test bell";
    testBtn.classList.toggle("is-muted", idle);
    testBtn.setAttribute("aria-disabled", String(idle));
  }
}
muteBtn?.addEventListener("click", () => {
  setMuted(!isMuted());
  renderMute();
});
renderMute();
new MutationObserver(renderMute).observe(document.body, { attributes: true, attributeFilter: ["class"] });

// One page, two views. Joining a room swaps the host view for the display view; Leave swaps it back.
// "Take over as host" swaps a viewer into the host view of the room it joined; the previous host,
// told its room was replaced, becomes a viewer of the same room.
const host = mountHost(
  (code) => {
    host.hide();
    display.start(code);
  },
  (code) => {
    host.hide();
    display.start(code);
  },
);
const display = mountDisplay(
  () => host.show(),
  (code, token) => host.takeOver(code, token),
);
