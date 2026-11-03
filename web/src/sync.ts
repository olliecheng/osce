import { PING } from "../../worker/protocol";

export type ConnectionOpts = {
  url: () => string;
  onOpen?: () => void;
  onMessage: (data: string) => void;
  /** Fired on every close (including those that will be retried). */
  onClose?: (info: { code: number; willRetry: boolean }) => void;
};

/** Close codes that mean "do not reconnect": in_progress, host replaced, no room, room closed. */
const TERMINAL = new Set([4001, 4002, 4003, 4004]);

/** WebSocket client with exponential backoff (0.5 s to 10 s, with jitter) and a 25 s ping. */
export class Connection {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(private opts: ConnectionOpts) {}

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect() {
    this.stopped = false;
    this.open();
  }

  private open() {
    if (this.stopped) return;
    const ws = new WebSocket(this.opts.url());
    this.ws = ws;
    ws.addEventListener("open", () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.pingTimer = setInterval(() => this.sendRaw(PING), 25_000);
      this.opts.onOpen?.();
    });
    ws.addEventListener("message", (e) => {
      if (this.ws === ws && typeof e.data === "string") this.opts.onMessage(e.data);
    });
    ws.addEventListener("close", (e) => {
      if (this.ws !== ws) return;
      this.clearPing();
      this.ws = null;
      const willRetry = !this.stopped && !TERMINAL.has(e.code);
      this.opts.onClose?.({ code: e.code, willRetry });
      if (willRetry) this.scheduleRetry();
    });
  }

  private scheduleRetry() {
    const base = Math.min(10_000, 500 * 2 ** this.attempt++);
    const delay = base / 2 + Math.random() * (base / 2);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private clearPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private sendRaw(s: string): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(s);
    return true;
  }

  send(msg: unknown): boolean {
    return this.sendRaw(JSON.stringify(msg));
  }

  close(code = 1000) {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.clearPing();
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close(code);
    } catch {}
  }
}

export function wsUrl(path: string): string {
  const u = new URL(path, location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}
