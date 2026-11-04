import "./styles.css";
import { flashClock } from "./bar";
import { testBell } from "./bell";
import { mountDisplay } from "./display";
import { mountHost } from "./host";
import { isMuted, setMuted } from "./mute";

const muteBtn = document.getElementById("bellMute");
const testBtn = document.getElementById("bellTest");
// During a station the button reads "Ring bell" and also flashes the clock like the 6-minute warning.
// Phase-end bells never flash.
const inStation = () => document.body.classList.contains("in-station");
testBtn?.addEventListener("click", () => {
  if (isMuted()) return;
  testBell();
  if (inStation()) {
    for (const c of document.querySelectorAll<HTMLElement>(".clock")) if (c.offsetParent) flashClock(c);
  }
});
function renderMute() {
  const m = isMuted();
  muteBtn?.setAttribute("aria-pressed", String(m));
  muteBtn?.setAttribute("aria-label", m ? "Unmute bell" : "Mute bell");
  if (testBtn) {
    testBtn.textContent = m ? "Muted" : inStation() ? "Ring bell" : "Test bell";
    testBtn.classList.toggle("is-muted", m);
    testBtn.setAttribute("aria-disabled", String(m));
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
