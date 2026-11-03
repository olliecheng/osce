import { env, exports as workerExports } from "cloudflare:workers";
import { vi } from "vitest";
import type { DisplaySnapshot } from "../../worker/protocol";

export { env };

const worker = (workerExports as unknown as { default: Fetcher }).default;

export const snap = (over: Partial<DisplaySnapshot> = {}): DisplaySnapshot => ({
  seq: 1,
  sessionId: "s1",
  status: "running",
  phase: "reading",
  remainingMs: 60000,
  paused: false,
  timerOnly: false,
  title: "T",
  stem: "Stem",
  review: null,
  ...over,
});

export type Client = {
  ws: WebSocket;
  msgs: any[];
  closed: { code: number } | null;
  send: (m: unknown) => void;
};

export async function connect(
  code: string,
  query: string,
): Promise<{ res: Response; client: Client | null }> {
  const res = await worker.fetch(`https://example.com/api/rooms/${code}/ws?${query}`, {
    headers: { Upgrade: "websocket" },
  });
  if (!res.webSocket) return { res, client: null };
  const ws = res.webSocket;
  ws.accept();
  const client: Client = {
    ws,
    msgs: [],
    closed: null,
    send: (m) => ws.send(typeof m === "string" ? m : JSON.stringify(m)),
  };
  ws.addEventListener("message", (e: MessageEvent) => {
    client.msgs.push(JSON.parse(e.data as string));
  });
  ws.addEventListener("close", (e: CloseEvent) => {
    client.closed = { code: e.code };
  });
  return { res, client };
}

export async function createRoomHttp(): Promise<{ code: string; hostToken: string }> {
  const res = await worker.fetch("https://example.com/api/rooms", { method: "POST" });
  return res.json();
}

export const host = async (code: string, token: string) =>
  (await connect(code, `role=host&token=${token}`)).client!;
export const display = async (code: string) => (await connect(code, "role=display")).client!;
export const until = (fn: () => unknown) =>
  vi.waitFor(() => {
    if (!fn()) throw new Error("not yet");
  });
