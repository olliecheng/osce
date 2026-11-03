import { describe, expect, it } from "vitest";
import { parseCase } from "../../web/src/case";
import { TEMPLATE } from "../../web/src/host/content";
import { buildSnapshot } from "../../web/src/snapshot";

const KEYS = [
  "paused",
  "phase",
  "remainingMs",
  "review",
  "seq",
  "sessionId",
  "status",
  "stem",
  "timerOnly",
  "title",
];
const c = parseCase(TEMPLATE, "x.md");

describe("buildSnapshot privacy allow-list", () => {
  it("contains exactly the allowed keys and never the question, answer or sections", () => {
    const s = buildSnapshot({
      seq: 3,
      sessionId: "abc",
      status: "running",
      phase: "history",
      remainingMs: 123456.7,
      paused: false,
      timerOnly: false,
      case: c,
    });
    expect(Object.keys(s).sort()).toEqual(KEYS);
    expect(s.stem).toBe(c?.intro);
    expect(s.remainingMs).toBe(123457);
    const json = JSON.stringify(s);
    expect(json).not.toContain(c?.question as string);
    expect(json).not.toContain("acute coronary syndrome");
    expect(json).not.toContain("Peter Walsh, 62, retired electrician");
  });
  it("includes the review only once the station is done", () => {
    const base = { seq: 1, sessionId: "a", status: "lobby", remainingMs: null, paused: false } as const;
    const done = buildSnapshot({ ...base, phase: "done", timerOnly: false, case: c });
    expect(done.review?.question).toBe(c?.question);
    expect(done.review?.sections.length).toBe(c?.sections.length);
    expect(buildSnapshot({ ...base, phase: "done", timerOnly: true, case: c }).review).toBeNull();
    const marked = buildSnapshot({
      ...base,
      phase: "done",
      timerOnly: false,
      case: c,
      checked: ["0:1", "1:0"],
    });
    expect(marked.review?.checked).toEqual(["0:1", "1:0"]);
    const running = buildSnapshot({ ...base, phase: "history", timerOnly: false, case: c, checked: ["0:1"] });
    expect(JSON.stringify(running)).not.toContain("0:1");
    expect(buildSnapshot({ ...base, phase: "question", timerOnly: false, case: c }).review).toBeNull();
  });
  it("sends no stem in timer-only mode or without a case", () => {
    const base = {
      seq: 1,
      sessionId: "a",
      status: "running",
      phase: "reading",
      remainingMs: 1,
      paused: false,
    } as const;
    expect(buildSnapshot({ ...base, timerOnly: true, case: c }).stem).toBeNull();
    expect(buildSnapshot({ ...base, timerOnly: false, case: null }).stem).toBeNull();
  });
});
