import type { KeyValueStore } from "./replay";
import type { RejectReason } from "./envelope";

const DROPS_KEY = "teslaport:drops";
const CLOCK_KEY = "teslaport:clockdelta";

/**
 * Every reason a message can be dropped. This is `RejectReason` (the
 * envelope's own rejection reasons) plus "replay", which is decided one
 * layer up by the seen-id store in replay.ts. Deriving from `RejectReason`
 * instead of restating it means a future addition there is a compile error
 * here until the counters (and `REASONS` below) account for it too.
 */
export type DropReason = RejectReason | "replay";
export type DropCounts = Record<DropReason, number>;

const REASONS: DropReason[] = ["decrypt", "malformed", "scheme", "stale", "replay"];

function empty(): DropCounts {
  return { decrypt: 0, malformed: 0, scheme: 0, stale: 0, replay: 0 };
}

export function loadDropCounts(storage: KeyValueStore): DropCounts {
  const counts = empty();
  const raw = storage.getItem(DROPS_KEY);
  if (!raw) return counts;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return counts;
    const record = parsed as Record<string, unknown>;
    for (const reason of REASONS) {
      const value = record[reason];
      if (typeof value === "number" && Number.isFinite(value)) counts[reason] = value;
    }
  } catch {
    // Corrupt data reads as zero rather than throwing on a page we cannot debug.
  }
  return counts;
}

export function bumpDropCount(storage: KeyValueStore, reason: DropReason): DropCounts {
  const counts = loadDropCounts(storage);
  counts[reason] += 1;
  storage.setItem(DROPS_KEY, JSON.stringify(counts));
  return counts;
}

export function recordClockDelta(storage: KeyValueStore, deltaMs: number): void {
  storage.setItem(CLOCK_KEY, String(deltaMs));
}

export function readClockDelta(storage: KeyValueStore): number | null {
  const raw = storage.getItem(CLOCK_KEY);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

const ERRORS_KEY = "teslaport:errors";
const ERROR_LIMIT = 20;

export function loadErrors(storage: KeyValueStore): string[] {
  const raw = storage.getItem(ERRORS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function appendError(storage: KeyValueStore, message: string): void {
  const entries = loadErrors(storage);
  entries.push(`${new Date().toISOString()} ${message}`);
  storage.setItem(ERRORS_KEY, JSON.stringify(entries.slice(-ERROR_LIMIT)));
}

/**
 * Captures uncaught errors to storage. The car has no developer tools, so an
 * error thrown on /r must survive until someone opens /debug in another tab.
 */
export function installErrorCapture(storage: KeyValueStore): void {
  window.addEventListener("error", (event) => {
    appendError(storage, `${event.message} @ ${event.filename}:${event.lineno}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    appendError(storage, `unhandled rejection: ${String((event as PromiseRejectionEvent).reason)}`);
  });
}
