import type { KeyValueStore } from "../shared/replay";
import { hasAllowedScheme } from "../shared/envelope";
import { HISTORY_LIMIT } from "../shared/protocol";

const KEY = "teslaport:history";

export interface HistoryEntry {
  id: string;
  url: string;
  ts: number;
}

/**
 * The scheme is re-checked here, not just on the wire. These entries outlive
 * the socket that validated them and are assigned straight to `anchor.href` on
 * every load, so storage is its own trust boundary — a `javascript:` URL that
 * reached it by any route must never make it back onto the page.
 */
function isEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string"
    && typeof v.url === "string"
    && hasAllowedScheme(v.url)
    && typeof v.ts === "number";
}

export function loadHistory(storage: KeyValueStore): HistoryEntry[] {
  const raw = storage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

export function pushHistory(storage: KeyValueStore, entry: HistoryEntry): HistoryEntry[] {
  const current = loadHistory(storage);
  // The return value is rendered directly, so it never gets the load-time
  // filter. Guard here too rather than trusting the caller's types.
  if (!isEntry(entry)) return current;
  const next = [entry, ...current].slice(0, HISTORY_LIMIT);
  storage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function clearHistory(storage: KeyValueStore): void {
  storage.removeItem(KEY);
}
