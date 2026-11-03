import { CLOSE, CODE_RE, normalizeCode, type ServerMsg } from "./protocol";
import { createRoom, roomStub } from "./rooms";

export { Room } from "./room";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/** Accept a WebSocket just to deliver an error message and close it. */
function rejectSocket(error: Extract<ServerMsg, { type: "error" }>["code"], closeCode: number): Response {
  const pair = new WebSocketPair();
  const server = pair[1];
  server.accept();
  server.send(JSON.stringify({ type: "error", code: error } satisfies ServerMsg));
  server.close(closeCode, error);
  return new Response(null, { status: 101, webSocket: pair[0] });
}

async function limited(env: Env, request: Request, scope: string): Promise<boolean> {
  if (!env.JOIN_LIMITER) return false;
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const { success } = await env.JOIN_LIMITER.limit({ key: `${scope}:${ip}` });
  return !success;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      if (await limited(env, request, "create")) return json({ error: "rate_limited" }, 429);
      const room = await createRoom(env);
      return room ? json(room) : json({ error: "no_free_code" }, 503);
    }

    const m = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
    if (m) {
      if (request.headers.get("Upgrade") !== "websocket")
        return new Response("Expected WebSocket", { status: 426 });
      const code = normalizeCode(decodeURIComponent(m[1]));
      const role = url.searchParams.get("role");
      if (role !== "host" && role !== "display") return new Response("Bad role", { status: 400 });
      if (role === "display") {
        if (await limited(env, request, "join")) return new Response("Too many requests", { status: 429 });
        if (!CODE_RE.test(code)) return rejectSocket("bad_code", CLOSE.NO_ROOM);
      } else if (!CODE_RE.test(code)) {
        return new Response("Bad code", { status: 400 });
      }
      const fwd = new URL(request.url);
      fwd.searchParams.set("role", role);
      return roomStub(env, code).fetch(new Request(fwd, request));
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
