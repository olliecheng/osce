import "./styles.css";
import { testBell } from "./bell";
import { mountDisplay } from "./display";
import { mountHost } from "./host";
import { isMuted, setMuted } from "./mute";

const muteBtn = document.getElementById("bellMute");
const testBtn = document.getElementById("bellTest");
testBtn?.addEventListener("click", () => {
  if (!isMuted()) testBell();
});
function renderMute() {
  const m = isMuted();
  muteBtn?.setAttribute("aria-pressed", String(m));
  muteBtn?.setAttribute("aria-label", m ? "Unmute bell" : "Mute bell");
  if (testBtn) {
    testBtn.textContent = m ? "Muted" : "Test bell";
    testBtn.classList.toggle("is-muted", m);
    testBtn.setAttribute("aria-disabled", String(m));
  }
}
muteBtn?.addEventListener("click", () => {
  setMuted(!isMuted());
  renderMute();
});
renderMute();

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
