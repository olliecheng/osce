import "@fontsource-variable/source-sans-3/wght.css";
import "@fontsource-variable/source-sans-3/wght-italic.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/700.css";
import "./styles.css";
import { testBell } from "./bell";
import { mountDisplay } from "./display";
import { mountHost } from "./host";

const path = location.pathname.replace(/\/+$/, "") || "/";
const isJoin = path === "/join";

document.getElementById("bellTest")?.addEventListener("click", testBell);
document.getElementById(isJoin ? "navJoin" : "navHost")?.setAttribute("aria-current", "page");

// "/" is the host page too: a room is always created for an active session.
if (isJoin) mountDisplay();
else mountHost();
