import { runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { generateCode, generateToken } from "../../worker/codes";
import { CLOSE, CODE_ALPHABET, CODE_RE, parseHostMsg, sanitizeSnapshot } from "../../worker/protocol";
import { createRoom, roomStub } from "../../worker/rooms";
import { connect, createRoomHttp, display, env, host, snap, until } from "./helpers";

describe("code generator", () => {
  it("uses the 24-letter alphabet (no I or O) and 4 characters", () => {
    expect(CODE_ALPHABET).toHaveLength(24);
    expect(CODE_ALPHABET).not.toMatch(/[IO]/);
    for (let i = 0; i < 500; i++) {
      const c = generateCode();
      expect(c).toHaveLength(4);
      expect(c).toMatch(CODE_RE);
    }
  });
  it("tokens are 128 bits of hex", () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{32}$/);
    expect(generateToken()).not.toBe(generateToken());
  });
  it("createRoom retries on collision", async () => {
    const first = await createRoom(env, () => "QQQA");
    expect(first?.code).toBe("QQQA");
    const codes = ["QQQA", "QQQA", "QQQB"];
    const second = await createRoom(env, () => codes.shift() as string);
    expect(second?.code).toBe("QQQB");
  });
  it("createRoom gives up after 10 attempts", async () => {
    await createRoom(env, () => "QQQC");
    let calls = 0;
    const r = await createRoom(env, () => {
      calls++;
      return "QQQC";
    });
    expect(r).toBeNull();
    expect(calls).toBe(10);
  });
});

describe("claim", () => {
  it("rejects an occupied room and accepts reclaim with the same token", async () => {
    const stub = roomStub(env, "CLMA");
    expect(await stub.claim("tokenA", "CLMA")).toBe(true);
    expect(await stub.claim("tokenB", "CLMA")).toBe(false); // freshly claimed, < 2 min
    expect(await stub.claim("tokenA", "CLMA")).toBe(true); // reclaim
  });
});

describe("snapshot allow-list", () => {
  it("strips question, answer and sections", () => {
    const dirty = { ...snap(), question: "Q?", answer: "A", sections: [{ title: "x" }], extra: 1 };
    const clean = sanitizeSnapshot(dirty);
    expect(Object.keys(clean as object).sort()).toEqual([
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
    ]);
    expect(JSON.stringify(clean)).not.toMatch(/Q\?|sections/);
  });
  it("releases review content only in the done phase of a real case", () => {
    const review = { question: "Q?", answer: "A", sections: [{ title: "x", md: "y" }] };
    expect(sanitizeSnapshot({ ...snap({ phase: "history" }), review })?.review).toBeNull();
    expect(sanitizeSnapshot({ ...snap({ phase: "done", timerOnly: true }), review })?.review).toBeNull();
    expect(sanitizeSnapshot({ ...snap({ phase: "done" }), review })?.review).toEqual(review);
    expect(sanitizeSnapshot({ ...snap({ phase: "done" }), review: { ...review, extra: 1 } })?.review).toEqual(
      review,
    );
  });
  it("parseHostMsg drops invalid and oversized messages", () => {
    expect(parseHostMsg("{nope")).toBeNull();
    expect(parseHostMsg(JSON.stringify({ type: "snapshot", snapshot: { seq: "x" } }))).toBeNull();
    expect(parseHostMsg(JSON.stringify({ type: "evil" }))).toBeNull();
    expect(parseHostMsg("x".repeat(70 * 1024))).toBeNull();
    expect(parseHostMsg(JSON.stringify({ type: "snapshot", snapshot: snap() }))?.type).toBe("snapshot");
  });
  it("the server never relays extra keys to displays", async () => {
    const { code, hostToken } = await createRoomHttp();
    const h = await host(code, hostToken);
    const d = await display(code);
    await until(() => d.msgs.some((m) => m.type === "welcome"));
    h.send({ type: "snapshot", snapshot: { ...snap({ status: "lobby" }), question: "SECRET" } });
    await until(() => d.msgs.some((m) => m.type === "snapshot"));
    expect(JSON.stringify(d.msgs)).not.toContain("SECRET");
  });
});

