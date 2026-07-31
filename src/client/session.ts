import { encodeBase32 } from "../shared/base32";
import type { Bytes } from "../shared/bytes";
import { parseSeedCode, generateSeed, SEED_BYTES } from "../shared/pairing";
import type { KeyValueStore } from "../shared/replay";

export const SEED_STORAGE_KEY = "teslaport:seed";

export type SeedSource = "fragment" | "storage" | "generated";
export type ResolveMode = "generate" | "require";

export interface ResolvedSeed {
  seed: Bytes;
  source: SeedSource;
}

function tryParse(code: string | null): Bytes | null {
  if (!code) return null;
  try {
    const seed = parseSeedCode(code);
    return seed.length === SEED_BYTES ? seed : null;
  } catch {
    return null;
  }
}

export function storeSeed(storage: KeyValueStore, seed: Bytes): void {
  storage.setItem(SEED_STORAGE_KEY, encodeBase32(seed));
}

export function clearSeed(storage: KeyValueStore): void {
  storage.removeItem(SEED_STORAGE_KEY);
}

export function resolveSeed(
  fragment: string,
  storage: KeyValueStore,
  mode: ResolveMode,
): ResolvedSeed | null {
  const fromFragment = tryParse(fragment.replace(/^#/, ""));
  if (fromFragment) {
    storeSeed(storage, fromFragment);
    return { seed: fromFragment, source: "fragment" };
  }

  const fromStorage = tryParse(storage.getItem(SEED_STORAGE_KEY));
  if (fromStorage) return { seed: fromStorage, source: "storage" };
  if (mode === "require") return null;

  const seed = generateSeed();
  storeSeed(storage, seed);
  return { seed, source: "generated" };
}
