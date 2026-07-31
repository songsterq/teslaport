export const MAX_PAYLOAD_BYTES = 8 * 1024;
/** nonce (12) + ciphertext + GCM tag (16), with headroom. */
export const MAX_FRAME_BYTES = MAX_PAYLOAD_BYTES + 64;
export const NONCE_BYTES = 12;
export const TAG_BITS = 128;
export const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;
export const ACK_TIMEOUT_MS = 3000;
export const RATE_LIMIT_PER_MINUTE = 30;
export const SEEN_ID_LIMIT = 200;
export const HISTORY_LIMIT = 20;

export type ControlMessage =
  | { t: "presence"; receivers: number }
  | { t: "no-receiver" }
  | { t: "error"; code: "rate_limited" | "too_large" | "unsupported" };
