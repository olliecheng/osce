import "./styles.css";
import { testBell } from "./bell";
import { mountDisplay } from "./display";
import { mountHost } from "./host";

document.getElementById("bellTest")?.addEventListener("click", testBell);

// One page, two views. Joining a room swaps the host view for the display view; Leave swaps it back.
const host = mountHost((code) => {
  host.hide();
  display.start(code);
});
const display = mountDisplay(() => host.show());
