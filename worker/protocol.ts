// Shared by worker/ and web/. Keep free of runtime-specific imports.

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O
export const CODE_LENGTH = 4;
export const CODE_RE = /^[A-HJ-NP-Z]{4}$/;
export const MAX_MESSAGE_BYTES = 64 * 1024;
export const HOST_GRACE_MS = 2 * 60 * 1000;

/** WebSocket close codes. */
export const CLOSE = {
  IN_PROGRESS: 4001,
  HOST_REPLACED: 4002,
  NO_ROOM: 4003,
  ROOM_CLOSED: 4004,
} as const;

export type Status = "lobby" | "running";
export type Phase = "ready" | "reading" | "history" | "question" | "done";

export type DisplaySnapshot = {
  seq: number; // monotonically increasing per host session
  sessionId: string; // new per station start
  status: Status;
  phase: Phase | null;
  remainingMs: number | null; // at send time
  paused: boolean;
  timerOnly: boolean;
  title: string | null;
  stem: string | null; // the case's intro; null in timer-only mode
};

// host -> server
export type HostMsg = { type: "snapshot"; snapshot: DisplaySnapshot } | { type: "close" } | { type: "ping" };

// server -> display
export type ServerMsg =
  | { type: "welcome"; code: string; status: Status; hostConnected: boolean }
  | { type: "snapshot"; snapshot: DisplaySnapshot }
  | { type: "host"; connected: boolean }
  | { type: "closed" } // the room was closed (sent just before close code 4004)
  | { type: "error"; code: "in_progress" | "no_room" | "bad_code" }
  | { type: "pong" };

// server -> host
export type ServerToHost =
  | { type: "welcome"; code: string; displays: number }
  | { type: "displays"; count: number }
  | { type: "error"; code: "no_room" }
  | { type: "replaced" } // another host socket took over (sent just before close code 4002)
  | { type: "pong" };

export const PING = '{"type":"ping"}';
export const PONG = '{"type":"pong"}';

const PHASES: readonly string[] = ["ready", "reading", "history", "question", "done"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const strOrNull = (v: unknown, max: number): string | null | undefined =>
  v === null ? null : typeof v === "string" && v.length <= max ? v : undefined;

/**
 * Explicit allow-list: copies ONLY the known snapshot keys and validates each.
 * Returns null when the input is malformed. Used on the host to build snapshots
 * and on the server as defence in depth, so question/answer/sections can never
 * reach a display even if a caller passes extra keys.
 */
export function sanitizeSnapshot(v: unknown): DisplaySnapshot | null {
  if (!isObj(v)) return null;
  const { seq, sessionId, status, phase, remainingMs, paused, timerOnly, title, stem } = v;
  if (typeof seq !== "number" || !Number.isFinite(seq)) return null;
  if (typeof sessionId !== "string" || sessionId.length > 64) return null;
  if (status !== "lobby" && status !== "running") return null;
  if (phase !== null && (typeof phase !== "string" || !PHASES.includes(phase))) return null;
  if (remainingMs !== null && (typeof remainingMs !== "number" || !Number.isFinite(remainingMs))) return null;
  if (typeof paused !== "boolean" || typeof timerOnly !== "boolean") return null;
  const t = strOrNull(title, 500);
  const s = strOrNull(stem, 5000);
  if (t === undefined || s === undefined) return null;
  return {
    seq,
    sessionId,
    status,
    phase: phase as Phase | null,
    remainingMs: remainingMs as number | null,
    paused,
    timerOnly,
    title: t,
    stem: s,
  };
}

export function parseHostMsg(raw: unknown): HostMsg | null {
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v)) return null;
  if (v.type === "ping") return { type: "ping" };
  if (v.type === "close") return { type: "close" };
  if (v.type === "snapshot") {
    const snapshot = sanitizeSnapshot(v.snapshot);
    return snapshot ? { type: "snapshot", snapshot } : null;
  }
  return null;
}

export function parseServerMsg(raw: unknown): ServerMsg | ServerToHost | null {
  if (typeof raw !== "string") return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || typeof v.type !== "string") return null;
  switch (v.type) {
    case "pong":
      return { type: "pong" };
    case "closed":
      return { type: "closed" };
    case "replaced":
      return { type: "replaced" };
    case "welcome":
      if (typeof v.code !== "string") return null;
      if (typeof v.displays === "number") return { type: "welcome", code: v.code, displays: v.displays };
      if ((v.status === "lobby" || v.status === "running") && typeof v.hostConnected === "boolean")
        return { type: "welcome", code: v.code, status: v.status, hostConnected: v.hostConnected };
      return null;
    case "displays":
      return typeof v.count === "number" ? { type: "displays", count: v.count } : null;
    case "host":
      return typeof v.connected === "boolean" ? { type: "host", connected: v.connected } : null;
    case "error":
      if (v.code === "no_room") return { type: "error", code: "no_room" };
      return v.code === "in_progress" || v.code === "no_room" || v.code === "bad_code"
        ? { type: "error", code: v.code }
        : null;
    case "snapshot": {
      const snapshot = sanitizeSnapshot(v.snapshot);
      return snapshot ? { type: "snapshot", snapshot } : null;
    }
    default:
      return null;
  }
}

export function normalizeCode(input: string): string {
  return input.trim().toUpperCase();
}
