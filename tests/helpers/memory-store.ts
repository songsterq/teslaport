import type { KeyValueStore } from "../../src/shared/replay";

/** An in-memory stand-in for `window.localStorage`, used across the store test suites. */
export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}
