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
};

/**
 * Explicit allow-list: every key is written out by hand. The case is only ever read for
 * `title` and `intro`; the question, answer and sections are never referenced here.
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
  });
  if (!out) throw new Error("invalid snapshot");
  return out;
}
