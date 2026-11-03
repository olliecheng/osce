import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
import "./styles.css";
import { mountDisplay } from "./display";
import { mountHost } from "./host";

const path = location.pathname.replace(/\/+$/, "") || "/";

if (path === "/host") {
  mountHost();
} else if (path === "/join") {
  mountDisplay();
} else {
  document.getElementById("landing")?.classList.remove("hidden");
}
