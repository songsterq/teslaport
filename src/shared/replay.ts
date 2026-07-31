import { SEEN_ID_LIMIT } from "./protocol";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SeenStore {
  has(id: string): boolean;
  add(id: string): void;
  clear(): void;
}

/**
 * Reads the persisted id list, de-duplicating as it goes. Storage can hold a
 * duplicate id if it was written by a previous version or edited by hand;
 * without de-duplication here, the `Set` built from this array would have
 * fewer entries than the array itself, and the eviction loop in
 * `createSeenStore` could delete a duplicated id from the `Set` while a
 * second copy remains in the array — leaving the two representations out of
 * sync for the rest of the store's lifetime.
 */
function readIds(storage: KeyValueStore, key: string): string[] {
  const raw = storage.getItem(key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const value of parsed) {
      if (typeof value === "string" && !seen.has(value)) {
        seen.add(value);
        ids.push(value);
      }
    }
    return ids;
  } catch {
    return [];
  }
}

export function createSeenStore(
  storage: KeyValueStore,
  key = "teslaport:seen",
  limit = SEEN_ID_LIMIT,
): SeenStore {
  let ids = readIds(storage, key);
  let set = new Set(ids);
  return {
    has: (id) => set.has(id),
    add(id) {
      if (set.has(id)) return;
      ids.push(id);
      set.add(id);
      while (ids.length > limit) {
        const evicted = ids.shift();
        if (evicted !== undefined) set.delete(evicted);
      }
      storage.setItem(key, JSON.stringify(ids));
    },
    clear() {
      ids = [];
      set = new Set();
      storage.removeItem(key);
    },
  };
}
