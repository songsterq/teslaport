import { describe, it, expect } from "vitest";
import { resolveStorage, memoryStore } from "../../src/client/storage";
import type { KeyValueStore } from "../../src/shared/replay";

const throwing = (): KeyValueStore => {
  throw new DOMException("The operation is insecure.", "SecurityError");
};

/** A store that exists but rejects writes, like a browser at its quota. */
function writeRejectingStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: () => {
      throw new DOMException("quota", "QuotaExceededError");
    },
    removeItem: (key) => void map.delete(key),
  };
}

describe("resolveStorage", () => {
  it("uses the real store when it works", () => {
    const backing = memoryStore();
    const { store, volatile } = resolveStorage(() => backing);
    expect(volatile).toBe(false);
    store.setItem("k", "v");
    expect(backing.getItem("k")).toBe("v");
  });

  it("leaves no probe key behind", () => {
    const backing = memoryStore();
    resolveStorage(() => backing);
    expect(backing.getItem("teslaport:storage-probe")).toBeNull();
  });

  /**
   * Reading `window.localStorage` throws outright when a browser blocks site
   * data. Every page that touched it at module scope died before rendering.
   */
  it("falls back to memory when reading the store throws", () => {
    const { store, volatile } = resolveStorage(throwing);
    expect(volatile).toBe(true);
    expect(() => store.setItem("k", "v")).not.toThrow();
    expect(store.getItem("k")).toBe("v");
  });

  it("falls back to memory when the store rejects the probe write", () => {
    const { store, volatile } = resolveStorage(writeRejectingStore);
    expect(volatile).toBe(true);
    store.setItem("k", "v");
    expect(store.getItem("k")).toBe("v");
  });

  it("survives a store that starts failing after the probe", () => {
    let failing = false;
    const map = new Map<string, string>();
    const flaky: KeyValueStore = {
      getItem: (key) => {
        if (failing) throw new Error("gone");
        return map.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (failing) throw new Error("gone");
        map.set(key, value);
      },
      removeItem: (key) => {
        if (failing) throw new Error("gone");
        map.delete(key);
      },
    };

    const { store, volatile } = resolveStorage(() => flaky);
    expect(volatile).toBe(false);
    failing = true;
    // A lost write is recoverable; a throw here would kill the whole page.
    expect(() => store.setItem("k", "v")).not.toThrow();
    expect(() => store.removeItem("k")).not.toThrow();
    expect(store.getItem("k")).toBeNull();
  });
});

describe("memoryStore", () => {
  it("round-trips and removes", () => {
    const store = memoryStore();
    expect(store.getItem("k")).toBeNull();
    store.setItem("k", "v");
    expect(store.getItem("k")).toBe("v");
    store.removeItem("k");
    expect(store.getItem("k")).toBeNull();
  });
});
