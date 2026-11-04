import { bell } from "./bell";

const KEY = "osce.muted";

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let muted = load();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(v: boolean) {
  muted = v;
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {}
}

/** Timer-driven bell: silent while muted. */
export function ring(times = 1) {
  if (!muted) bell(times);
}
