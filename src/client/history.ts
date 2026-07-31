import type { KeyValueStore } from "../shared/replay";
import { HISTORY_LIMIT } from "../shared/protocol";

const KEY = "teslaport:history";

export interface HistoryEntry {
  id: string;
  url: string;
  ts: number;
}

function isEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.url === "string" && typeof v.ts === "number";
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
  const next = [entry, ...loadHistory(storage)].slice(0, HISTORY_LIMIT);
  storage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function clearHistory(storage: KeyValueStore): void {
  storage.removeItem(KEY);
}
