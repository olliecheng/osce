import { FEEDBACK_MAX, normalizeCode } from "../../../worker/protocol";
import { bindSmoothBar, fillBar, flashClock } from "../bar";
import { primeAudio, stopKeepAlive } from "../bell";
import { type CaseData, parseCase } from "../case";
import { applyChecked, indexListItems, sectionIndex, wireChecklist } from "../checklist";
import { downloadCase, printCase } from "../download";
import { decodeLoadFragment, hasLoadFragment } from "../fragment";
import { esc, md } from "../markdown";
import { ring } from "../mute";
import type { HostView } from "../snapshot";
import { fmt, type PhaseColor, Timer } from "../timer";
import { PROMPT, TEMPLATE } from "./content";
import { HostRoom } from "./room";

export function mountHost(onJoin: (code: string) => void, onReplaced: (code: string) => void = () => {}) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  $("hostApp").classList.remove("hidden");

  const els = {
    setup: $("setup"),
    run: $("run"),
    drop: $("drop"),
    fileIn: $<HTMLInputElement>("fileIn"),
    pickBtn: $("pickBtn"),
    exampleBtn: $("exampleBtn"),
    status: $("status"),
    planTitle: $("planTitle"),
    planStem: $("planStem"),
    planChecks: $("planChecks"),
    startBtn: $<HTMLButtonElement>("startBtn"),
    clock: $("clock"),
    time: $("time"),
    phaseName: $("phaseName"),
    phaseNext: $("phaseNext"),
    pauseBtn: $("pauseBtn"),
    skipBtn: $("skipBtn"),
    resetBtn: $("resetBtn"),
    barFill: $("barFill"),
    stage: $("stage"),
    help: $<HTMLDialogElement>("help"),
    helpBtn: $("helpBtn"),
    helpClose: $("helpClose"),
  };
  $("tpl").textContent = TEMPLATE;
  $("prompt").textContent = PROMPT;

  /* ---------- case state ---------- */
  let current: CaseData | null = null;
  const checked = new Set<string>(); // bullets the assessor marked off; sent to viewers only at "done"
  const flagged = new Set<string>(); // bullets the assessor flagged red; same rules
  let feedback = ""; // assessor's written feedback; same rules
  const resetCaseBtn = $<HTMLButtonElement>("resetCaseBtn");
  resetCaseBtn.addEventListener("click", clearCase);

  function loadCase(text: string, sourceName: string): boolean {
    const c = parseCase(text, sourceName);
    if (!c) {
      setStatus(
        `${sourceName} has no front matter or headings. Open “How to write a case” for the format.`,
        true,
      );
      return false;
    }
    current = c;
    checked.clear();
    flagged.clear();
    feedback = "";
    try {
      localStorage.setItem("osce-last-case", JSON.stringify({ text, sourceName }));
    } catch {}
    renderPlan();
    setStatus(`Loaded ${sourceName}.`);
    return true;
  }

  function renderPlan() {
    const c = current as CaseData;
    els.planTitle.textContent = c.title;
    els.planStem.textContent = c.intro || "No intro sentence in the front matter.";
    els.planStem.classList.toggle("empty", !c.intro);
    const checks: [boolean, string][] = [
      [!!c.intro, c.intro ? "Intro sentence" : "Missing intro in front matter"],
      [!!c.question, c.question ? "Examiner question" : "Missing question in front matter"],
      [
        c.sections.length > 0,
        `${c.sections.length} section${c.sections.length === 1 ? "" : "s"}: ${c.sections.map((s) => s.title).join(", ")}`,
      ],
    ];
    els.planChecks.innerHTML = checks
      .map(([ok, t]) => `<li class="${ok ? "" : "miss"}">${esc(t)}</li>`)
      .join("");
    els.planChecks.classList.remove("hidden");
    els.startBtn.disabled = false;
    resetCaseBtn.disabled = false;
  }

  function clearCase() {
    current = null;
    checked.clear();
    flagged.clear();
    feedback = "";
    try {
      localStorage.removeItem("osce-last-case");
    } catch {}
    els.planTitle.textContent = "No case loaded";
    els.planStem.textContent = "The candidate’s introductory sentence will appear here.";
    els.planStem.classList.add("empty");
    els.planChecks.innerHTML = "";
    els.planChecks.classList.add("hidden");
    els.startBtn.disabled = true;
    resetCaseBtn.disabled = true;
    setStatus("Case cleared.");
  }

  function setStatus(msg: string, isErr?: boolean) {
    els.status.textContent = msg;
    els.status.classList.toggle("err", !!isErr);
  }

  function readFile(file: File | undefined) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => loadCase(String(r.result), file.name);
    r.onerror = () => setStatus(`Couldn’t read ${file.name}.`, true);
    r.readAsText(file);
  }

  els.pickBtn.addEventListener("click", () => els.fileIn.click());
  els.fileIn.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    readFile(t.files?.[0]);
    t.value = "";
  });
  els.exampleBtn.addEventListener("click", () => loadCase(TEMPLATE, "example-chest-pain.md"));

  const pasteBtn = $("pasteBtn"),
    pastePanel = $("pastePanel"),
    pasteIn = $<HTMLTextAreaElement>("pasteIn");
  function showPaste(on: boolean) {
    pastePanel.classList.toggle("hidden", !on);
    pasteBtn.setAttribute("aria-expanded", String(on));
    if (on) pasteIn.focus();
  }
  function loadPasted() {
    const text = pasteIn.value;
    if (!text.trim()) {
      setStatus("Paste the case Markdown into the box, then press Load.", true);
      pasteIn.focus();
      return;
    }
    if (loadCase(text, "pasted case")) {
      pasteIn.value = "";
      showPaste(false);
    }
  }
  pasteBtn.addEventListener("click", () => showPaste(pastePanel.classList.contains("hidden")));
  $("pasteCancel").addEventListener("click", () => {
    pasteIn.value = "";
    showPaste(false);
  });
  $("pasteLoad").addEventListener("click", loadPasted);
  pasteIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      loadPasted();
    }
    if (e.key === "Escape") showPaste(false);
  });
  ["dragenter", "dragover"].forEach((ev) =>
    els.drop.addEventListener(ev, (e) => {
      e.preventDefault();
      els.drop.classList.add("over");
    }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    els.drop.addEventListener(ev, (e) => {
      e.preventDefault();
      els.drop.classList.remove("over");
    }),
  );
  els.drop.addEventListener("drop", (e) => readFile((e as DragEvent).dataTransfer?.files[0]));
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    if (els.setup.classList.contains("hidden")) return;
    readFile(e.dataTransfer?.files[0]);
  });

  try {
    const saved = JSON.parse(localStorage.getItem("osce-last-case") || "null");
    if (saved?.text) {
      loadCase(saved.text, saved.sourceName || "last case");
      setStatus(`Reloaded last case (${saved.sourceName || "file"}).`);
    }
  } catch {}

  // `#load=<base64 markdown>` preloads a case (overriding the remembered one), then the fragment is removed.
  if (hasLoadFragment(location.hash)) {
    const text = decodeLoadFragment(location.hash);
    history.replaceState(null, "", location.pathname + location.search);
    if (text) loadCase(text, "shared link");
    else setStatus("Couldn’t read the case in the link.", true);
  }

  /* ---------- join box: open this device as a display ---------- */
  $("joinForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = normalizeCode($<HTMLInputElement>("joinCode").value);
    onJoin(code);
  });

  /* ---------- timer ---------- */
  const timer = new Timer();
  bindSmoothBar(els.barFill, timer);
  let tickId: ReturnType<typeof setInterval> | undefined;
  let wakeLock: WakeLockSentinel | null = null;
  let sessionId = crypto.randomUUID();
  let readyOpen = false;
  let readyBare = false;

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
    if (document.visibilityState === "visible" && timer.running) keepAwake(true);
  });

  function setPhaseColor(color: PhaseColor) {
    const root = document.documentElement.style;
    root.setProperty("--phase", `var(--${color})`);
    root.setProperty("--phase-soft", `var(--${color}-soft)`);
  }

  /* ---------- room (second screen) ---------- */
  function view(): Omit<HostView, "seq"> {
    const base = {
      sessionId,
      timerOnly: timer.timerOnly,
      case: current,
      checked: [...checked],
      flagged: [...flagged],
      feedback,
    };
    if (readyOpen)
      return {
        ...base,
        timerOnly: readyBare,
        case: null,
        status: "running",
        phase: "ready",
        remainingMs: null,
        paused: false,
      };
    if (timer.running) {
      return {
        ...base,
        status: "running",
        phase: (timer.phase as NonNullable<typeof timer.phase>).id,
        remainingMs: timer.leftMs(),
        paused: timer.paused,
      };
    }
    if (timer.finished) return { ...base, status: "lobby", phase: "done", remainingMs: null, paused: false };
    return { ...base, case: null, status: "lobby", phase: null, remainingMs: null, paused: false };
  }
  const room = new HostRoom(view, renderRoom, onReplaced);

  const roomChip = $("roomChip");
  function renderRoom() {
    const u = room.ui;
    roomChip.classList.remove("hidden");
    roomChip.classList.add("can-refresh"); // clicking the code makes a new room (host view only)
    $("chipCode").textContent = u.code ?? "—";
    $("chipNote").textContent = u.code && !u.connected ? "Reconnecting…" : u.notice;
    $("roomRetry").classList.toggle("hidden", !!u.code || !u.notice);
  }
  $("roomRetry").addEventListener("click", () => room.create());
  const chipCode = $("chipCode");
  chipCode.addEventListener("click", () => {
    if (roomChip.classList.contains("can-refresh") && room.active) room.refresh();
  });

  timer.on("tick", ({ leftMs }) => {
    const p = timer.phase;
    if (!p) return;
    els.time.textContent = fmt(leftMs);
    document.title = `${fmt(leftMs)} ${p.name}`;
  });
  timer.on("phase", ({ phase }) => {
    els.clock.classList.remove("paused");
    els.pauseBtn.textContent = "Pause";
    els.phaseName.textContent = phase.name;
    els.phaseNext.textContent = phase.next;
    setPhaseColor(phase.color);
    renderStage(phase.id);
    window.scrollTo({ top: 0 });
    room.requestPush();
  });
  timer.on("warn", () => {
    ring(1);
    flashClock(els.clock);
  });
  timer.on("end", () => ring(2));
  timer.on("pause", () => {
    els.pauseBtn.textContent = "Resume";
    els.clock.classList.add("paused");
    room.requestPush();
  });
  timer.on("resume", () => {
    els.pauseBtn.textContent = "Pause";
    els.clock.classList.remove("paused");
    room.requestPush();
  });
  timer.on("finish", finish);

  function start(bare: boolean) {
    if (!current && !bare) return;
    primeAudio(true); // fresh audio context on user gesture
    keepAwake(true);
    els.setup.classList.add("hidden");
    els.run.classList.remove("hidden");
    document.body.classList.add("in-station");
    timer.start(bare);
    clearInterval(tickId);
    tickId = setInterval(() => timer.tick(), 200);
    renderRoom();
  }

  function finish() {
    stopKeepAlive();
    disarmEnd();
    clearInterval(tickId);
    setPhaseColor("teal");
    els.time.textContent = "0:00";
    fillBar(els.barFill);
    els.phaseName.textContent = "Station finished";
    els.phaseNext.textContent = "";
    els.pauseBtn.classList.add("hidden");
    els.skipBtn.classList.add("hidden");
    els.resetBtn.textContent = "Back to setup";
    document.title = "OSCE history station";
    keepAwake(false);
    renderStage("done");
    room.requestPush(); // status: lobby, phase: done
    renderRoom();
  }

  function reset() {
    stopKeepAlive();
    clearInterval(tickId);
    timer.reset();
    keepAwake(false);
    els.pauseBtn.classList.remove("hidden");
    els.skipBtn.classList.remove("hidden");
    els.resetBtn.textContent = "End station";
    els.run.classList.add("hidden");
    document.body.classList.remove("in-station");
    els.setup.classList.remove("hidden");
    setPhaseColor("teal");
    document.title = "OSCE history station";
    room.requestPush(); // status: lobby
    renderRoom();
  }

  const readyEl = $("ready");
  function showReady(bare: boolean) {
    readyBare = bare === true;
    if (!current && !readyBare) return;
    sessionId = crypto.randomUUID();
    checked.clear();
    flagged.clear();
    feedback = "";
    readyOpen = true;
    readyEl.classList.remove("hidden");
    $("readyGo").focus();
    room.requestPush(); // phase: ready
    renderRoom();
  }
  function hideReady() {
    readyOpen = false;
    readyEl.classList.add("hidden");
    room.requestPush();
    renderRoom();
  }
  $("readyGo").addEventListener("click", () => {
    hideReady();
    start(readyBare);
  });
  $("readyCancel").addEventListener("click", () => {
    hideReady();
    (readyBare ? $("timerOnlyBtn") : els.startBtn).focus();
  });
  readyEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") $("readyCancel").click();
  });
  els.startBtn.addEventListener("click", () => showReady(false));
  $("timerOnlyBtn").addEventListener("click", () => showReady(true));
  els.pauseBtn.addEventListener("click", () => {
    if (timer.paused) timer.resume();
    else timer.pause();
  });
  els.skipBtn.addEventListener("click", () => timer.skip());
  let endArmTimer: ReturnType<typeof setTimeout> | null = null;
  function disarmEnd() {
    if (endArmTimer) clearTimeout(endArmTimer);
    endArmTimer = null;
    els.resetBtn.classList.remove("armed");
    els.resetBtn.textContent = timer.finished ? "Back to setup" : "End station";
  }
  els.resetBtn.addEventListener("click", () => {
    if (timer.running && !endArmTimer) {
      els.resetBtn.textContent = "Click again to end";
      els.resetBtn.classList.add("armed");
      endArmTimer = setTimeout(disarmEnd, 3000);
      return;
    }
    disarmEnd();
    reset();
  });
  document.addEventListener("keydown", (e) => {
    if (els.run.classList.contains("hidden") || els.help.open) return;
    if (
      e.code === "Space" &&
      !/^(BUTTON|INPUT|TEXTAREA|SUMMARY)$/.test(document.activeElement?.tagName ?? "")
    ) {
      e.preventDefault();
      if (!timer.finished) els.pauseBtn.click();
    }
  });

  /* ---------- stage rendering ---------- */
  function stemBlock(big: boolean) {
    if (!current?.intro) return "";
    return `<div class="stem-box ${big ? "reading-big" : ""}"><p class="lbl">Candidate instructions</p><p class="s">${esc(current.intro)}</p></div>`;
  }

  function caseBlock() {
    const secs = current?.sections ?? [];
    if (!secs.length) return `<p>No sections in this case file.</p>`;
    const nav = secs.map((s, i) => `<a href="#sec-${i}">${esc(s.title)}</a>`).join("");
    const body = secs
      .map(
        (s, i) =>
          `<section class="sec ${i === 0 ? "lead" : ""}" id="sec-${i}"><h3>${esc(s.title)}</h3><div class="md">${md(s.md)}</div></section>`,
      )
      .join("");
    return `<div class="case"><nav class="index" aria-label="Case sections">${nav}</nav><div class="sections">${body}</div></div>`;
  }

  function questionBlock() {
    const q = current?.question || "No examiner question in the case file.";
    return `<div class="question-big"><p class="lbl">Examiner asks</p><p class="qq">${esc(q)}</p></div>`;
  }

  function answerBlock(open: boolean) {
    if (!current?.answer) return "";
    return `<details class="answer" ${open ? "open" : ""}><summary>Model answer</summary><div class="md">${md(current.answer)}</div></details>`;
  }

  /** Finished screen: the model answer is simply shown, not a dropdown. */
  function answerStatic() {
    if (!current?.answer) return "";
    return `<div class="answer"><p class="answer-title">Model answer</p><div class="md">${md(current.answer)}</div></div>`;
  }

  function feedbackBlock() {
    if (!current) return "";
    return `<div class="feedback"><label class="answer-title" for="feedbackIn">Feedback</label><textarea id="feedbackIn" maxlength="${FEEDBACK_MAX}" placeholder="Written feedback for the candidate. Appears on viewers' screens and at the top of the PDF.">${esc(feedback)}</textarea></div>`;
  }

  function wireIndexLinks(root: ParentNode) {
    root.querySelectorAll<HTMLAnchorElement>(".index a").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const t = document.querySelector(a.getAttribute("href") as string);
        if (t)
          t.scrollIntoView({
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          });
      }),
    );
  }

  /** Question screen: render the case beneath the question and remove the button. */
  function wireShowCase(btn: HTMLElement, area: HTMLElement) {
    btn.addEventListener("click", () => {
      area.innerHTML = stemBlock(false) + caseBlock();
      btn.remove();
      wireIndexLinks(area);
      decorateCase(area);
    });
  }

  /** Key every bullet and restore its marked state after the case is (re)rendered. */
  function decorateCase(root: ParentNode) {
    indexListItems(root, sectionIndex);
    applyChecked(root, checked, flagged);
  }
  wireChecklist(
    els.stage,
    checked,
    flagged,
    () => true,
    // Marks reach viewers only inside the finished-station review, so only push once it is showing.
    () => {
      if (timer.finished) room.requestPush();
    },
  );

  function renderStage(id: string) {
    let html = "";
    if (timer.timerOnly) {
      els.stage.innerHTML = "";
      return;
    }
    if (id === "reading") {
      html =
        stemBlock(true) +
        `<details class="answer preread"><summary>Role-player instructions</summary>${caseBlock()}</details>`;
    } else if (id === "history") {
      html = stemBlock(false) + caseBlock();
    } else if (id === "question") {
      html =
        questionBlock() +
        `<div style="margin-top:26px">${answerBlock(false)}</div>` +
        `<div class="actions" style="margin-top:22px"><button class="btn" type="button" id="showCaseBtn">Show case</button></div><div id="caseArea"></div>`;
    } else if (id === "done") {
      html = `<div class="done-box">${questionBlock()}${answerStatic()}${feedbackBlock()}${stemBlock(false)}${caseBlock()}<div class="actions" style="margin-top:22px"><button class="btn" type="button" id="downloadMdBtn">Download .md</button><button class="btn" type="button" id="savePdfBtn">Save as PDF</button></div></div>`;
    }
    els.stage.innerHTML = html;
    els.stage.classList.add("markable");
    wireIndexLinks(els.stage);
    decorateCase(els.stage);
    if (id === "done" && current) {
      let t: ReturnType<typeof setTimeout> | undefined;
      $<HTMLTextAreaElement>("feedbackIn").addEventListener("input", (e) => {
        feedback = (e.target as HTMLTextAreaElement).value.slice(0, FEEDBACK_MAX);
        clearTimeout(t);
        t = setTimeout(() => room.requestPush(), 250);
      });
      $("downloadMdBtn").addEventListener("click", () => downloadCase(current as CaseData));
      $("savePdfBtn").addEventListener("click", () =>
        printCase(current as CaseData, checked, flagged, feedback),
      );
    } else if (id === "done") {
      $("downloadMdBtn").remove();
      $("savePdfBtn").remove();
    }
    if (id === "question") wireShowCase($("showCaseBtn"), $("caseArea"));
  }

  /* ---------- help dialog ---------- */
  els.helpBtn.addEventListener("click", () => els.help.showModal());
  els.helpClose.addEventListener("click", () => els.help.close());
  els.help.addEventListener("click", (e) => {
    if (e.target === els.help) els.help.close();
  });
  document.querySelectorAll<HTMLElement>("[data-copy]").forEach((b) =>
    b.addEventListener("click", async () => {
      const text = $(b.dataset.copy as string).textContent ?? "";
      try {
        await navigator.clipboard.writeText(text);
      } catch (_e) {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
        } catch {}
        ta.remove();
      }
      const old = b.textContent;
      b.textContent = "Copied";
      setTimeout(() => {
        b.textContent = old;
      }, 1400);
    }),
  );

  // A refresh mid-station loses timer state; reclaim the room and go back to the lobby.
  if (!room.reclaim()) room.create();
  renderRoom();

  return {
    show() {
      $("hostApp").classList.remove("hidden");
      $<HTMLInputElement>("joinCode").value = "";
      renderRoom(); // restore this host's room code in the header
    },
    hide() {
      $("hostApp").classList.add("hidden");
    },
    /** A viewer took over: become host of that room with the shared token. */
    takeOver(code: string, token: string) {
      room.adopt(code, token);
      this.show();
    },
  };
}
