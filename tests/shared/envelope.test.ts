import { describe, it, expect } from "vitest";
import { derivePairing, generateSeed, type Pairing } from "../../src/shared/pairing";
import { seal, openEnvelope, newMessageId, type Payload } from "../../src/shared/envelope";
import { NONCE_BYTES, FRESHNESS_WINDOW_MS } from "../../src/shared/protocol";

const NOW = 1_800_000_000_000;

async function pairing(): Promise<Pairing> {
  return derivePairing(generateSeed());
}

function urlPayload(overrides: Partial<Extract<Payload, { t: "url" }>> = {}): Payload {
  return { t: "url", id: newMessageId(), url: "https://example.com/a", ts: NOW, ...overrides };
}

describe("envelope", () => {
  it("round-trips a url payload", async () => {
    const p = await pairing();
    const payload = urlPayload();
    const result = await openEnvelope(p, await seal(p, payload), NOW);
    expect(result).toEqual({ ok: true, payload });
  });

  it("round-trips an ack payload", async () => {
    const p = await pairing();
    const payload: Payload = { t: "ack", id: newMessageId() };
    const result = await openEnvelope(p, await seal(p, payload), NOW);
    expect(result).toEqual({ ok: true, payload });
  });

  it("prefixes a fresh 12-byte nonce and never repeats it", async () => {
    const p = await pairing();
    const payload = urlPayload();
    const a = await seal(p, payload);
    const b = await seal(p, payload);
    expect(a.slice(0, NONCE_BYTES)).not.toEqual(b.slice(0, NONCE_BYTES));
    expect(a).not.toEqual(b);
  });

  it("rejects a flipped ciphertext bit", async () => {
    const p = await pairing();
    const frame = await seal(p, urlPayload());
    frame[frame.length - 1]! ^= 0x01;
    expect(await openEnvelope(p, frame, NOW)).toEqual({ ok: false, reason: "decrypt" });
  });

  it("rejects a frame sealed under a different key", async () => {
    const a = await pairing();
    const b = await pairing();
    expect(await openEnvelope(b, await seal(a, urlPayload()), NOW)).toEqual({ ok: false, reason: "decrypt" });
  });

  it("rejects a frame whose AAD does not match the roomId", async () => {
    const p = await pairing();
    const frame = await seal(p, urlPayload());
    const wrongAad: Pairing = { ...p, roomIdBytes: new Uint8Array(16).fill(9) };
    expect(await openEnvelope(wrongAad, frame, NOW)).toEqual({ ok: false, reason: "decrypt" });
  });

  it("rejects truncated frames", async () => {
    const p = await pairing();
    expect(await openEnvelope(p, new Uint8Array(4), NOW)).toEqual({ ok: false, reason: "decrypt" });
  });

  it("rejects non-http(s) schemes", async () => {
    const p = await pairing();
    for (const url of ["javascript:alert(1)", "data:text/html,<b>x", "file:///etc/passwd", "not a url"]) {
      const frame = await seal(p, urlPayload({ url }));
      expect(await openEnvelope(p, frame, NOW)).toEqual({ ok: false, reason: "scheme" });
    }
  });

  it("accepts http and https", async () => {
    const p = await pairing();
    for (const url of ["http://example.com/", "https://example.com/x?y=1#z"]) {
      const frame = await seal(p, urlPayload({ url }));
      const result = await openEnvelope(p, frame, NOW);
      expect(result.ok).toBe(true);
    }
  });

  it("rejects timestamps outside the freshness window in both directions", async () => {
    const p = await pairing();
    const old = await seal(p, urlPayload({ ts: NOW - FRESHNESS_WINDOW_MS - 1 }));
    const future = await seal(p, urlPayload({ ts: NOW + FRESHNESS_WINDOW_MS + 1 }));
    expect(await openEnvelope(p, old, NOW)).toEqual({ ok: false, reason: "stale" });
    expect(await openEnvelope(p, future, NOW)).toEqual({ ok: false, reason: "stale" });
  });

  it("accepts timestamps exactly at the window boundary", async () => {
    const p = await pairing();
    const edge = await seal(p, urlPayload({ ts: NOW - FRESHNESS_WINDOW_MS }));
    expect((await openEnvelope(p, edge, NOW)).ok).toBe(true);
  });

  it("does not apply the freshness window to acks", async () => {
    const p = await pairing();
    const frame = await seal(p, { t: "ack", id: newMessageId() });
    expect((await openEnvelope(p, frame, NOW + 10 * FRESHNESS_WINDOW_MS)).ok).toBe(true);
  });

  it("rejects structurally malformed payloads", async () => {
    const p = await pairing();
    const bad = [{ t: "url", id: "x" }, { t: "nope", id: "x" }, { id: "x" }, "a string", 42];
    for (const payload of bad) {
      const frame = await seal(p, payload as unknown as Payload);
      expect(await openEnvelope(p, frame, NOW)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("rejects payloads over the size cap", async () => {
    const p = await pairing();
    const huge = "https://example.com/" + "a".repeat(9000);
    await expect(seal(p, urlPayload({ url: huge }))).rejects.toThrow(/too large/i);
  });

  it("generates distinct message ids", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(newMessageId());
    expect(seen.size).toBe(500);
  });
});
