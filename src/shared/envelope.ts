import type { Pairing } from "./pairing";
import { base64url } from "./pairing";
import type { Bytes } from "./bytes";
import { MAX_PAYLOAD_BYTES, NONCE_BYTES, TAG_BITS, FRESHNESS_WINDOW_MS } from "./protocol";

export type Payload =
  | { t: "url"; id: string; url: string; ts: number }
  | { t: "ack"; id: string };

export type RejectReason = "decrypt" | "malformed" | "scheme" | "stale";

export type OpenResult =
  | { ok: true; payload: Payload }
  /**
   * A stale rejection carries the sender's `ts` — it authenticated, so it is
   * trustworthy, and it is the only way the car can observe a clock skew large
   * enough to reject every message. Reporting the reason alone would leave
   * `/debug` showing "no message received yet" for the single failure mode it
   * exists to diagnose.
   */
  | { ok: false; reason: "stale"; ts: number }
  | { ok: false; reason: Exclude<RejectReason, "stale"> };

const TAG_BYTES = TAG_BITS / 8;

export function newMessageId(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function seal(pairing: Pairing, payload: Payload): Promise<Bytes> {
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  if (plaintext.byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error(`payload too large: ${plaintext.byteLength} > ${MAX_PAYLOAD_BYTES}`);
  }
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: pairing.roomIdBytes, tagLength: TAG_BITS },
      pairing.contentKey,
      plaintext,
    ),
  );
  const frame = new Uint8Array(nonce.length + ciphertext.length);
  frame.set(nonce, 0);
  frame.set(ciphertext, nonce.length);
  return frame;
}

function isValidPayload(value: unknown): value is Payload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.t === "ack") return typeof v.id === "string" && v.id.length > 0;
  if (v.t === "url") {
    return typeof v.id === "string" && v.id.length > 0
      && typeof v.url === "string"
      && typeof v.ts === "number" && Number.isFinite(v.ts);
  }
  return false;
}

function hasAllowedScheme(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function openEnvelope(
  pairing: Pairing,
  frame: Bytes,
  now: number,
): Promise<OpenResult> {
  // A legitimate frame is at minimum nonce ‖ tag (zero-length ciphertext), so
  // anything shorter can never decrypt: reject before touching WebCrypto.
  if (frame.byteLength < NONCE_BYTES + TAG_BYTES) {
    return { ok: false, reason: "decrypt" };
  }
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: frame.slice(0, NONCE_BYTES),
        additionalData: pairing.roomIdBytes,
        tagLength: TAG_BITS,
      },
      pairing.contentKey,
      frame.slice(NONCE_BYTES),
    );
  } catch {
    return { ok: false, reason: "decrypt" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isValidPayload(parsed)) return { ok: false, reason: "malformed" };

  if (parsed.t === "url") {
    if (!hasAllowedScheme(parsed.url)) return { ok: false, reason: "scheme" };
    if (Math.abs(now - parsed.ts) > FRESHNESS_WINDOW_MS) {
      return { ok: false, reason: "stale", ts: parsed.ts };
    }
  }
  return { ok: true, payload: parsed };
}
