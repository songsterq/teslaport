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

/**
 * Heartbeat. Served by the Durable Object's auto-response pair, so a ping never
 * wakes the object, never reaches `webSocketMessage`, and never spends rate
 * limit. Both must be byte-exact — the runtime matches the request string
 * literally — so they are written out rather than JSON.stringify'd.
 */
export const PING_FRAME = '{"t":"ping"}';
export const PONG_FRAME = '{"t":"pong"}';

/** How often a client pings while its socket is open. */
export const HEARTBEAT_INTERVAL_MS = 20_000;
/**
 * How long a socket may go without any inbound traffic before it is assumed
 * half-open. Two and a half missed beats, so one dropped pong is not enough to
 * tear down a healthy connection.
 */
export const HEARTBEAT_TIMEOUT_MS = 50_000;

export type ControlMessage =
  | { t: "presence"; receivers: number }
  | { t: "no-receiver" }
  | { t: "pong" }
  | { t: "error"; code: "rate_limited" | "too_large" | "unsupported" };
