import { describe, it, expect } from "vitest";
import type { KeyValueStore } from "../../src/shared/replay";
import { resolveSeed, storeSeed, clearSeed, SEED_STORAGE_KEY } from "../../src/client/session";
import { generateSeed } from "../../src/shared/pairing";
import { encodeBase32 } from "../../src/shared/base32";

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("seed resolution", () => {
  it("prefers a valid fragment and adopts it into storage", () => {
    const storage = memoryStore();
    const seed = generateSeed();
    const result = resolveSeed("#" + encodeBase32(seed), storage, "generate");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("fragment");
    expect(result!.seed).toEqual(seed);
    expect(storage.getItem(SEED_STORAGE_KEY)).toBe(encodeBase32(seed));
  });

  it("accepts a dashed fragment", () => {
    const seed = generateSeed();
    const dashed = "#" + (encodeBase32(seed).match(/.{1,6}/g) ?? []).join("-");
    expect(resolveSeed(dashed, memoryStore(), "generate")!.seed).toEqual(seed);
  });

  it("falls back to storage when the fragment is absent", () => {
    const storage = memoryStore();
    const seed = generateSeed();
    storeSeed(storage, seed);
    const result = resolveSeed("", storage, "generate");
    expect(result!.source).toBe("storage");
    expect(result!.seed).toEqual(seed);
  });

  it("ignores a malformed fragment and falls back to storage", () => {
    const storage = memoryStore();
    const seed = generateSeed();
    storeSeed(storage, seed);
    const result = resolveSeed("#not-a-valid-code", storage, "generate");
    expect(result!.source).toBe("storage");
    expect(result!.seed).toEqual(seed);
  });

  it("generates and persists a seed in generate mode when nothing is known", () => {
    const storage = memoryStore();
    const result = resolveSeed("", storage, "generate");
    expect(result!.source).toBe("generated");
    expect(storage.getItem(SEED_STORAGE_KEY)).toBe(encodeBase32(result!.seed));
  });

  it("returns null in require mode when nothing is known", () => {
    expect(resolveSeed("", memoryStore(), "require")).toBeNull();
  });

  it("ignores corrupt stored seeds", () => {
    const storage = memoryStore();
    storage.setItem(SEED_STORAGE_KEY, "garbage");
    expect(resolveSeed("", storage, "require")).toBeNull();
  });

  it("clears the stored seed", () => {
    const storage = memoryStore();
    storeSeed(storage, generateSeed());
    clearSeed(storage);
    expect(storage.getItem(SEED_STORAGE_KEY)).toBeNull();
  });
});
