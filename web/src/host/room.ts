import { CLOSE, type DisplaySnapshot, parseServerMsg, type ServerToHost } from "../../../worker/protocol";
import { buildSnapshot, type HostView } from "../snapshot";
import { Connection, wsUrl } from "../sync";

const KEY = "osce-room";

type Saved = { code: string; token: string };

export type RoomUi = {
  code: string | null;
  connected: boolean; // our socket to the server is open
  notice: string; // e.g. "Room expired"
};

/** Host side of the room: creates/reclaims a room, relays snapshots, tracks display count. */
export class HostRoom {
  ui: RoomUi = { code: null, connected: false, notice: "" };
  private conn: Connection | null = null;
  private seq = 0;
  private pushQueued = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private getView: () => Omit<HostView, "seq">,
    private onChange: () => void,
    private onReplaced: (code: string) => void = () => {},
  ) {}

  private saved(): Saved | null {
    try {
      const v = JSON.parse(sessionStorage.getItem(KEY) || "null");
      return v && typeof v.code === "string" && typeof v.token === "string" ? v : null;
    } catch {
      return null;
    }
  }

  /** Reclaim the room kept in sessionStorage after a page refresh. */
  reclaim(): boolean {
    const s = this.saved();
    if (s) this.attach(s);
    return s !== null;
  }

  /** Become host of an existing room (a viewer taking over) using its shared token. */
  adopt(code: string, token: string) {
    const s = { code, token };
    try {
      sessionStorage.setItem(KEY, JSON.stringify(s));
    } catch {}
    this.attach(s);
  }

  async create(): Promise<void> {
    this.ui.notice = "";
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const { code, hostToken } = (await res.json()) as { code: string; hostToken: string };
      const s = { code, token: hostToken };
      try {
        sessionStorage.setItem(KEY, JSON.stringify(s));
      } catch {}
      this.attach(s);
    } catch {
      this.ui.notice = "Couldn’t create a room.";
      this.onChange();
    }
  }

  private attach(s: Saved) {
    this.conn?.close();
    this.ui = { code: s.code, connected: false, notice: "" };
    this.conn = new Connection({
      url: () => wsUrl(`/api/rooms/${s.code}/ws?role=host&token=${s.token}`),
      onOpen: () => {
        this.ui.connected = true;
        this.onChange();
        this.push(); // re-send current state on every (re)connect
      },
      onMessage: (data) => {
        const m = parseServerMsg(data) as ServerToHost | null;
        if (!m) return;
        // The room is gone or taken over: start a fresh one.
        if (m.type === "replaced") this.drop(s.code);
        else if (m.type === "error") this.drop();
      },
      onClose: ({ code, willRetry }) => {
        this.ui.connected = false;
        if (!willRetry) {
          this.drop(code === CLOSE.HOST_REPLACED ? s.code : undefined); // 4002 (taken over) or 4003 (room gone)
          return;
        }
        this.onChange();
      },
    });
    this.timer ??= setInterval(() => {
      if (this.getView().status === "running") this.push();
    }, 10_000);
    this.conn.connect();
    this.onChange();
  }

  /** Close the current room on purpose (displays are told) and start a new one with a fresh code. */
  refresh() {
    this.conn?.send({ type: "close" });
    this.drop();
  }

  /** The current room is unusable: forget it and create a new one. `tookOver` is the room another device took. */
  private drop(tookOver?: string) {
    if (!this.conn && !this.ui.code) return; // already dropped (the message and the close event both land here)
    this.conn?.close(); // stop reconnecting
    this.conn = null;
    try {
      sessionStorage.removeItem(KEY);
    } catch {}
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.ui = { code: null, connected: false, notice: "" };
    this.onChange();
    void this.create();
    if (tookOver) this.onReplaced(tookOver);
  }

  get active(): boolean {
    return this.ui.code !== null;
  }

  /** Coalesce several state changes in the same tick into one snapshot. */
  requestPush() {
    if (!this.conn || this.pushQueued) return;
    this.pushQueued = true;
    queueMicrotask(() => {
      this.pushQueued = false;
      this.push();
    });
  }

  private push() {
    if (!this.conn?.isOpen) return;
    const snapshot: DisplaySnapshot = buildSnapshot({ ...this.getView(), seq: ++this.seq });
    this.conn.send({ type: "snapshot", snapshot });
  }
}
