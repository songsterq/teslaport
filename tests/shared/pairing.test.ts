import { describe, it, expect } from "vitest";
import { hkdfSync } from "node:crypto";
import {
  SEED_BYTES, SEED_CHARS, generateSeed, derivePairing, formatSeedCode,
  parseSeedCode, base64url, buildSenderUrl, buildReceiverUrl,
} from "../../src/shared/pairing";
import type { Bytes } from "../../src/shared/bytes";

function nodeHkdf(seed: Bytes, info: string, length: number): Bytes {
  return new Uint8Array(hkdfSync("sha256", seed, new Uint8Array(0), new TextEncoder().encode(info), length));
}

describe("pairing", () => {
  it("generates 15-byte seeds that encode to 24 characters", () => {
    const seed = generateSeed();
    expect(seed).toHaveLength(SEED_BYTES);
    expect(SEED_BYTES).toBe(15);
    expect(SEED_CHARS).toBe(24);
  });

  it("generates distinct seeds", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(base64url(generateSeed()));
    expect(seen.size).toBe(100);
  });

  it("derives roomId with the exact HKDF parameters from the spec", async () => {
    const seed = new Uint8Array(15).fill(7);
    const pairing = await derivePairing(seed);
    const expected = nodeHkdf(seed, "teslaport:room:v1", 16);
    expect(pairing.roomIdBytes).toEqual(expected);
    expect(pairing.roomId).toBe(base64url(expected));
    expect(pairing.roomId).toHaveLength(22);
    expect(pairing.roomId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("derives a 32-byte contentKey with the exact HKDF parameters from the spec", async () => {
    const seed = new Uint8Array(15).fill(7);
    const pairing = await derivePairing(seed);
    const expectedKeyBytes = nodeHkdf(seed, "teslaport:key:v1", 32);
    const imported = await crypto.subtle.importKey("raw", expectedKeyBytes, "AES-GCM", false, ["encrypt"]);
    const nonce = new Uint8Array(12);
    const a = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, imported, new Uint8Array([1, 2, 3]));
    const b = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, pairing.contentKey, new Uint8Array([1, 2, 3]));
    expect(new Uint8Array(b)).toEqual(new Uint8Array(a));
  });

  it("is a regression lock on the derivation (frozen vector)", async () => {
    const pairing = await derivePairing(new Uint8Array(15));
    expect(pairing.roomId).toBe("alyp7TeWt8fm4PbAeGIKgQ");
  });

  it("derives roomId and contentKey independently", async () => {
    const seed = new Uint8Array(15).fill(7);
    const roomBytes = nodeHkdf(seed, "teslaport:room:v1", 16);
    const keyBytes = nodeHkdf(seed, "teslaport:key:v1", 32);
    expect(keyBytes.slice(0, 16)).not.toEqual(roomBytes);
  });

  it("is deterministic and seed-sensitive", async () => {
    const seed = new Uint8Array(15).fill(7);
    const other = new Uint8Array(15).fill(7);
    other[14] = 8;
    expect((await derivePairing(seed)).roomId).toBe((await derivePairing(seed)).roomId);
    expect((await derivePairing(seed)).roomId).not.toBe((await derivePairing(other)).roomId);
  });

  it("rejects seeds of the wrong length", async () => {
    await expect(derivePairing(new Uint8Array(14))).rejects.toThrow(/15 bytes/);
  });

  it("formats and reparses the display code", async () => {
    const seed = generateSeed();
    const { seedCode } = await derivePairing(seed);
    const formatted = formatSeedCode(seedCode);
    expect(formatted).toMatch(/^[0-9A-Z]{6}-[0-9A-Z]{6}-[0-9A-Z]{6}-[0-9A-Z]{6}$/);
    expect(parseSeedCode(formatted)).toEqual(seed);
    expect(parseSeedCode(seedCode)).toEqual(seed);
  });

  it("builds sender and receiver URLs carrying the bare code in the fragment", () => {
    const code = "0".repeat(24);
    expect(buildSenderUrl("https://teslaport.example", code)).toBe(`https://teslaport.example/s#${code}`);
    expect(buildReceiverUrl("https://teslaport.example", code)).toBe(`https://teslaport.example/r#${code}`);
    // Trailing slashes on origin must not double up.
    expect(buildSenderUrl("https://teslaport.example/", code)).toBe(`https://teslaport.example/s#${code}`);
  });
});