describe("room service", () => {
  it("POST /api/rooms returns a code and token; host can connect, bad token is refused", async () => {
    const { code, hostToken } = await createRoomHttp();
    expect(code).toMatch(CODE_RE);
    const bad = await connect(code, "role=host&token=nope");
    await until(() => bad.client?.closed);
    expect(bad.client?.closed?.code).toBe(CLOSE.NO_ROOM);
    expect(bad.client?.msgs[0]).toEqual({ type: "error", code: "no_room" });
    const h = await host(code, hostToken);
    await until(() => h.msgs.some((m) => m.type === "welcome" && m.code === code));
  });

  it("display with no room gets no_room and 4003", async () => {
    const d = await display("ZZZZ");
    await until(() => d.closed);
    expect(d.msgs[0]).toEqual({ type: "error", code: "no_room" });
    expect(d.closed?.code).toBe(CLOSE.NO_ROOM);
  });

  it("display can join while a station is running and gets the current snapshot", async () => {
    const { code, hostToken } = await createRoomHttp();
    const h = await host(code, hostToken);
    h.send({ type: "snapshot", snapshot: snap({ status: "running", phase: "history", seq: 7 }) });
    await new Promise((r) => setTimeout(r, 50));
    const d = await display(code);
    await until(() => d.msgs.some((m) => m.type === "snapshot" && m.snapshot.seq === 7));
    expect(d.msgs[0]).toMatchObject({ type: "welcome", status: "running" });
    expect(d.closed).toBeNull();
  });

  it("displays stay connected across running -> lobby and receive snapshots", async () => {
    const { code, hostToken } = await createRoomHttp();
    const h = await host(code, hostToken);
    const d = await display(code);
    await until(() => d.msgs.some((m) => m.type === "welcome"));
    h.send({ type: "snapshot", snapshot: snap({ seq: 1 }) });
    await until(() => d.msgs.some((m) => m.type === "snapshot" && m.snapshot.seq === 1));
    h.send({
      type: "snapshot",
      snapshot: snap({ seq: 2, status: "lobby", phase: null, remainingMs: null, stem: null }),
    });
    await until(() => d.msgs.some((m) => m.type === "snapshot" && m.snapshot.seq === 2));
    expect(d.closed).toBeNull();
    const d2 = await display(code);
    await until(() => d2.msgs.some((m) => m.type === "welcome"));
    expect(d2.closed).toBeNull();
  });

  it("displays cannot send commands", async () => {
    const { code, hostToken } = await createRoomHttp();
    const h = await host(code, hostToken);
    const d = await display(code);
    await until(() => d.msgs.some((m) => m.type === "welcome"));
    d.send({ type: "snapshot", snapshot: snap({ stem: "HACKED" }) });
    await new Promise((r) => setTimeout(r, 50));
    expect(h.msgs.some((m) => JSON.stringify(m).includes("HACKED"))).toBe(false);
    const d2 = await display(code);
    await until(() => d2.msgs.some((m) => m.type === "welcome"));
    expect(JSON.stringify(d2.msgs)).not.toContain("HACKED");
  });

  it("a second host socket with a valid token replaces the first (4002)", async () => {
    const { code, hostToken } = await createRoomHttp();
    const h1 = await host(code, hostToken);
    const d = await display(code);
    await until(() => h1.msgs.length > 0);
    const h2 = await host(code, hostToken);
    await until(() => h1.closed);
    expect(h1.closed?.code).toBe(CLOSE.HOST_REPLACED);
    await new Promise((r) => setTimeout(r, 50));
    expect(d.msgs.some((m) => m.type === "host" && m.connected === false)).toBe(false);
    expect(h2.closed).toBeNull();
  });

  it("host disconnect -> alarm -> displays closed with 4004", async () => {
    const { code, hostToken } = await createRoomHttp();
    const h = await host(code, hostToken);
    const d = await display(code);
    await until(() => d.msgs.some((m) => m.type === "welcome"));
    h.ws.close(1000);
    await until(() => d.msgs.some((m) => m.type === "host" && m.connected === false));
    expect(await runDurableObjectAlarm(roomStub(env, code))).toBe(true);
    await until(() => d.closed);
    expect(d.closed?.code).toBe(CLOSE.ROOM_CLOSED);
    // storage cleared: the code is free again
    const late = await display(code);
    await until(() => late.closed);
    expect(late.closed?.code).toBe(CLOSE.NO_ROOM);
  });

  it("host reconnect within the grace period cancels the alarm", async () => {
    const { code, hostToken } = await createRoomHttp();
    const h = await host(code, hostToken);
    const d = await display(code);
    await until(() => d.msgs.some((m) => m.type === "welcome"));
    h.ws.close(1000);
    await until(() => d.msgs.some((m) => m.type === "host" && m.connected === false));
    await host(code, hostToken);
    await until(() => d.msgs.some((m) => m.type === "host" && m.connected === true));
    expect(await runDurableObjectAlarm(roomStub(env, code))).toBe(false);
    expect(d.closed).toBeNull();
  });

  it("host close message closes displays immediately with 4004 and frees the code", async () => {
    const { code, hostToken } = await createRoomHttp();
    const h = await host(code, hostToken);
    const d = await display(code);
    await until(() => d.msgs.some((m) => m.type === "welcome"));
    h.send({ type: "close" });
    await until(() => d.closed);
    expect(d.closed?.code).toBe(CLOSE.ROOM_CLOSED);
    const late = await display(code);
    await until(() => late.closed);
    expect(late.closed?.code).toBe(CLOSE.NO_ROOM);
  });

  it("rejects host messages over 64 KB", async () => {
    const { code, hostToken } = await createRoomHttp();
    const h = await host(code, hostToken);
    await until(() => h.msgs.length > 0);
    h.send("x".repeat(70 * 1024));
    await until(() => h.closed);
    expect(h.closed?.code).toBe(1009);
  });

  it("rate-limits display joins per IP", async () => {
    const { code } = await createRoomHttp();
    const statuses: number[] = [];
    for (let i = 0; i < 130; i++) {
      const { res, client } = await connect(code, "role=display");
      statuses.push(res.status);
      client?.ws.close(1000);
    }
    expect(statuses).toContain(429);
  });
});
