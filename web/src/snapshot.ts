import { type DisplaySnapshot, type Phase, type Status, sanitizeSnapshot } from "../../worker/protocol";
import type { CaseData } from "./case";

export type HostView = {
  seq: number;
  sessionId: string;
  status: Status;
  phase: Phase | null;
  remainingMs: number | null;
  paused: boolean;
  timerOnly: boolean;
  case: CaseData | null;
  /** Bullets marked off by the assessor. Only ever read at `done`. */
  checked?: readonly string[];
  /** Bullets flagged red by the assessor. Only ever read at `done`. */
  flagged?: readonly string[];
  /** Assessor's written feedback. Only ever read at `done`. */
  feedback?: string;
};

/**
 * Explicit allow-list: every key is written out by hand. While a station is running the case is
 * only read for `title` and `intro`. The question, answer and sections are read ONLY when
 * `phase === "done"` (the station is over), and sanitizeSnapshot re-enforces that rule.
 */
export function buildSnapshot(v: HostView): DisplaySnapshot {
  const hasCase = !v.timerOnly && v.case !== null;
  const out = sanitizeSnapshot({
    seq: v.seq,
    sessionId: v.sessionId,
    status: v.status,
    phase: v.phase,
    remainingMs: v.remainingMs === null ? null : Math.max(0, Math.round(v.remainingMs)),
    paused: v.paused,
    timerOnly: v.timerOnly,
    title: hasCase ? v.case?.title || null : null,
    stem: hasCase ? v.case?.intro || null : null,
    review:
      hasCase && v.phase === "done"
        ? buildReview(v.case as CaseData, v.checked ?? [], v.flagged ?? [], v.feedback ?? "")
        : null,
  });
  if (!out) throw new Error("invalid snapshot");
  return out;
}

function buildReview(c: CaseData, checked: readonly string[], flagged: readonly string[], feedback: string) {
  return {
    question: c.question || null,
    answer: c.answer || null,
    sections: c.sections.map((s) => ({ title: s.title, md: s.md })),
    checked: [...checked],
    flagged: [...flagged],
    feedback,
  };
}
