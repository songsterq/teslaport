import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

const ROOM = "AAAAAAAAAAAAAAAAAAAAAA"; // 22 chars, shape-valid
const BASE = "https://teslaport.test";

async function connect(role: "sender" | "receiver", room = ROOM): Promise<WebSocket> {
  const res = await SELF.fetch(`${BASE}/ws/${room}?role=${role}`, {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  ws.binaryType = "arraybuffer";
  return ws;
}

function nextMessage(ws: WebSocket, timeoutMs = 1000): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
    ws.addEventListener(
      "message",
      (event) => {
        clearTimeout(timer);
        resolve(event.data as string | ArrayBuffer);
      },
      { once: true },
    );
  });
}

function expectNoMessage(ws: WebSocket, ms = 200): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    ws.addEventListener(
      "message",
      () => {
        clearTimeout(timer);
        reject(new Error("expected no message, got one"));
      },
      { once: true },
    );
  });
}

async function control(ws: WebSocket): Promise<Record<string, unknown>> {
  const data = await nextMessage(ws);
  expect(typeof data).toBe("string");
  return JSON.parse(data as string);
}

describe("Room durable object", () => {
  it("rejects a missing or bad role", async () => {
    const res = await SELF.fetch(`${BASE}/ws/${ROOM}?role=bogus`, {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects a non-websocket request", async () => {
    const res = await SELF.fetch(`${BASE}/ws/${ROOM}?role=sender`);
    expect(res.status).toBe(426);
  });

  it("tells a sender when there is no receiver", async () => {
    const sender = await connect("sender");
    await control(sender); // initial presence
    const noReceiver = control(sender);
    sender.send(new Uint8Array([1, 2, 3]));
    expect(await noReceiver).toEqual({ t: "no-receiver" });
  });

  it("relays a sender frame to the receiver", async () => {
    const receiver = await connect("receiver", "BBBBBBBBBBBBBBBBBBBBBB");
    const sender = await connect("sender", "BBBBBBBBBBBBBBBBBBBBBB");
    await control(sender); // presence
    const payload = new Uint8Array([9, 8, 7]);
    const received = nextMessage(receiver);
    sender.send(payload);
    const got = await received;
    expect(new Uint8Array(got as ArrayBuffer)).toEqual(payload);
  });

  it("relays a receiver ack back to the sender", async () => {
    const room = "CCCCCCCCCCCCCCCCCCCCCC";
    const sender = await connect("sender", room);
    await control(sender); // initial presence
    const joined = control(sender);
    const receiver = await connect("receiver", room);
    await joined; // presence update on receiver connect
    const ack = new Uint8Array([4, 4, 4]);
    const received = nextMessage(sender);
    receiver.send(ack);
    const got = await received;
    expect(new Uint8Array(got as ArrayBuffer)).toEqual(ack);
  });

  it("fans out to every receiver", async () => {
    const room = "DDDDDDDDDDDDDDDDDDDDDD";
    const r1 = await connect("receiver", room);
    const r2 = await connect("receiver", room);
    const sender = await connect("sender", room);
    await control(sender);
    const payload = new Uint8Array([5]);
    const received = [nextMessage(r1), nextMessage(r2)];
    sender.send(payload);
    for (const message of received) {
      expect(new Uint8Array((await message) as ArrayBuffer)).toEqual(payload);
    }
  });

  it("never relays sender to sender", async () => {
    const room = "EEEEEEEEEEEEEEEEEEEEEE";
    const s1 = await connect("sender", room);
    await control(s1);
    const s2 = await connect("sender", room);
    await control(s2);
    const noMessage = expectNoMessage(s2);
    s1.send(new Uint8Array([1]));
    // s1 gets no-receiver; s2 must get nothing at all.
    await noMessage;
  });

  it("never relays receiver to receiver", async () => {
    const room = "FFFFFFFFFFFFFFFFFFFFFF";
    const r1 = await connect("receiver", room);
    const r2 = await connect("receiver", room);
    const noMessage = expectNoMessage(r2);
    r1.send(new Uint8Array([1]));
    await noMessage;
  });

  it("reports presence on connect and on receiver join", async () => {
    const room = "GGGGGGGGGGGGGGGGGGGGGG";
    const sender = await connect("sender", room);
    expect(await control(sender)).toEqual({ t: "presence", receivers: 0 });
    const joined = control(sender);
    await connect("receiver", room);
    expect(await joined).toEqual({ t: "presence", receivers: 1 });
  });

  it("rejects oversized frames", async () => {
    const room = "HHHHHHHHHHHHHHHHHHHHHH";
    await connect("receiver", room);
    const sender = await connect("sender", room);
    await control(sender);
    const error = control(sender);
    sender.send(new Uint8Array(9000));
    expect(await error).toEqual({ t: "error", code: "too_large" });
  });

  it("rejects text frames", async () => {
    const room = "JJJJJJJJJJJJJJJJJJJJJJ";
    const sender = await connect("sender", room);
    await control(sender);
    const error = control(sender);
    sender.send("hello");
    expect(await error).toEqual({ t: "error", code: "unsupported" });
  });

  it("rate limits after 30 frames in a minute", async () => {
    const room = "KKKKKKKKKKKKKKKKKKKKKK";
    await connect("receiver", room);
    const sender = await connect("sender", room);
    await control(sender);
    const error = control(sender);
    for (let i = 0; i < 30; i++) sender.send(new Uint8Array([1]));
    sender.send(new Uint8Array([1]));
    expect(await error).toEqual({ t: "error", code: "rate_limited" });
  });
});
