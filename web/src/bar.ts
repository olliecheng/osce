import type { Timer } from "./timer";

/**
 * Drives a progress bar every animation frame from the timer's exact remaining time,
 * so it moves smoothly instead of in 200 ms steps. The loop runs only while the timer is running.
 */
export function bindSmoothBar(el: HTMLElement, timer: Timer) {
  let raf = 0;
  const frame = () => {
    raf = 0;
    const p = timer.phase;
    if (!p) return;
    const done = 1 - timer.leftMs() / (p.secs * 1000);
    el.style.transform = `scaleX(${Math.min(1, Math.max(0, done))})`;
    raf = requestAnimationFrame(frame);
  };
  const start = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };
  timer.on("phase", start);
  timer.on("resume", start);
  timer.on("tick", start);
}

export function fillBar(el: HTMLElement) {
  el.style.transform = "scaleX(1)";
}
