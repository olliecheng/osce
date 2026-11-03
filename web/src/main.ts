import "./styles.css";
import { testBell } from "./bell";
import { mountDisplay } from "./display";
import { mountHost } from "./host";

document.getElementById("bellTest")?.addEventListener("click", testBell);

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
