import { DurableObject } from "cloudflare:workers";
import {
  CLOSE,
  type DisplaySnapshot,
  HOST_GRACE_MS,
  MAX_MESSAGE_BYTES,
  PING,
  PONG,
  parseHostMsg,
  type ServerMsg,
  type ServerToHost,
  type Status,
} from "./protocol";

type RoomState = {
  code: string;
  hostToken: string;
  status: Status;
  hostConnected: boolean;
  hostGoneAt: number | null; // Date.now()
  snapshot: DisplaySnapshot | null;
};

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking the object, so hibernation still works.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  private async load(): Promise<RoomState | null> {
    return (await this.ctx.storage.get<RoomState>("state")) ?? null;
  }
  private async save(s: RoomState): Promise<void> {
    await this.ctx.storage.put("state", s);
  }

  /**
   * Claim (or reclaim) this room for a host token.
   * Returns false if the room is occupied: a live host, or a host that disconnected < 2 min ago,
   * holding a different token.
   */
  async claim(hostToken: string, code: string): Promise<boolean> {
    const s = await this.load();
    const now = Date.now();
    if (s && s.hostToken !== hostToken) {
      const occupied = s.hostConnected || (s.hostGoneAt !== null && now - s.hostGoneAt < HOST_GRACE_MS);
      if (occupied) return false;
    }
    if (s && s.hostToken === hostToken) return true; // reclaim
    // Fresh claim. Until a host socket attaches it counts as "gone since now", so abandoned
    // claims are cleaned up by the alarm.
    await this.save({
      code,
      hostToken,
      status: "lobby",
      hostConnected: false,
      hostGoneAt: now,
      snapshot: null,
    });
    await this.ctx.storage.setAlarm(now + HOST_GRACE_MS);
    return true;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("Expected WebSocket", { status: 426 });
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    const state = await this.load();
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    if (role === "host") {
      if (!state || url.searchParams.get("token") !== state.hostToken) {
        // Accept then close with a code, so the browser can tell "room gone" from "network down".
        this.ctx.acceptWebSocket(server, ["rejected"]);
        server.send(JSON.stringify({ type: "error", code: "no_room" } satisfies ServerToHost));
        server.close(CLOSE.NO_ROOM, "no_room");
        return new Response(null, { status: 101, webSocket: client });
      }
      // A second host socket with a valid token replaces the first.
      for (const old of this.ctx.getWebSockets("host")) {
        try {
          this.sendHost(old, { type: "replaced" });
          old.close(CLOSE.HOST_REPLACED, "replaced");
        } catch {}
      }
      this.ctx.acceptWebSocket(server, ["host"]);
      await this.ctx.storage.deleteAlarm();
      state.hostConnected = true;
      state.hostGoneAt = null;
      await this.save(state);
      this.sendHost(server, { type: "welcome", code: state.code });
      this.broadcast({ type: "host", connected: true });
      return new Response(null, { status: 101, webSocket: client });
    }

    if (role === "display") {
      this.ctx.acceptWebSocket(server, ["display"]);
      if (!state) {
        this.reject(server, "no_room", CLOSE.NO_ROOM);
      } else {
        // Displays may join at any time and are brought up to date with the latest snapshot.
        this.send(server, {
          type: "welcome",
          code: state.code,
          status: state.status,
          hostConnected: state.hostConnected,
          // Any viewer may take over as host, so the token is shared with everyone in the room.
          hostToken: state.hostToken,
        });
        if (state.snapshot) this.send(server, { type: "snapshot", snapshot: state.snapshot });
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Bad role", { status: 400 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const tags = this.ctx.getTags(ws);
    if (tags.includes("host")) {
      const size = typeof message === "string" ? message.length : message.byteLength;
      if (size > MAX_MESSAGE_BYTES) {
        ws.close(1009, "message too big");
        return;
      }
      const msg = parseHostMsg(message);
      if (!msg) return; // invalid: drop
      if (msg.type === "ping") {
        ws.send(PONG);
        return;
      }
      if (msg.type === "close") {
        // Host closed the room on purpose: tell displays now instead of after the grace period.
        await this.ctx.storage.deleteAlarm();
        for (const sock of this.ctx.getWebSockets("display")) {
          try {
            this.send(sock, { type: "closed" });
            sock.close(CLOSE.ROOM_CLOSED, "room closed");
          } catch {}
        }
        await this.ctx.storage.deleteAll();
        try {
          ws.close(1000, "closed");
        } catch {}
        return;
      }
      const state = await this.load();
      if (!state) return;
      state.snapshot = msg.snapshot;
      state.status = msg.snapshot.status;
      await this.save(state);
      this.broadcast({ type: "snapshot", snapshot: msg.snapshot });
      return;
    }
    // Displays never send commands: only ping is honoured.
    if (message === PING) ws.send(PONG);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    await this.onGone(ws);
    try {
      ws.close(code, reason);
    } catch {}
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onGone(ws);
  }

  private async onGone(ws: WebSocket): Promise<void> {
    const tags = this.ctx.getTags(ws);
    if (!tags.includes("host")) return;
    // If a replacement host socket is already live, this was not a disconnect.
    const others = this.ctx.getWebSockets("host").filter((s) => s !== ws && s.readyState === WebSocket.OPEN);
    if (others.length > 0) return;
    const state = await this.load();
    if (!state) return;
    state.hostConnected = false;
    state.hostGoneAt = Date.now();
    await this.save(state);
    await this.ctx.storage.setAlarm(state.hostGoneAt + HOST_GRACE_MS);
    this.broadcast({ type: "host", connected: false });
  }

  async alarm(): Promise<void> {
    const state = await this.load();
    if (state?.hostConnected) return;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(JSON.stringify({ type: "closed" } satisfies ServerMsg));
        ws.close(CLOSE.ROOM_CLOSED, "room closed");
      } catch {}
    }
    await this.ctx.storage.deleteAll();
  }

  /* ---- helpers ---- */
  private isRejected(ws: WebSocket): boolean {
    return ws.deserializeAttachment()?.rejected === true;
  }
  private reject(ws: WebSocket, code: "no_room", closeCode: number) {
    ws.serializeAttachment({ rejected: true });
    this.send(ws, { type: "error", code });
    ws.close(closeCode, code);
  }
  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  }
  private sendHost(ws: WebSocket, msg: ServerToHost) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  }
  private broadcast(msg: ServerMsg) {
    for (const ws of this.ctx.getWebSockets("display")) {
      if (!this.isRejected(ws)) this.send(ws, msg);
    }
  }
}
