import {
  CODE_RE,
  type DisplaySnapshot,
  normalizeCode,
  parseServerMsg,
  type ServerMsg,
} from "../../../worker/protocol";
import { audioRunning, bell, primeAudio, stopKeepAlive, testBell } from "../bell";
import { Connection, wsUrl } from "../sync";
import { fmt, PHASES, type PhaseColor, Timer } from "../timer";

const TITLE = "OSCE display"; // constant: the tab title must never leak the countdown

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text; // textContent only: nothing from the network is parsed as HTML
  return el;
}

export function mountDisplay() {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  $("displayApp").classList.remove("hidden");
  document.title = TITLE;

  const stage = $("dStage");
  const clock = $("dClock");
  const black = $("dBlack");
  const banner = $("dBanner");
  const enableSound = $("dEnableSound");

  const timer = new Timer();
  let conn: Connection | null = null;
  let code = "";
  let joined = false;
  let hostConnected = true;
  let linkLost = false;
  let sessionId = "";
  let tickId: ReturnType<typeof setInterval> | undefined;
  let wakeLock: WakeLockSentinel | null = null;
  const rung = new Set<string>();

  /* ---------- wake lock ---------- */
  async function keepAwake(on: boolean) {
    try {
      if (on && "wakeLock" in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => {
          wakeLock = null;
        });
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch {}
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && joined) keepAwake(true);
  });

  /* ---------- bells (deduplicated per session/phase/kind) ---------- */
  function ring(kind: "warn" | "end", phaseId: string) {
    const key = `${sessionId}:${phaseId}:${kind}`;
    if (rung.has(key)) return;
    rung.add(key);
    bell(kind === "warn" ? 1 : 2);
  }
  timer.on("warn", ({ phase }) => ring("warn", phase.id));
  timer.on("end", ({ phase }) => ring("end", phase.id));

  /* ---------- clock band ---------- */
  function setPhaseColor(color: PhaseColor) {
    const root = document.documentElement.style;
    root.setProperty("--phase", `var(--${color})`);
    root.setProperty("--phase-soft", `var(--${color}-soft)`);
  }
  timer.on("tick", ({ leftMs }) => {
    const p = timer.phase;
    if (!p) return;
    $("dTime").textContent = fmt(leftMs);
    $("dBarFill").style.width = `${Math.min(100, Math.max(0, (1 - leftMs / (p.secs * 1000)) * 100))}%`;
    clock.classList.toggle("paused", timer.paused);
  });
  timer.on("phase", ({ phase }) => {
    $("dPhaseName").textContent = phase.name;
    $("dPhaseNext").textContent = phase.next;
    setPhaseColor(phase.color);
  });
  timer.on("finish", () => {
    // Normally the host's "done" snapshot arrives within milliseconds; only act alone if it can't.
    if (!hostConnected) showDone();
  });

  // Hover (or focus) reveals the band via CSS. On touch, a tap reveals it for 3 s.
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  clock.addEventListener("pointerdown", () => {
    if (!matchMedia("(hover: none)").matches) return;
    clock.classList.add("reveal");
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      clock.classList.remove("reveal");
      clock.blur(); // a tap focuses the strip; drop focus so :focus-within lets go too
    }, 3000);
  });

  /* ---------- views ---------- */
  function setBanner(text: string) {
    banner.textContent = text;
    banner.classList.toggle("hidden", !text);
  }
  function updateBanner() {
    setBanner(
      linkLost
        ? "Connection lost. Reconnecting…"
        : joined && !hostConnected
          ? "Host disconnected. Reconnecting…"
          : "",
    );
  }
  function stopClock() {
    clearInterval(tickId);
    tickId = undefined;
    timer.reset();
    clock.classList.add("hidden");
    clock.classList.remove("reveal");
  }
  function center(...children: HTMLElement[]) {
    const card = h("div", "card");
    card.append(...children);
    const wrap = h("div", "dcenter");
    wrap.append(card);
    stage.replaceChildren(wrap);
  }

  function showJoin(message = "", prefill = "") {
    stopClock();
    stopKeepAlive();
    keepAwake(false);
    black.classList.add("hidden");
    enableSound.classList.add("hidden");
    joined = false;
    $("roomChip").classList.add("hidden");
    linkLost = false;
    updateBanner();
    document.title = TITLE;

    const title = h("h2", "dmsg", "Join as display");
    const input = h("input", "code-input");
    input.id = "codeIn";
    input.maxLength = 8;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.autocapitalize = "characters";
    input.placeholder = "ABCD";
    input.setAttribute("aria-label", "4-letter room code");
    input.value = prefill;
    const err = h("p", "err-text", message);
    err.id = "joinErr";
    err.setAttribute("role", "alert");
    const btn = h("button", "btn primary big", "Join");
    btn.id = "joinBtn";
    btn.type = "button";
    const form = h("div", "row");
    form.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;justify-content:center;align-items:center";
    form.append(input, btn);
    center(
      title,
      h("p", "dmsg sub", "Enter the code shown on the host’s screen."),
      form,
      err,
      h("a", "btn quiet", "Back"),
    );
    (stage.querySelector("a.btn") as HTMLAnchorElement).href = "/";
    const go = () => {
      const c = normalizeCode(input.value);
      if (!CODE_RE.test(c)) {
        err.textContent = "Enter the 4-letter code (letters only, no I or O).";
        input.focus();
        return;
      }
      join(c);
    };
    btn.addEventListener("click", go);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") go();
    });
    input.focus();
  }

  function showLobby() {
    stopClock();
    black.classList.add("hidden");
    const msg = h("p", "dmsg", `Joined ${code}. Waiting for the station to start.`);
    msg.id = "lobbyMsg";
    const leave = h("button", "btn quiet", "Leave");
    leave.type = "button";
    leave.addEventListener("click", () => leaveRoom());
    center(msg, leave);
  }

  function showDone() {
    stopClock();
    black.classList.add("hidden");
    center(h("p", "dmsg", "Station finished. Waiting for the next one."));
  }

  function showRunning(s: DisplaySnapshot) {
    black.classList.add("hidden");
    clock.classList.remove("hidden");
    const wrap = h("div", "");
    if (!s.timerOnly && s.stem) {
      const box = h("div", "stem-box reading-big");
      box.append(h("p", "lbl", "Candidate instructions"), h("p", "s", s.stem));
      wrap.append(box);
    }
    stage.replaceChildren(wrap);
  }

  /* ---------- snapshots ---------- */
  function apply(s: DisplaySnapshot) {
    sessionId = s.sessionId;
    const idx = PHASES.findIndex((p) => p.id === s.phase);
    if (s.status === "running" && idx >= 0 && s.remainingMs !== null) {
      const wasRunning = timer.running;
      if (!wasRunning) showRunning(s);
      timer.seed(idx, s.remainingMs, s.paused, s.timerOnly);
      if (!tickId) tickId = setInterval(() => timer.tick(), 200);
    } else if (s.phase === "ready") {
      stopClock();
      stage.replaceChildren();
      black.classList.remove("hidden");
    } else if (s.phase === "done") {
      showDone();
    } else {
      showLobby();
    }
  }

  /* ---------- connection ---------- */
  function join(c: string) {
    code = c;
    primeAudio(true); // the Join click unlocks audio; keep-alive runs while joined
    keepAwake(true);
    conn?.close();
    linkLost = false;
    hostConnected = true;
    conn = new Connection({
      url: () => wsUrl(`/api/rooms/${c}/ws?role=display`),
      onMessage: (data) => {
        const m = parseServerMsg(data) as ServerMsg | null;
        if (m) onServer(m);
      },
      onOpen: () => {
        linkLost = false;
        updateBanner();
      },
      onClose: ({ code: closeCode, willRetry }) => {
        if (willRetry) {
          linkLost = true;
          updateBanner();
          return;
        }
        if (closeCode === 4004) endSession("This station was closed by the host.");
        // 4001 / 4003 already surfaced through the error message that precedes the close.
      },
    });
    conn.connect();
  }

  function endSession(message: string) {
    conn?.close();
    conn = null;
    showJoin(message, code);
  }

  function leaveRoom() {
    conn?.close();
    conn = null;
    showJoin("", "");
  }

  function onServer(m: ServerMsg) {
    switch (m.type) {
      case "welcome":
        joined = true;
        $("chipCode").textContent = m.code;
        $("roomChip").classList.remove("hidden");
        hostConnected = m.hostConnected;
        updateBanner();
        showLobby();
        break;
      case "snapshot":
        if (joined) apply(m.snapshot);
        break;
      case "host":
        hostConnected = m.connected;
        updateBanner();
        break;
      case "error":
        endSession("No station with that code.");
        break;
      case "closed":
        endSession("This station was closed by the host.");
        break;
      case "pong":
        break;
    }
  }

  /* ---------- sound ---------- */
  enableSound.addEventListener("click", () => primeAudio(true));
  setInterval(() => enableSound.classList.toggle("hidden", !joined || audioRunning()), 1000);

  const prefill = normalizeCode(new URLSearchParams(location.search).get("code") ?? "");
  showJoin("", CODE_RE.test(prefill) ? prefill : "");
}
