import { encodeBase32, decodeBase32 } from "./base32";
import type { Bytes } from "./bytes";

export const SEED_BYTES = 15;
export const SEED_CHARS = 24;

const ROOM_INFO = "teslaport:room:v1";
const KEY_INFO = "teslaport:key:v1";
const ROOM_ID_BYTES = 16;
const CONTENT_KEY_BYTES = 32;

export interface Pairing {
  seed: Bytes;
  seedCode: string;
  roomId: string;
  roomIdBytes: Bytes;
  contentKey: CryptoKey;
}

export function generateSeed(): Bytes {
  return crypto.getRandomValues(new Uint8Array(SEED_BYTES));
}

export function base64url(bytes: Bytes): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hkdf(seed: Bytes, info: string, lengthBytes: number): Promise<Bytes> {
  const ikm = await crypto.subtle.importKey("raw", seed, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(info),
    },
    ikm,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

export async function derivePairing(seed: Bytes): Promise<Pairing> {
  if (seed.length !== SEED_BYTES) {
    throw new Error(`seed must be ${SEED_BYTES} bytes, got ${seed.length}`);
  }
  const roomIdBytes = await hkdf(seed, ROOM_INFO, ROOM_ID_BYTES);
  const keyBytes = await hkdf(seed, KEY_INFO, CONTENT_KEY_BYTES);
  const contentKey = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  return {
    seed,
    seedCode: encodeBase32(seed),
    roomId: base64url(roomIdBytes),
    roomIdBytes,
    contentKey,
  };
}

export function formatSeedCode(code: string): string {
  return (code.match(/.{1,6}/g) ?? []).join("-");
}

export function parseSeedCode(text: string): Bytes {
  return decodeBase32(text, SEED_BYTES);
}

function normaliseOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

export function buildSenderUrl(origin: string, seedCode: string): string {
  return `${normaliseOrigin(origin)}/s#${seedCode}`;
}

export function buildReceiverUrl(origin: string, seedCode: string): string {
  return `${normaliseOrigin(origin)}/r#${seedCode}`;
}
