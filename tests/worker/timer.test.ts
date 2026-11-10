import { describe, expect, it } from "vitest";
import { fmt, PHASES, Timer } from "../../web/src/timer";

function setup() {
  let t = 0;
  const timer = new Timer(() => t);
  const log: string[] = [];
  timer.on("phase", (e) => log.push(`phase:${e.phase.id}`));
  timer.on("warn", (e) => log.push(`warn:${e.phase.id}`));
  timer.on("end", (e) => log.push(`end:${e.phase.id}`));
  timer.on("finish", () => log.push("finish"));
  const advance = (ms: number) => {
    t += ms;
    timer.tick();
  };
  return { timer, log, advance };
}

describe("Timer", () => {
  it("runs reading 1:00, history 6:00, question 1:00 with warn at 1:00 left and end events", () => {
    expect(PHASES.map((p) => p.secs)).toEqual([60, 360, 60]);
    const { timer, log, advance } = setup();
    timer.start();
    advance(60_000);
    advance(300_000); // 60 s left in history
    expect(log).toEqual(["phase:reading", "end:reading", "phase:history", "warn:history"]);
    advance(60_000);
    advance(60_000);
    expect(log.slice(4)).toEqual(["end:history", "phase:question", "end:question", "finish"]);
    expect(timer.finished).toBe(true);
  });
  it("skip never produces end/warn events", () => {
    const { timer, log } = setup();
    timer.start();
    timer.skip();
    timer.skip();
    timer.skip();
    expect(log).toEqual(["phase:reading", "phase:history", "phase:question", "finish"]);
  });
  it("pause freezes the clock and resume continues from where it stopped", () => {
    const { timer, advance } = setup();
    timer.start();
    advance(10_000);
    timer.pause();
    advance(500_000);
    expect(timer.leftMs()).toBe(50_000);
    expect(timer.phaseIdx).toBe(0);
    timer.resume();
    advance(50_000);
    expect(timer.phaseIdx).toBe(1);
  });
  it("seed adopts remote state silently and does not ring a past warning", () => {
    const { timer, log } = setup();
    timer.seed(1, 30_000, false, false);
    timer.tick();
    expect(log).toEqual(["phase:history"]);
    expect(timer.warned).toBe(true);
  });
  it("seed into an already-expired phase does not ring end", () => {
    const { timer, log } = setup();
    timer.seed(1, 0, false, false);
    expect(log.some((e) => e.startsWith("end"))).toBe(false);
  });
  it("fmt rounds up to whole seconds", () => {
    expect(fmt(60_000)).toBe("1:00");
    expect(fmt(59_001)).toBe("1:00");
    expect(fmt(0)).toBe("0:00");
    expect(fmt(-5)).toBe("0:00");
  });
});
