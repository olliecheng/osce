import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
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
