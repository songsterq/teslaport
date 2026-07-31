import type { KeyValueStore } from "../shared/replay";

/** An in-memory stand-in for `window.localStorage`. */
export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

export interface ResolvedStorage {
  store: KeyValueStore;
  /**
   * True when `localStorage` was unusable and the in-memory stand-in is in
   * play — nothing written this session will survive a reload.
   */
  volatile: boolean;
}

const PROBE_KEY = "teslaport:storage-probe";

/**
 * Wraps a real store so a late failure degrades instead of throwing.
 *
 * The probe below catches storage that is blocked outright, but a write can
 * still fail afterwards (quota, or a browser that only rejects at write time).
 * A throw from any of these would kill the page it happens on, and the car has
 * no developer tools — a lost write is recoverable, a dead screen is not.
 */
function guard(store: KeyValueStore): KeyValueStore {
  return {
    getItem(key) {
      try {
        return store.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        store.setItem(key, value);
      } catch {
        // Dropped. The page keeps working with whatever is already in memory.
      }
    },
    removeItem(key) {
      try {
        store.removeItem(key);
      } catch {
        // Same.
      }
    },
  };
}

/**
 * `localStorage` if it genuinely works, an in-memory stand-in otherwise.
 *
 * Reading `window.localStorage` throws outright when a browser is configured to
 * block site data, so every page that touched it at module scope died before
 * rendering anything. That is the worst failure this app can have: a blank
 * screen in a car, with no developer tools and no way to find out why.
 *
 * The probe is a real write-read-delete rather than a `typeof` check, because
 * the property can exist and still reject every operation.
 */
export function resolveStorage(
  read: () => KeyValueStore = () => window.localStorage,
): ResolvedStorage {
  try {
    const store = read();
    store.setItem(PROBE_KEY, "1");
    const usable = store.getItem(PROBE_KEY) === "1";
    store.removeItem(PROBE_KEY);
    if (usable) return { store: guard(store), volatile: false };
  } catch {
    // Fall through to the stand-in.
  }
  return { store: memoryStore(), volatile: true };
}
