/**
 * Phase engine, independent of the DOM. Shared by host (authoritative) and display (seeded from snapshots).
 * Uses performance.now() internally, so devices never compare wall clocks.
 */

export type PhaseColor = "amber" | "teal" | "red";
export type PhaseDef = {
  id: "reading" | "history" | "question";
  name: string;
  secs: number;
  color: PhaseColor;
  next: string;
  warn?: number;
};

export const PHASES: readonly PhaseDef[] = [
  { id: "reading", name: "Reading time", secs: 60, color: "amber", next: "Next: history taking" },
  {
    id: "history",
    name: "History taking",
    secs: 420,
    color: "teal",
    next: "Next: examiner question",
    warn: 60,
  },
  { id: "question", name: "Examiner question", secs: 60, color: "red", next: "Last phase" },
];

export type TimerEvents = {
  phase: { index: number; phase: PhaseDef }; // entered a phase (start, natural end, or skip)
  warn: { index: number; phase: PhaseDef }; // warning threshold reached naturally
  end: { index: number; phase: PhaseDef }; // phase expired naturally (not on skip)
  finish: undefined; // ran past the last phase
  pause: undefined;
  resume: undefined;
  reset: undefined;
  tick: { leftMs: number };
};

type Handler<K extends keyof TimerEvents> = (e: TimerEvents[K]) => void;

export class Timer {
  phaseIdx = -1;
  endAt = 0;
  pausedLeft: number | null = null;
  warned = false;
  silentEnd = false;
  timerOnly = false;

  private handlers: { [K in keyof TimerEvents]?: Handler<K>[] } = {};
  private now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  on<K extends keyof TimerEvents>(type: K, fn: Handler<K>): () => void {
    const existing = this.handlers[type] as Handler<K>[] | undefined;
    const list: Handler<K>[] = existing ?? [];
    (this.handlers as Record<string, unknown>)[type] = list;
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }
  private emit<K extends keyof TimerEvents>(type: K, e: TimerEvents[K]) {
    for (const fn of [...((this.handlers[type] ?? []) as Handler<K>[])]) fn(e);
  }

  get running(): boolean {
    return this.phaseIdx >= 0 && this.phaseIdx < PHASES.length;
  }
  get finished(): boolean {
    return this.phaseIdx >= PHASES.length;
  }
  get paused(): boolean {
    return this.pausedLeft !== null;
  }
  get phase(): PhaseDef | null {
    return this.running ? PHASES[this.phaseIdx] : null;
  }

  leftMs(now = this.now()): number {
    return this.pausedLeft !== null ? this.pausedLeft : this.endAt - now;
  }

  start(timerOnly = false) {
    this.timerOnly = timerOnly;
    this.enterPhase(0);
  }

  private enterPhase(i: number) {
    this.phaseIdx = i;
    if (i >= PHASES.length) {
      this.emit("finish", undefined);
      return;
    }
    const p = PHASES[i];
    this.endAt = this.now() + p.secs * 1000;
    this.pausedLeft = null;
    this.warned = false;
    this.silentEnd = false;
    this.emit("phase", { index: i, phase: p });
    this.tick();
  }

  pause() {
    if (!this.running || this.pausedLeft !== null) return;
    this.pausedLeft = Math.max(0, this.endAt - this.now());
    this.emit("pause", undefined);
    this.tick();
  }

  resume() {
    if (!this.running || this.pausedLeft === null) return;
    this.endAt = this.now() + this.pausedLeft;
    this.pausedLeft = null;
    this.emit("resume", undefined);
    this.tick();
  }

  skip() {
    if (this.running) this.enterPhase(this.phaseIdx + 1);
  }

  reset() {
    this.phaseIdx = -1;
    this.pausedLeft = null;
    this.warned = false;
    this.emit("reset", undefined);
  }

  /**
   * Adopt a remote state (display side). Emits no phase/warn/end events, so nothing rings.
   * `warned` is preserved within the same phase and pre-set when joining a phase already past its warning.
   */
  seed(index: number, remainingMs: number, paused: boolean, timerOnly: boolean) {
    const p = PHASES[index];
    const changed = index !== this.phaseIdx;
    this.timerOnly = timerOnly;
    this.phaseIdx = index;
    this.endAt = this.now() + remainingMs;
    this.pausedLeft = paused ? remainingMs : null;
    if (changed) {
      this.warned = !!(p.warn && remainingMs <= p.warn * 1000);
      // Joined a phase that has already expired: don't ring an end bell we weren't present for.
      this.silentEnd = remainingMs <= 0 && !paused;
      this.emit("phase", { index, phase: p });
    }
    this.tick();
  }

  tick(now = this.now()) {
    if (!this.running) return;
    const p = PHASES[this.phaseIdx];
    const left = this.leftMs(now);
    this.emit("tick", { leftMs: left });
    if (p.warn && !this.warned && this.pausedLeft === null && left > 0 && left <= p.warn * 1000) {
      this.warned = true;
      this.emit("warn", { index: this.phaseIdx, phase: p });
    }
    if (this.pausedLeft === null && left <= 0) {
      if (!this.silentEnd) this.emit("end", { index: this.phaseIdx, phase: p });
      this.enterPhase(this.phaseIdx + 1);
    }
  }
}

export function fmt(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
