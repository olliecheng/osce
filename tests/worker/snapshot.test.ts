import { describe, expect, it } from "vitest";
import { parseCase } from "../../web/src/case";
import { TEMPLATE } from "../../web/src/host/content";
import { buildSnapshot } from "../../web/src/snapshot";

const KEYS = ["paused", "phase", "remainingMs", "seq", "sessionId", "status", "stem", "timerOnly", "title"];
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
