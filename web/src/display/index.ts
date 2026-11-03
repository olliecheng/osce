import { type DisplaySnapshot, parseServerMsg, type ServerMsg } from "../../../worker/protocol";
import { bindSmoothBar, fillBar } from "../bar";
import { audioRunning, bell, primeAudio, stopKeepAlive, testBell } from "../bell";
import { mdSafe } from "../markdown";
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

/** Display view, shown in place of the host view. `onLeave` returns the user to the home screen. */
export function mountDisplay(onLeave: () => void) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const originalTitle = document.title;

  const stage = $("dStage");
  const clock = $("dClock");
  const black = $("dBlack");
  const banner = $("dBanner");
  const enableSound = $("dEnableSound");

  const timer = new Timer();
  bindSmoothBar($("dBarFill"), timer);
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
    clock.classList.toggle("paused", timer.paused);
  });
  timer.on("phase", ({ phase }) => {
    $("dPhaseName").textContent = phase.name;
    setPhaseColor(phase.color);
    renderStem(phase.id);
  });
  timer.on("finish", () => {
    // Normally the host's "done" snapshot arrives within milliseconds; only act alone if it can't.
    if (!hostConnected) showDone();
  });

  // The phase name is always shown. The countdown and progress bar only appear with "Show timer".
  const showTimer = $<HTMLInputElement>("showTimer");
  try {
    showTimer.checked = localStorage.getItem("osce-show-timer") === "1";
  } catch {}
  const applyShowTimer = () => clock.classList.toggle("no-timer", !showTimer.checked);
  applyShowTimer();
  showTimer.addEventListener("change", () => {
    applyShowTimer();
    try {
      localStorage.setItem("osce-show-timer", showTimer.checked ? "1" : "0");
    } catch {}
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
    document.body.classList.remove("in-station");
  }
  /** A centred card; with `withLeave`, a red text "Leave" button sits under it, aligned to its right edge. */
  function center(children: HTMLElement[], withLeave = false) {
    const card = h("div", "card");
    card.append(...children);
    const col = h("div", "dcol");
    col.append(card);
    if (withLeave) {
      const leave = h("button", "leave-btn", "Leave");
      leave.id = "leaveBtn";
      leave.type = "button";
      leave.addEventListener("click", () => leaveRoom());
      col.append(leave);
    }
    const wrap = h("div", "dcenter");
    wrap.append(col);
    stage.replaceChildren(wrap);
  }

  function showLobby(noHost = false) {
    stopClock();
    black.classList.add("hidden");
    const msg = h(
      "p",
      "dmsg",
      noHost ? "No host found." : `Joined ${code}. Waiting for the station to start.`,
    );
    msg.id = "lobbyMsg";
    const items = [msg];
    if (noHost) items.push(h("p", "dmsg sub", `Looking for room ${code}…`));
    center(items, true);
  }

  let snap: DisplaySnapshot | null = null;

  /** Mirrors the examiner's finished screen: question, model answer, then the case sections. */
  function showDone() {
    stopClock();
    black.classList.add("hidden");
    // Same teal "Station finished" ribbon as the examiner's screen.
    setPhaseColor("teal");
    $("dTime").textContent = "0:00";
    $("dPhaseName").textContent = "Station finished";
    fillBar($("dBarFill"));
    clock.classList.remove("hidden", "paused");
    document.body.classList.add("in-station");
    const r = snap?.review;
    if (!snap || snap.timerOnly || !r) {
      center([h("p", "dmsg", "Station finished. Waiting for the next one.")], true);
      return;
    }
    const box = h("div", "done-box");
    if (r.question) {
      const q = h("div", "question-big");
      q.append(h("p", "lbl", "Examiner asks"), h("p", "qq", r.question));
      box.append(q);
    }
    if (r.answer) {
      const a = h("div", "answer");
      a.append(h("p", "answer-title", "Model answer"));
      const body = h("div", "md");
      body.innerHTML = mdSafe(r.answer);
      a.append(body);
      box.append(a);
    }
    if (snap.stem) {
      const s = h("div", "stem-box");
      s.append(h("p", "lbl", "Candidate instructions"), h("p", "s", snap.stem));
      box.append(s);
    }
    if (r.sections.length) {
      const wrap = h("div", "case");
      const nav = h("nav", "index");
      nav.setAttribute("aria-label", "Case sections");
      const secs = h("div", "sections");
      r.sections.forEach((sec, i) => {
        const a = h("a", "", sec.title);
        a.href = `#dsec-${i}`;
        a.addEventListener("click", (e) => {
          e.preventDefault();
          document.getElementById(`dsec-${i}`)?.scrollIntoView({
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          });
        });
        nav.append(a);
        const el = h("section", i === 0 ? "sec lead" : "sec");
        el.id = `dsec-${i}`;
        el.append(h("h3", "", sec.title));
        const md = h("div", "md");
        md.innerHTML = mdSafe(sec.md);
        el.append(md);
        secs.append(el);
      });
      wrap.append(nav, secs);
      box.append(wrap);
    }
    const leave = h("button", "leave-btn", "Leave");
    leave.id = "leaveBtn";
    leave.type = "button";
    leave.addEventListener("click", () => leaveRoom());
    box.append(leave);
    stage.replaceChildren(box);
    window.scrollTo({ top: 0 });
  }

  /** The stem is shown during reading time only. */
  function renderStem(phaseId: string) {
    const wrap = h("div", "");
    if (snap && !snap.timerOnly && snap.stem && phaseId === "reading") {
      const box = h("div", "stem-box reading-big");
      box.append(h("p", "lbl", "Candidate instructions"), h("p", "s", snap.stem));
      wrap.append(box);
    }
    stage.replaceChildren(wrap);
  }

  function showRunning() {
    black.classList.add("hidden");
    clock.classList.remove("hidden");
    document.body.classList.add("in-station");
  }

  /* ---------- snapshots ---------- */
  function apply(s: DisplaySnapshot) {
    sessionId = s.sessionId;
    snap = s;
    const idx = PHASES.findIndex((p) => p.id === s.phase);
    if (s.status === "running" && idx >= 0 && s.remainingMs !== null) {
      const wasRunning = timer.running;
      if (!wasRunning) showRunning();
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
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  /** Enter the waiting room straight away, whether or not a host exists yet. */
  function join(c: string) {
    code = c;
    primeAudio(true); // keep-alive runs while joined; if the browser blocks audio, "Tap to enable sound" appears
    keepAwake(true);
    joined = true;
    $("chipCode").textContent = c;
    $("roomChip").classList.remove("hidden");
    $("showTimerWrap").classList.remove("hidden");
    showLobby();
    connect();
  }

  function connect() {
    clearTimeout(retryTimer);
    conn?.close();
    linkLost = false;
    hostConnected = true;
    conn = new Connection({
      url: () => wsUrl(`/api/rooms/${code}/ws?role=display`),
      onMessage: (data) => {
        const m = parseServerMsg(data) as ServerMsg | null;
        if (m) onServer(m);
      },
      onOpen: () => {
        linkLost = false;
        updateBanner();
      },
      onClose: ({ willRetry }) => {
        if (willRetry) {
          linkLost = true;
          updateBanner();
        }
      },
    });
    conn.connect();
  }

  /** No room for this code (yet, or any more): wait for a host and keep looking. */
  function noHost() {
    conn?.close();
    conn = null;
    hostConnected = true; // no "host disconnected" banner on top of "No host found."
    updateBanner();
    showLobby(true);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, 4000);
  }

  /** Tear the display down completely and go back to the home screen. */
  function leaveRoom() {
    clearTimeout(retryTimer);
    conn?.close();
    conn = null;
    stopClock();
    stopKeepAlive();
    keepAwake(false);
    black.classList.add("hidden");
    enableSound.classList.add("hidden");
    joined = false;
    snap = null;
    sessionId = "";
    rung.clear();
    linkLost = false;
    updateBanner();
    $("roomChip").classList.add("hidden");
    $("showTimerWrap").classList.add("hidden");
    stage.replaceChildren();
    $("displayApp").classList.add("hidden");
    document.body.classList.remove("in-station");
    document.title = originalTitle;
    onLeave();
  }

  function onServer(m: ServerMsg) {
    switch (m.type) {
      case "welcome":
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
      case "closed":
        noHost();
        break;
      case "pong":
        break;
    }
  }

  /* ---------- sound ---------- */
  enableSound.addEventListener("click", () => primeAudio(true));
  setInterval(() => enableSound.classList.toggle("hidden", !joined || audioRunning()), 1000);

  return {
    start(c: string) {
      $("displayApp").classList.remove("hidden");
      document.title = TITLE;
      join(c);
    },
  };
}
