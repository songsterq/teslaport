# TeslaPort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an end-to-end encrypted relay that sends a URL from a phone to the Tesla car browser, where no server — including ours — can read the link.

**Architecture:** A Cloudflare Worker serves three static pages (`/r` car receiver, `/s` phone sender, `/debug`) and upgrades `/ws/<roomId>` to a Durable Object that acts as a pure cross-role fan-out switchboard, persisting nothing. Both browsers derive a `roomId` and an AES-256-GCM `contentKey` from one shared 15-byte seed via HKDF; only `roomId` ever reaches the server. The car returns an encrypted `ack` frame, which is the sole trustworthy delivery signal.

**Tech Stack:** TypeScript, Vite (multi-page, no UI framework), Cloudflare Workers + Durable Objects, Wrangler, Vitest (`@cloudflare/vitest-pool-workers` for the DO), Playwright, `qrcode-generator`.

**Spec:** `docs/superpowers/specs/2026-07-30-teslaport-design.md`. Read it before starting. Where this plan and the spec disagree, the spec wins — stop and raise it.

## Global Constraints

Every task's requirements implicitly include this section.

**Hard architectural invariants (from the spec — a change that violates one is out of scope by definition):**

1. **The server can never read a shared link.** Not "does not log"; cannot decrypt.
2. **The server persists nothing.** No `storage.put`, no SQLite table, no KV. Link payloads exist on the server only in transit through an open socket.
3. **No third-party services in the request path.** No analytics, no error-reporting SaaS, no external CDN, no remote fonts.

**Normative crypto parameters — unit tests assert against these verbatim:**

```
seed        = 15 random bytes (120 bits), crypto.getRandomValues
            = exactly 24 Crockford base32 chars

HKDF-SHA256 (RFC 5869)
  salt      = empty (zero-length)
  IKM       = the 15 seed bytes
  roomId    = HKDF(info="teslaport:room:v1", L=16 bytes) → base64url unpadded, 22 chars
  contentKey= HKDF(info="teslaport:key:v1",  L=32 bytes) → AES-256-GCM

AES-256-GCM
  nonce     = 96-bit (12 bytes), fresh per message, crypto.getRandomValues
  tag       = 128-bit
  AAD       = the 16 roomId bytes
  wire      = nonce ‖ ciphertext, binary WebSocket frame

Freshness window = ±5 minutes on ts
Recent-id set    = 200 entries, car localStorage
Max payload      = 8 KB plaintext
Rate limit       = 30 messages per minute, per socket, both roles
History          = 20 entries, car localStorage
Ack timeout      = 3 seconds
```

**Byte arrays and TypeScript 7:**

TypeScript 7 made typed arrays generic over their backing buffer. A bare
`Uint8Array` means `Uint8Array<ArrayBufferLike>`, which is **not** assignable to
DOM's `BufferSource` — so it cannot be passed to any `crypto.subtle` call. Every
module here crosses that boundary.

`src/shared/bytes.ts` exports the one alias the whole project uses:

```ts
/**
 * A Uint8Array pinned to a non-shared ArrayBuffer. TypeScript 7's typed arrays
 * are generic over their buffer, and only this form satisfies DOM's
 * `BufferSource` — a bare `Uint8Array` is rejected by every crypto.subtle call.
 */
export type Bytes = Uint8Array<ArrayBuffer>;
```

**Use `Bytes`, never a bare `Uint8Array`, in every exported signature, interface
field, and local annotation that holds raw bytes.** Do not reach for
`as BufferSource` casts — a cast silences the checker at one call site and
leaves the next one to rediscover the problem.

**Other project-wide rules:**

- **Output target ES2019.** No top-level await, no optional chaining in emitted client code beyond what ES2019 allows (TypeScript will downlevel), no exotic APIs. The Tesla browser is Chromium of unknown vintage and has **no developer tools**.
- **Crockford base32 alphabet** is exactly `0123456789ABCDEFGHJKMNPQRSTVWXYZ` — excludes I, L, O, U. Decoding is case-insensitive and maps `O`→`0`, `I`→`1`, `L`→`1`. `U` is rejected.
- **The Durable Object class must be SQLite-backed** (`new_sqlite_classes` in the migration) — this is required to run Durable Objects on Cloudflare's free plan. It stores nothing; the backing type is a billing/plan requirement, not a place to put data.
- **Commit after every task.** Never use `--no-verify`. Never add a Co-Authored-By line.
- Binary frames carry envelopes. JSON text frames carry control messages. The two are never mixed.

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/base32.ts` | Crockford base32 encode/decode. Pure. |
| `src/shared/pairing.ts` | Seed generation, HKDF derivation, roomId/key, URL builders. |
| `src/shared/envelope.ts` | AES-GCM seal/open, payload shape + scheme + freshness validation. Pure over bytes. |
| `src/shared/replay.ts` | Recent-message-id set backed by a storage interface. |
| `src/shared/diagnostics.ts` | Persisted drop counters, clock delta, and rolling error log. |
| `src/shared/socket.ts` | Reconnecting WebSocket client + backoff computation. |
| `src/shared/protocol.ts` | Shared constants and control-message types. |
| `src/worker/room.ts` | Durable Object switchboard: fan-out, presence, caps. |
| `src/worker/index.ts` | Routing, WS upgrade, static assets, security headers. |
| `src/client/history.ts` | Car's received-link history store. |
| `src/client/session.ts` | Seed resolution from fragment or storage; shared by all three pages. |
| `src/client/qr.ts` | QR rendering wrapper. |
| `src/client/receiver.ts` | Car page controller. |
| `src/client/sender.ts` | Phone page controller. |
| `src/client/debug.ts` | Diagnostics page. |
| `src/client/app.css` | Shared dark, high-contrast styles. |
| `index.html`, `r/index.html`, `s/index.html`, `debug/index.html` | Page shells. |
| `tests/shared/*.test.ts` | Unit tests (node pool). |
| `tests/worker/room.test.ts` | DO tests (workers pool). |
| `tests/e2e/*.spec.ts` | Playwright integration. |
| `docs/in-car-checklist.md` | Manual verification steps. |

---

### Task 1: Toolchain scaffolding and Crockford base32

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `wrangler.jsonc`, `vitest.config.ts`, `.gitignore`
- Create: `src/shared/base32.ts`
- Test: `tests/shared/base32.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `encodeBase32(bytes: Uint8Array): string`, `decodeBase32(text: string, expectedBytes: number): Uint8Array`, `CROCKFORD_ALPHABET: string`.

- [ ] **Step 1: Initialise the project and install dependencies**

```bash
npm init -y
npm install --save-dev typescript vite wrangler vitest @cloudflare/vitest-pool-workers @cloudflare/workers-types @types/node
npm install --save qrcode-generator
```

- [ ] **Step 2: Write the config files**

`package.json` — replace the `scripts` block with:

```json
{
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "npm run build && wrangler dev",
    "deploy": "npm run build && wrangler deploy",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.test.json --noEmit"
  }
}
```

**Three tsconfigs, one per runtime environment.** A single config with every
`types` entry lets browser code reference `process`, `Buffer`, or Workers-only
globals, pass `tsc`, and then fail at runtime in a car with no developer tools.
`src/shared/**` is the code that must run in *both* a Workers isolate and the
car browser, so it appears in two configs and sees the ambients of neither.

`tsconfig.json` — the base, and the browser/shared surface:

```json
{
  "compilerOptions": {
    "target": "ES2019",
    "lib": ["ES2019", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src/shared", "src/client"]
}
```

`tsconfig.worker.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "types": ["@cloudflare/workers-types"] },
  "include": ["src/worker", "src/shared"]
}
```

`tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["tests"]
}
```

Verify the split actually bites rather than assuming it: a file under
`src/shared/` referencing `process.env` must **fail** `tsc -p tsconfig.json`.

`vite.config.ts`:

Note: `package.json` sets `"type": "module"`, so `__dirname` does not exist in this file. Resolve from `import.meta.url` instead.

**Do not run `npm run build` before Task 7.** The HTML entry points these inputs reference are created there; the build will fail until then. Tasks 1–6 are exercised entirely through `npx vitest`.

```ts
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const page = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  build: {
    target: "es2019",
    outDir: "dist/client",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: page("./index.html"),
        receiver: page("./r/index.html"),
        sender: page("./s/index.html"),
        debug: page("./debug/index.html"),
      },
    },
  },
});
```

`wrangler.jsonc` — `html_handling` is pinned deliberately. Vite emits `r/index.html`, and the app's URLs are `/r` with no trailing slash; the default behaviour is a common source of 404s. `auto-trailing-slash` serves `/r` from `r/index.html` without a redirect.

```jsonc
{
  "name": "teslaport",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-07-01",
  "assets": {
    "directory": "./dist/client",
    "binding": "ASSETS",
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "404-page"
  },
  "durable_objects": {
    "bindings": [{ "name": "ROOM", "class_name": "Room" }]
  },
  // new_sqlite_classes (not new_classes) is required for Durable Objects
  // on the free plan. The class stores nothing.
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room"] }],
  "observability": { "enabled": false }
}
```

`vitest.config.ts` — two projects, because the shared modules run in Node and the Durable Object needs the workers pool.

As of `@cloudflare/vitest-pool-workers` 0.19 (Vitest 4), the old `defineWorkersProject` helper from the `/config` subpath is gone; the pool is now a Vite **plugin**, `cloudflareTest`, imported from the package root. Install current versions — do not pin back to 0.12/Vitest 3 to restore the old helper, which drags in a `wrangler`/`miniflare`/`undici` tree carrying high-severity advisories including a WebSocket parser crash.

```ts
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: "shared", include: ["tests/shared/**/*.test.ts"], environment: "node" },
      },
      {
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
        test: { name: "worker", include: ["tests/worker/**/*.test.ts"] },
      },
    ],
  },
});
```

`.gitignore`:

```
node_modules/
dist/
.wrangler/
test-results/
playwright-report/
```

- [ ] **Step 3: Write the failing test**

`tests/shared/base32.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { encodeBase32, decodeBase32, CROCKFORD_ALPHABET } from "../../src/shared/base32";

const SEED_BYTES = 15;

describe("crockford base32", () => {
  it("uses the Crockford alphabet, excluding I L O U", () => {
    expect(CROCKFORD_ALPHABET).toBe("0123456789ABCDEFGHJKMNPQRSTVWXYZ");
    for (const ch of "ILOU") expect(CROCKFORD_ALPHABET).not.toContain(ch);
  });

  it("encodes 15 bytes to exactly 24 characters", () => {
    const bytes = new Uint8Array(SEED_BYTES).fill(0xab);
    expect(encodeBase32(bytes)).toHaveLength(24);
  });

  it("encodes all-zero and all-one seeds to known vectors", () => {
    expect(encodeBase32(new Uint8Array(15))).toBe("0".repeat(24));
    expect(encodeBase32(new Uint8Array(15).fill(0xff))).toBe("Z".repeat(24));
  });

  it("round-trips random seeds", () => {
    for (let i = 0; i < 200; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(SEED_BYTES));
      expect(decodeBase32(encodeBase32(bytes), SEED_BYTES)).toEqual(bytes);
    }
  });

  it("decodes case-insensitively and ignores dashes and spaces", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(SEED_BYTES));
    const code = encodeBase32(bytes);
    const grouped = code.match(/.{1,6}/g)!.join("-");
    expect(decodeBase32(code.toLowerCase(), SEED_BYTES)).toEqual(bytes);
    expect(decodeBase32(grouped, SEED_BYTES)).toEqual(bytes);
    expect(decodeBase32(" " + grouped + " ", SEED_BYTES)).toEqual(bytes);
  });

  it("maps the confusable letters O to 0 and I/L to 1", () => {
    const canonical = "0".repeat(23) + "1";
    const confused = "O".repeat(23) + "I";
    const confused2 = "o".repeat(23) + "l";
    expect(decodeBase32(confused, SEED_BYTES)).toEqual(decodeBase32(canonical, SEED_BYTES));
    expect(decodeBase32(confused2, SEED_BYTES)).toEqual(decodeBase32(canonical, SEED_BYTES));
  });

  it("rejects U, other invalid characters, and wrong lengths", () => {
    expect(() => decodeBase32("U".repeat(24), SEED_BYTES)).toThrow(/invalid character/i);
    expect(() => decodeBase32("!".repeat(24), SEED_BYTES)).toThrow(/invalid character/i);
    expect(() => decodeBase32("0".repeat(23), SEED_BYTES)).toThrow(/length/i);
    expect(() => decodeBase32("0".repeat(25), SEED_BYTES)).toThrow(/length/i);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run --project shared`
Expected: FAIL — cannot resolve `../../src/shared/base32`.

- [ ] **Step 5: Write the implementation**

`src/shared/base32.ts`:

```ts
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const DECODE_MAP: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (let i = 0; i < CROCKFORD_ALPHABET.length; i++) {
    map[CROCKFORD_ALPHABET.charAt(i)] = i;
  }
  // Crockford's confusable substitutions.
  map["O"] = 0;
  map["I"] = 1;
  map["L"] = 1;
  return map;
})();

export function encodeBase32(bytes: Uint8Array): string {
  let value = 0;
  let bits = 0;
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]!;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD_ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += CROCKFORD_ALPHABET.charAt((value << (5 - bits)) & 31);
  }
  return out;
}

export function decodeBase32(text: string, expectedBytes: number): Uint8Array {
  const clean = text.toUpperCase().replace(/[-\s]/g, "");
  // Check length up front. A trailing character contributes only 5 bits, so a
  // 25-character code would fill all 15 bytes and then fall off the end of the
  // loop without ever tripping a per-byte guard.
  const requiredLength = Math.ceil((expectedBytes * 8) / 5);
  if (clean.length !== requiredLength) {
    throw new Error(
      `code has the wrong length: expected ${requiredLength} characters for `
        + `${expectedBytes} bytes, got ${clean.length}`,
    );
  }
  const out = new Uint8Array(expectedBytes);
  let value = 0;
  let bits = 0;
  let written = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charAt(i);
    const digit = DECODE_MAP[ch];
    if (digit === undefined) {
      throw new Error(`invalid character in code: ${ch}`);
    }
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      out[written++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return out;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run --project shared`
Expected: PASS, 7 tests.

- [ ] **Step 7: Verify typecheck and commit**

```bash
npm run typecheck
git add -A
git commit -m "feat: project scaffolding and Crockford base32 codec"
```

---

### Task 2: Pairing — seed, HKDF derivation, URL builders

**Files:**
- Create: `src/shared/pairing.ts`
- Test: `tests/shared/pairing.test.ts`

**Interfaces:**
- Consumes: `encodeBase32`, `decodeBase32` from `src/shared/base32.ts`.
- Produces:
  - `SEED_BYTES = 15`, `SEED_CHARS = 24`
  - `generateSeed(): Uint8Array`
  - `derivePairing(seed: Uint8Array): Promise<Pairing>` where `interface Pairing { seed: Uint8Array; seedCode: string; roomId: string; roomIdBytes: Uint8Array; contentKey: CryptoKey }`
  - `formatSeedCode(code: string): string` — groups 24 chars as `4×6` with dashes
  - `parseSeedCode(text: string): Uint8Array`
  - `base64url(bytes: Uint8Array): string`
  - `buildSenderUrl(origin: string, seedCode: string): string`
  - `buildReceiverUrl(origin: string, seedCode: string): string`

- [ ] **Step 1: Write the failing test**

The HKDF test cross-checks WebCrypto against Node's independent `hkdfSync` implementation. That pins salt, `info`, and output length exactly, without anyone hand-computing a vector.

`tests/shared/pairing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hkdfSync } from "node:crypto";
import {
  SEED_BYTES, SEED_CHARS, generateSeed, derivePairing, formatSeedCode,
  parseSeedCode, base64url, buildSenderUrl, buildReceiverUrl,
} from "../../src/shared/pairing";

function nodeHkdf(seed: Uint8Array, info: string, length: number): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", seed, new Uint8Array(0), new TextEncoder().encode(info), length));
}

describe("pairing", () => {
  it("generates 15-byte seeds that encode to 24 characters", () => {
    const seed = generateSeed();
    expect(seed).toHaveLength(SEED_BYTES);
    expect(SEED_BYTES).toBe(15);
    expect(SEED_CHARS).toBe(24);
  });

  it("generates distinct seeds", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(base64url(generateSeed()));
    expect(seen.size).toBe(100);
  });

  it("derives roomId with the exact HKDF parameters from the spec", async () => {
    const seed = new Uint8Array(15).fill(7);
    const pairing = await derivePairing(seed);
    const expected = nodeHkdf(seed, "teslaport:room:v1", 16);
    expect(pairing.roomIdBytes).toEqual(expected);
    expect(pairing.roomId).toBe(base64url(expected));
    expect(pairing.roomId).toHaveLength(22);
    expect(pairing.roomId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("derives a 32-byte contentKey with the exact HKDF parameters from the spec", async () => {
    const seed = new Uint8Array(15).fill(7);
    const pairing = await derivePairing(seed);
    const expectedKeyBytes = nodeHkdf(seed, "teslaport:key:v1", 32);
    const imported = await crypto.subtle.importKey("raw", expectedKeyBytes, "AES-GCM", false, ["encrypt"]);
    const nonce = new Uint8Array(12);
    const a = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, imported, new Uint8Array([1, 2, 3]));
    const b = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, pairing.contentKey, new Uint8Array([1, 2, 3]));
    expect(new Uint8Array(b)).toEqual(new Uint8Array(a));
  });

  it("is a regression lock on the derivation (frozen vector)", async () => {
    const pairing = await derivePairing(new Uint8Array(15));
    expect(pairing.roomId).toBe("__FROZEN_ROOM_ID__");
  });

  it("derives roomId and contentKey independently", async () => {
    const seed = new Uint8Array(15).fill(7);
    const roomBytes = nodeHkdf(seed, "teslaport:room:v1", 16);
    const keyBytes = nodeHkdf(seed, "teslaport:key:v1", 32);
    expect(keyBytes.slice(0, 16)).not.toEqual(roomBytes);
  });

  it("is deterministic and seed-sensitive", async () => {
    const seed = new Uint8Array(15).fill(7);
    const other = new Uint8Array(15).fill(7);
    other[14] = 8;
    expect((await derivePairing(seed)).roomId).toBe((await derivePairing(seed)).roomId);
    expect((await derivePairing(seed)).roomId).not.toBe((await derivePairing(other)).roomId);
  });

  it("rejects seeds of the wrong length", async () => {
    await expect(derivePairing(new Uint8Array(14))).rejects.toThrow(/15 bytes/);
  });

  it("formats and reparses the display code", async () => {
    const seed = generateSeed();
    const { seedCode } = await derivePairing(seed);
    const formatted = formatSeedCode(seedCode);
    expect(formatted).toMatch(/^[0-9A-Z]{6}-[0-9A-Z]{6}-[0-9A-Z]{6}-[0-9A-Z]{6}$/);
    expect(parseSeedCode(formatted)).toEqual(seed);
    expect(parseSeedCode(seedCode)).toEqual(seed);
  });

  it("builds sender and receiver URLs carrying the bare code in the fragment", () => {
    const code = "0".repeat(24);
    expect(buildSenderUrl("https://teslaport.example", code)).toBe(`https://teslaport.example/s#${code}`);
    expect(buildReceiverUrl("https://teslaport.example", code)).toBe(`https://teslaport.example/r#${code}`);
    // Trailing slashes on origin must not double up.
    expect(buildSenderUrl("https://teslaport.example/", code)).toBe(`https://teslaport.example/s#${code}`);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project shared`
Expected: FAIL — cannot resolve `../../src/shared/pairing`.

- [ ] **Step 3: Write the implementation**

`src/shared/pairing.ts`:

```ts
import { encodeBase32, decodeBase32 } from "./base32";

export const SEED_BYTES = 15;
export const SEED_CHARS = 24;

const ROOM_INFO = "teslaport:room:v1";
const KEY_INFO = "teslaport:key:v1";
const ROOM_ID_BYTES = 16;
const CONTENT_KEY_BYTES = 32;

export interface Pairing {
  seed: Uint8Array;
  seedCode: string;
  roomId: string;
  roomIdBytes: Uint8Array;
  contentKey: CryptoKey;
}

export function generateSeed(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SEED_BYTES));
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hkdf(seed: Uint8Array, info: string, lengthBytes: number): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey("raw", seed, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(info),
    },
    ikm,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

export async function derivePairing(seed: Uint8Array): Promise<Pairing> {
  if (seed.length !== SEED_BYTES) {
    throw new Error(`seed must be ${SEED_BYTES} bytes, got ${seed.length}`);
  }
  const roomIdBytes = await hkdf(seed, ROOM_INFO, ROOM_ID_BYTES);
  const keyBytes = await hkdf(seed, KEY_INFO, CONTENT_KEY_BYTES);
  const contentKey = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  return {
    seed,
    seedCode: encodeBase32(seed),
    roomId: base64url(roomIdBytes),
    roomIdBytes,
    contentKey,
  };
}

export function formatSeedCode(code: string): string {
  return (code.match(/.{1,6}/g) ?? []).join("-");
}

export function parseSeedCode(text: string): Uint8Array {
  return decodeBase32(text, SEED_BYTES);
}

function normaliseOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

export function buildSenderUrl(origin: string, seedCode: string): string {
  return `${normaliseOrigin(origin)}/s#${seedCode}`;
}

export function buildReceiverUrl(origin: string, seedCode: string): string {
  return `${normaliseOrigin(origin)}/r#${seedCode}`;
}
```

- [ ] **Step 4: Capture the frozen vector**

The regression-lock test has a deliberate placeholder. Print the real value and paste it in — this is what turns the derivation into something that cannot change silently.

```bash
npx tsx -e "import('./src/shared/pairing.ts').then(async m => console.log((await m.derivePairing(new Uint8Array(15))).roomId))"
```

(If `tsx` is not installed, run `npx --yes tsx -e ...`.) Replace `__FROZEN_ROOM_ID__` in `tests/shared/pairing.test.ts` with the printed 22-character string. Do not hand-write this value.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --project shared`
Expected: PASS. If the frozen-vector test fails, the pasted value is wrong — re-run step 4, do not edit the implementation to match.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: seed generation and HKDF pairing derivation"
```

---

### Task 3: Envelope — seal, open, and payload validation

**Files:**
- Create: `src/shared/protocol.ts`
- Create: `src/shared/envelope.ts`
- Test: `tests/shared/envelope.test.ts`

**Interfaces:**
- Consumes: `Pairing`, `base64url` from `src/shared/pairing.ts`.
- Produces:
  - From `protocol.ts`: `MAX_PAYLOAD_BYTES = 8192`, `MAX_FRAME_BYTES = 8192 + 64`, `NONCE_BYTES = 12`, `FRESHNESS_WINDOW_MS = 300000`, `ACK_TIMEOUT_MS = 3000`, `RATE_LIMIT_PER_MINUTE = 30`, `SEEN_ID_LIMIT = 200`, `HISTORY_LIMIT = 20`, and `type ControlMessage = { t: "presence"; receivers: number } | { t: "no-receiver" } | { t: "error"; code: "rate_limited" | "too_large" | "unsupported" }`
  - From `envelope.ts`: `type Payload`, `newMessageId(): string`, `seal(pairing, payload): Promise<Uint8Array>`, `openEnvelope(pairing, frame, now): Promise<OpenResult>`, `type RejectReason = "decrypt" | "malformed" | "scheme" | "stale"`

- [ ] **Step 1: Write the failing test**

`tests/shared/envelope.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { derivePairing, generateSeed, type Pairing } from "../../src/shared/pairing";
import { seal, openEnvelope, newMessageId, type Payload } from "../../src/shared/envelope";
import { NONCE_BYTES, FRESHNESS_WINDOW_MS } from "../../src/shared/protocol";

const NOW = 1_800_000_000_000;

async function pairing(): Promise<Pairing> {
  return derivePairing(generateSeed());
}

function urlPayload(overrides: Partial<Extract<Payload, { t: "url" }>> = {}): Payload {
  return { t: "url", id: newMessageId(), url: "https://example.com/a", ts: NOW, ...overrides };
}

describe("envelope", () => {
  it("round-trips a url payload", async () => {
    const p = await pairing();
    const payload = urlPayload();
    const result = await openEnvelope(p, await seal(p, payload), NOW);
    expect(result).toEqual({ ok: true, payload });
  });

  it("round-trips an ack payload", async () => {
    const p = await pairing();
    const payload: Payload = { t: "ack", id: newMessageId() };
    const result = await openEnvelope(p, await seal(p, payload), NOW);
    expect(result).toEqual({ ok: true, payload });
  });

  it("prefixes a fresh 12-byte nonce and never repeats it", async () => {
    const p = await pairing();
    const payload = urlPayload();
    const a = await seal(p, payload);
    const b = await seal(p, payload);
    expect(a.slice(0, NONCE_BYTES)).not.toEqual(b.slice(0, NONCE_BYTES));
    expect(a).not.toEqual(b);
  });

  it("rejects a flipped ciphertext bit", async () => {
    const p = await pairing();
    const frame = await seal(p, urlPayload());
    frame[frame.length - 1] ^= 0x01;
    expect(await openEnvelope(p, frame, NOW)).toEqual({ ok: false, reason: "decrypt" });
  });

  it("rejects a frame sealed under a different key", async () => {
    const a = await pairing();
    const b = await pairing();
    expect(await openEnvelope(b, await seal(a, urlPayload()), NOW)).toEqual({ ok: false, reason: "decrypt" });
  });

  it("rejects a frame whose AAD does not match the roomId", async () => {
    const p = await pairing();
    const frame = await seal(p, urlPayload());
    const wrongAad: Pairing = { ...p, roomIdBytes: new Uint8Array(16).fill(9) };
    expect(await openEnvelope(wrongAad, frame, NOW)).toEqual({ ok: false, reason: "decrypt" });
  });

  it("rejects truncated frames", async () => {
    const p = await pairing();
    expect(await openEnvelope(p, new Uint8Array(4), NOW)).toEqual({ ok: false, reason: "decrypt" });
  });

  it("rejects non-http(s) schemes", async () => {
    const p = await pairing();
    for (const url of ["javascript:alert(1)", "data:text/html,<b>x", "file:///etc/passwd", "not a url"]) {
      const frame = await seal(p, urlPayload({ url }));
      expect(await openEnvelope(p, frame, NOW)).toEqual({ ok: false, reason: "scheme" });
    }
  });

  it("accepts http and https", async () => {
    const p = await pairing();
    for (const url of ["http://example.com/", "https://example.com/x?y=1#z"]) {
      const frame = await seal(p, urlPayload({ url }));
      const result = await openEnvelope(p, frame, NOW);
      expect(result.ok).toBe(true);
    }
  });

  it("rejects timestamps outside the freshness window in both directions", async () => {
    const p = await pairing();
    const old = await seal(p, urlPayload({ ts: NOW - FRESHNESS_WINDOW_MS - 1 }));
    const future = await seal(p, urlPayload({ ts: NOW + FRESHNESS_WINDOW_MS + 1 }));
    expect(await openEnvelope(p, old, NOW)).toEqual({ ok: false, reason: "stale" });
    expect(await openEnvelope(p, future, NOW)).toEqual({ ok: false, reason: "stale" });
  });

  it("accepts timestamps exactly at the window boundary", async () => {
    const p = await pairing();
    const edge = await seal(p, urlPayload({ ts: NOW - FRESHNESS_WINDOW_MS }));
    expect((await openEnvelope(p, edge, NOW)).ok).toBe(true);
  });

  it("does not apply the freshness window to acks", async () => {
    const p = await pairing();
    const frame = await seal(p, { t: "ack", id: newMessageId() });
    expect((await openEnvelope(p, frame, NOW + 10 * FRESHNESS_WINDOW_MS)).ok).toBe(true);
  });

  it("rejects structurally malformed payloads", async () => {
    const p = await pairing();
    const bad = [{ t: "url", id: "x" }, { t: "nope", id: "x" }, { id: "x" }, "a string", 42];
    for (const payload of bad) {
      const frame = await seal(p, payload as unknown as Payload);
      expect(await openEnvelope(p, frame, NOW)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("rejects payloads over the size cap", async () => {
    const p = await pairing();
    const huge = "https://example.com/" + "a".repeat(9000);
    await expect(seal(p, urlPayload({ url: huge }))).rejects.toThrow(/too large/i);
  });

  it("generates distinct message ids", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(newMessageId());
    expect(seen.size).toBe(500);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project shared`
Expected: FAIL — cannot resolve `../../src/shared/envelope`.

- [ ] **Step 3: Write `src/shared/protocol.ts`**

```ts
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

export type ControlMessage =
  | { t: "presence"; receivers: number }
  | { t: "no-receiver" }
  | { t: "error"; code: "rate_limited" | "too_large" | "unsupported" };
```

- [ ] **Step 4: Write `src/shared/envelope.ts`**

```ts
import type { Pairing } from "./pairing";
import { base64url } from "./pairing";
import { MAX_PAYLOAD_BYTES, NONCE_BYTES, TAG_BITS, FRESHNESS_WINDOW_MS } from "./protocol";

export type Payload =
  | { t: "url"; id: string; url: string; ts: number }
  | { t: "ack"; id: string };

export type RejectReason = "decrypt" | "malformed" | "scheme" | "stale";

export type OpenResult =
  | { ok: true; payload: Payload }
  | { ok: false; reason: RejectReason };

export function newMessageId(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function seal(pairing: Pairing, payload: Payload): Promise<Uint8Array> {
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  if (plaintext.byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error(`payload too large: ${plaintext.byteLength} > ${MAX_PAYLOAD_BYTES}`);
  }
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: pairing.roomIdBytes, tagLength: TAG_BITS },
      pairing.contentKey,
      plaintext,
    ),
  );
  const frame = new Uint8Array(nonce.length + ciphertext.length);
  frame.set(nonce, 0);
  frame.set(ciphertext, nonce.length);
  return frame;
}

function isValidPayload(value: unknown): value is Payload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.t === "ack") return typeof v.id === "string" && v.id.length > 0;
  if (v.t === "url") {
    return typeof v.id === "string" && v.id.length > 0
      && typeof v.url === "string"
      && typeof v.ts === "number" && Number.isFinite(v.ts);
  }
  return false;
}

function hasAllowedScheme(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function openEnvelope(
  pairing: Pairing,
  frame: Uint8Array,
  now: number,
): Promise<OpenResult> {
  if (frame.byteLength <= NONCE_BYTES + TAG_BITS / 8) {
    return { ok: false, reason: "decrypt" };
  }
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: frame.slice(0, NONCE_BYTES),
        additionalData: pairing.roomIdBytes,
        tagLength: TAG_BITS,
      },
      pairing.contentKey,
      frame.slice(NONCE_BYTES),
    );
  } catch {
    return { ok: false, reason: "decrypt" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isValidPayload(parsed)) return { ok: false, reason: "malformed" };

  if (parsed.t === "url") {
    if (!hasAllowedScheme(parsed.url)) return { ok: false, reason: "scheme" };
    if (Math.abs(now - parsed.ts) > FRESHNESS_WINDOW_MS) return { ok: false, reason: "stale" };
  }
  return { ok: true, payload: parsed };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --project shared`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: AES-GCM envelope with scheme and freshness validation"
```

---

### Task 4: Replay guard and history store

Three small stores over the same minimal storage interface. They change together and none is worth a separate review gate.

The diagnostics counters must be **persisted, not held in a page global**. `/debug` is a separate document from `/r`, so a `window` global set by the receiver is invisible to it — and the counters exist precisely to be read on `/debug` in a car with no developer tools.

**Files:**
- Create: `src/shared/replay.ts`
- Create: `src/shared/diagnostics.ts`
- Create: `src/client/history.ts`
- Test: `tests/shared/replay.test.ts`, `tests/shared/diagnostics.test.ts`, `tests/shared/history.test.ts`

**Interfaces:**
- Consumes: `SEEN_ID_LIMIT`, `HISTORY_LIMIT` from `src/shared/protocol.ts`.
- Produces:
  - `interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }` (exported from `replay.ts`; `window.localStorage` satisfies it structurally)
  - `interface SeenStore { has(id: string): boolean; add(id: string): void; clear(): void }` (exported as a named type)
  - `createSeenStore(storage: KeyValueStore, key?: string, limit?: number): SeenStore`
  - `loadDropCounts(storage: KeyValueStore): DropCounts`, `bumpDropCount(storage: KeyValueStore, reason: keyof DropCounts): DropCounts`, `recordClockDelta(storage: KeyValueStore, deltaMs: number): void`, `readClockDelta(storage: KeyValueStore): number | null`, where `type DropCounts = Record<"decrypt" | "malformed" | "scheme" | "stale" | "replay", number>`
  - `appendError(storage: KeyValueStore, message: string): void`, `loadErrors(storage: KeyValueStore): string[]`, `installErrorCapture(storage: KeyValueStore): void` — the log must persist, because an error thrown on `/r` has to be readable later on `/debug`, which is a different document
  - `interface HistoryEntry { id: string; url: string; ts: number }`
  - `loadHistory(storage: KeyValueStore): HistoryEntry[]`
  - `pushHistory(storage: KeyValueStore, entry: HistoryEntry): HistoryEntry[]`
  - `clearHistory(storage: KeyValueStore): void`

- [ ] **Step 1: Write the failing tests**

`tests/shared/replay.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createSeenStore, type KeyValueStore } from "../../src/shared/replay";

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("seen-id store", () => {
  it("reports unseen ids as absent and seen ids as present", () => {
    const seen = createSeenStore(memoryStore());
    expect(seen.has("a")).toBe(false);
    seen.add("a");
    expect(seen.has("a")).toBe(true);
    expect(seen.has("b")).toBe(false);
  });

  it("persists across instances backed by the same storage", () => {
    const storage = memoryStore();
    createSeenStore(storage).add("a");
    expect(createSeenStore(storage).has("a")).toBe(true);
  });

  it("evicts the oldest ids beyond the limit", () => {
    const seen = createSeenStore(memoryStore(), "k", 3);
    seen.add("1"); seen.add("2"); seen.add("3"); seen.add("4");
    expect(seen.has("1")).toBe(false);
    expect(seen.has("2")).toBe(true);
    expect(seen.has("4")).toBe(true);
  });

  it("clear forgets everything", () => {
    const seen = createSeenStore(memoryStore());
    seen.add("a");
    seen.clear();
    expect(seen.has("a")).toBe(false);
  });

  it("survives corrupt stored data by starting empty", () => {
    const storage = memoryStore();
    storage.setItem("teslaport:seen", "{not json");
    const seen = createSeenStore(storage);
    expect(seen.has("a")).toBe(false);
    seen.add("a");
    expect(seen.has("a")).toBe(true);
  });
});
```

`tests/shared/diagnostics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { KeyValueStore } from "../../src/shared/replay";
import {
  loadDropCounts, bumpDropCount, recordClockDelta, readClockDelta, appendError, loadErrors,
} from "../../src/shared/diagnostics";

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("diagnostics counters", () => {
  it("starts every reason at zero", () => {
    expect(loadDropCounts(memoryStore())).toEqual({
      decrypt: 0, malformed: 0, scheme: 0, stale: 0, replay: 0,
    });
  });

  it("increments and persists across reads", () => {
    const storage = memoryStore();
    bumpDropCount(storage, "stale");
    bumpDropCount(storage, "stale");
    bumpDropCount(storage, "replay");
    const counts = loadDropCounts(storage);
    expect(counts.stale).toBe(2);
    expect(counts.replay).toBe(1);
    expect(counts.decrypt).toBe(0);
  });

  it("records and reads the clock delta", () => {
    const storage = memoryStore();
    expect(readClockDelta(storage)).toBeNull();
    recordClockDelta(storage, -1234);
    expect(readClockDelta(storage)).toBe(-1234);
  });

  it("survives corrupt stored data", () => {
    const storage = memoryStore();
    storage.setItem("teslaport:drops", "{{{");
    storage.setItem("teslaport:clockdelta", "not a number");
    expect(loadDropCounts(storage).decrypt).toBe(0);
    expect(readClockDelta(storage)).toBeNull();
  });
});

describe("persisted error log", () => {
  it("starts empty and appends newest last", () => {
    const storage = memoryStore();
    expect(loadErrors(storage)).toEqual([]);
    appendError(storage, "first");
    appendError(storage, "second");
    const errors = loadErrors(storage);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("first");
    expect(errors[1]).toContain("second");
  });

  it("timestamps each entry", () => {
    const storage = memoryStore();
    appendError(storage, "boom");
    expect(loadErrors(storage)[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("keeps only the most recent 20", () => {
    const storage = memoryStore();
    for (let i = 0; i < 25; i++) appendError(storage, `e${i}`);
    const errors = loadErrors(storage);
    expect(errors).toHaveLength(20);
    expect(errors[19]).toContain("e24");
    expect(errors.join()).not.toContain("e4,");
  });

  it("survives corrupt stored data", () => {
    const storage = memoryStore();
    storage.setItem("teslaport:errors", "]]]");
    expect(loadErrors(storage)).toEqual([]);
  });
});
```

Add `appendError, loadErrors` to the import at the top of this file.

`tests/shared/history.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { KeyValueStore } from "../../src/shared/replay";
import { loadHistory, pushHistory, clearHistory } from "../../src/client/history";

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("history store", () => {
  it("starts empty", () => {
    expect(loadHistory(memoryStore())).toEqual([]);
  });

  it("puts the newest entry first", () => {
    const storage = memoryStore();
    pushHistory(storage, { id: "1", url: "https://a.example/", ts: 1 });
    const list = pushHistory(storage, { id: "2", url: "https://b.example/", ts: 2 });
    expect(list.map((e) => e.id)).toEqual(["2", "1"]);
    expect(loadHistory(storage).map((e) => e.id)).toEqual(["2", "1"]);
  });

  it("caps at 20 entries", () => {
    const storage = memoryStore();
    for (let i = 0; i < 25; i++) pushHistory(storage, { id: String(i), url: "https://a.example/", ts: i });
    const list = loadHistory(storage);
    expect(list).toHaveLength(20);
    expect(list[0]!.id).toBe("24");
    expect(list[19]!.id).toBe("5");
  });

  it("clears", () => {
    const storage = memoryStore();
    pushHistory(storage, { id: "1", url: "https://a.example/", ts: 1 });
    clearHistory(storage);
    expect(loadHistory(storage)).toEqual([]);
  });

  it("survives corrupt stored data by starting empty", () => {
    const storage = memoryStore();
    storage.setItem("teslaport:history", "nonsense");
    expect(loadHistory(storage)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project shared`
Expected: FAIL — cannot resolve `replay` or `history`.

- [ ] **Step 3: Write `src/shared/replay.ts`**

```ts
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

function readIds(storage: KeyValueStore, key: string): string[] {
  const raw = storage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
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
```

- [ ] **Step 4: Write `src/shared/diagnostics.ts`**

```ts
import type { KeyValueStore } from "./replay";

const DROPS_KEY = "teslaport:drops";
const CLOCK_KEY = "teslaport:clockdelta";

export type DropReason = "decrypt" | "malformed" | "scheme" | "stale" | "replay";
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
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const reason of REASONS) {
      const value = parsed[reason];
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
    const parsed = JSON.parse(raw);
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
```

- [ ] **Step 5: Write `src/client/history.ts`**

```ts
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
    const parsed = JSON.parse(raw);
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --project shared`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: replay-guard, diagnostics counters, and history stores"
```

---

### Task 5: Durable Object switchboard

This is where the fan-out and same-role-isolation invariants live. Read the spec's "Multiple receivers" section before starting.

**Files:**
- Create: `src/worker/room.ts`
- Create: `src/worker/index.ts`
- Test: `tests/worker/room.test.ts`

**Interfaces:**
- Consumes: `MAX_FRAME_BYTES`, `RATE_LIMIT_PER_MINUTE`, `ControlMessage` from `src/shared/protocol.ts`.
- Produces: `export class Room`, default Worker `fetch` handler, `interface Env { ROOM: DurableObjectNamespace; ASSETS: Fetcher }`.

**Design notes the implementer must not deviate from:**
- Roles are stored as **hibernation tags** via `ctx.acceptWebSocket(ws, [role])`, and read back with `ctx.getTags(ws)`. Do **not** use `serializeAttachment` — it is runtime-persisted state, and the spec forbids server persistence.
- Rate-limit counters live in a plain in-memory `Map` keyed by the socket. They reset if the DO is evicted; the spec explicitly accepts this.
- Fan-out targets are always `getWebSockets(oppositeRole)`. Never send to the same role.

- [ ] **Step 1: Write the failing test**

`tests/worker/room.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

const ROOM = "AAAAAAAAAAAAAAAAAAAAAA"; // 22 chars, shape-valid
const BASE = "https://teslaport.test";

async function connect(role: "sender" | "receiver", room = ROOM): Promise<WebSocket> {
  const res = await SELF.fetch(`${BASE}/ws/${room}?role=${role}`, {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  return ws;
}

function nextMessage(ws: WebSocket, timeoutMs = 1000): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
    ws.addEventListener("message", (event) => {
      clearTimeout(timer);
      resolve(event.data as string | ArrayBuffer);
    }, { once: true });
  });
}

function expectNoMessage(ws: WebSocket, ms = 200): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    ws.addEventListener("message", () => {
      clearTimeout(timer);
      reject(new Error("expected no message, got one"));
    }, { once: true });
  });
}

async function control(ws: WebSocket): Promise<Record<string, unknown>> {
  const data = await nextMessage(ws);
  expect(typeof data).toBe("string");
  return JSON.parse(data as string);
}

describe("Room durable object", () => {
  it("rejects a missing or bad role", async () => {
    const res = await SELF.fetch(`${BASE}/ws/${ROOM}?role=bogus`, { headers: { Upgrade: "websocket" } });
    expect(res.status).toBe(400);
  });

  it("rejects a non-websocket request", async () => {
    const res = await SELF.fetch(`${BASE}/ws/${ROOM}?role=sender`);
    expect(res.status).toBe(426);
  });

  it("tells a sender when there is no receiver", async () => {
    const sender = await connect("sender");
    await control(sender); // initial presence
    sender.send(new Uint8Array([1, 2, 3]));
    expect(await control(sender)).toEqual({ t: "no-receiver" });
  });

  it("relays a sender frame to the receiver", async () => {
    const receiver = await connect("receiver", "BBBBBBBBBBBBBBBBBBBBBB");
    const sender = await connect("sender", "BBBBBBBBBBBBBBBBBBBBBB");
    await control(sender); // presence
    const payload = new Uint8Array([9, 8, 7]);
    sender.send(payload);
    const got = await nextMessage(receiver);
    expect(new Uint8Array(got as ArrayBuffer)).toEqual(payload);
  });

  it("relays a receiver ack back to the sender", async () => {
    const room = "CCCCCCCCCCCCCCCCCCCCCC";
    const sender = await connect("sender", room);
    const receiver = await connect("receiver", room);
    await control(sender); // initial presence
    await control(sender); // presence update on receiver connect
    const ack = new Uint8Array([4, 4, 4]);
    receiver.send(ack);
    const got = await nextMessage(sender);
    expect(new Uint8Array(got as ArrayBuffer)).toEqual(ack);
  });

  it("fans out to every receiver", async () => {
    const room = "DDDDDDDDDDDDDDDDDDDDDD";
    const r1 = await connect("receiver", room);
    const r2 = await connect("receiver", room);
    const sender = await connect("sender", room);
    await control(sender);
    const payload = new Uint8Array([5]);
    sender.send(payload);
    for (const r of [r1, r2]) {
      expect(new Uint8Array((await nextMessage(r)) as ArrayBuffer)).toEqual(payload);
    }
  });

  it("never relays sender to sender", async () => {
    const room = "EEEEEEEEEEEEEEEEEEEEEE";
    const s1 = await connect("sender", room);
    const s2 = await connect("sender", room);
    await control(s1);
    await control(s2);
    s1.send(new Uint8Array([1]));
    // s1 gets no-receiver; s2 must get nothing at all.
    await expectNoMessage(s2);
  });

  it("never relays receiver to receiver", async () => {
    const room = "FFFFFFFFFFFFFFFFFFFFFF";
    const r1 = await connect("receiver", room);
    const r2 = await connect("receiver", room);
    r1.send(new Uint8Array([1]));
    await expectNoMessage(r2);
  });

  it("reports presence on connect and on receiver join", async () => {
    const room = "GGGGGGGGGGGGGGGGGGGGGG";
    const sender = await connect("sender", room);
    expect(await control(sender)).toEqual({ t: "presence", receivers: 0 });
    await connect("receiver", room);
    expect(await control(sender)).toEqual({ t: "presence", receivers: 1 });
  });

  it("rejects oversized frames", async () => {
    const room = "HHHHHHHHHHHHHHHHHHHHHH";
    await connect("receiver", room);
    const sender = await connect("sender", room);
    await control(sender);
    await control(sender);
    sender.send(new Uint8Array(9000));
    expect(await control(sender)).toEqual({ t: "error", code: "too_large" });
  });

  it("rejects text frames", async () => {
    const room = "JJJJJJJJJJJJJJJJJJJJJJ";
    const sender = await connect("sender", room);
    await control(sender);
    sender.send("hello");
    expect(await control(sender)).toEqual({ t: "error", code: "unsupported" });
  });

  it("rate limits after 30 frames in a minute", async () => {
    const room = "KKKKKKKKKKKKKKKKKKKKKK";
    await connect("receiver", room);
    const sender = await connect("sender", room);
    await control(sender);
    await control(sender);
    for (let i = 0; i < 30; i++) sender.send(new Uint8Array([1]));
    sender.send(new Uint8Array([1]));
    expect(await control(sender)).toEqual({ t: "error", code: "rate_limited" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project worker`
Expected: FAIL — no Worker entrypoint / `Room` not exported.

- [ ] **Step 3: Write `src/worker/room.ts`**

```ts
import { MAX_FRAME_BYTES, RATE_LIMIT_PER_MINUTE, type ControlMessage } from "../shared/protocol";

type Role = "sender" | "receiver";

interface Budget {
  windowStart: number;
  count: number;
}

export class Room implements DurableObject {
  /** In-memory only. Resets if the DO is evicted; the spec accepts this. */
  private budgets = new WeakMap<WebSocket, Budget>();

  constructor(private ctx: DurableObjectState, private env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const role = new URL(request.url).searchParams.get("role");
    if (role !== "sender" && role !== "receiver") {
      return new Response("role must be sender or receiver", { status: 400 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [role]);

    if (role === "sender") {
      this.send(server, { t: "presence", receivers: this.countOf("receiver") });
    } else {
      this.broadcastPresence();
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (!this.allow(ws)) {
      this.send(ws, { t: "error", code: "rate_limited" });
      return;
    }
    if (typeof message === "string") {
      this.send(ws, { t: "error", code: "unsupported" });
      return;
    }
    if (message.byteLength > MAX_FRAME_BYTES) {
      this.send(ws, { t: "error", code: "too_large" });
      return;
    }

    const role = this.roleOf(ws);
    if (!role) return;
    const targets = this.ctx.getWebSockets(role === "sender" ? "receiver" : "sender");
    if (targets.length === 0) {
      if (role === "sender") this.send(ws, { t: "no-receiver" });
      return;
    }
    for (const target of targets) {
      try {
        target.send(message);
      } catch {
        // A racing close; the close handler will tidy up.
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    if (this.roleOf(ws) === "receiver") {
      // The socket is still briefly enumerable, so defer the count.
      queueMicrotask(() => this.broadcastPresence());
    }
  }

  webSocketError(ws: WebSocket): void {
    this.webSocketClose(ws);
  }

  private roleOf(ws: WebSocket): Role | null {
    const tags = this.ctx.getTags(ws);
    if (tags.indexOf("sender") !== -1) return "sender";
    if (tags.indexOf("receiver") !== -1) return "receiver";
    return null;
  }

  private countOf(role: Role): number {
    return this.ctx.getWebSockets(role).length;
  }

  private broadcastPresence(): void {
    const message: ControlMessage = { t: "presence", receivers: this.countOf("receiver") };
    for (const sender of this.ctx.getWebSockets("sender")) {
      this.send(sender, message);
    }
  }

  private send(ws: WebSocket, message: ControlMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Socket already gone.
    }
  }

  private allow(ws: WebSocket): boolean {
    const now = Date.now();
    const budget = this.budgets.get(ws);
    if (!budget || now - budget.windowStart >= 60_000) {
      this.budgets.set(ws, { windowStart: now, count: 1 });
      return true;
    }
    budget.count += 1;
    return budget.count <= RATE_LIMIT_PER_MINUTE;
  }
}
```

- [ ] **Step 4: Write `src/worker/index.ts`**

The CSP is deliberately strict: this app loads nothing from anywhere else, so anything it would permit is a bug. `Referrer-Policy: no-referrer` keeps the app's own URL out of the referrer when the car opens a shared link.

```ts
import { Room } from "./room";

export interface Env {
  ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

const WS_PATH = /^\/ws\/([A-Za-z0-9_-]{22})$/;

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' wss: ws:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = WS_PATH.exec(url.pathname);
    if (match) {
      const id = env.ROOM.idFromName(match[1]!);
      return env.ROOM.get(id).fetch(request);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const response = new Response(assetResponse.body, assetResponse);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      response.headers.set(name, value);
    }
    return response;
  },
};

export { Room };
```

- [ ] **Step 5: Create a placeholder asset directory so the test harness can boot**

```bash
mkdir -p dist/client && printf '<!doctype html><title>TeslaPort</title>' > dist/client/index.html
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run --project worker`
Expected: PASS, 12 tests.

If the presence tests are flaky on ordering, the cause is a real bug: presence must be sent to a new sender *before* its first frame is processed, and on receiver join it must be broadcast to all senders. Fix the implementation, not the test's timing.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: durable object switchboard with cross-role fan-out"
```

---

### Task 6: Reconnecting socket client

**Files:**
- Create: `src/shared/socket.ts`
- Test: `tests/shared/socket.test.ts`

**Interfaces:**
- Consumes: `ControlMessage` from `src/shared/protocol.ts`.
- Produces:
  - `nextDelay(attempt: number, random?: () => number): number`
  - `type ConnectionStatus = "connecting" | "open" | "closed"`
  - `connect(url: string, handlers: SocketHandlers): SocketHandle` where
    `interface SocketHandlers { onStatus(s: ConnectionStatus): void; onFrame(frame: Uint8Array): void; onControl(msg: ControlMessage): void }`
    and `interface SocketHandle { send(frame: Uint8Array): boolean; close(): void }`

`send` returns whether the frame actually went out. A silent no-op on a closed socket would leave the sender waiting out a 3-second ack timeout and then blaming the car for a message that never left the phone.

Only `nextDelay` is unit-tested; live reconnection is proven in the Playwright suite (Task 10) using `context.setOffline`, which exercises the real browser behaviour rather than a mock of it.

- [ ] **Step 1: Write the failing test**

`tests/shared/socket.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextDelay } from "../../src/shared/socket";

describe("reconnect backoff", () => {
  it("starts around one second and jitters within half the base", () => {
    expect(nextDelay(0, () => 0)).toBe(500);
    expect(nextDelay(0, () => 1)).toBe(1000);
  });

  it("doubles per attempt", () => {
    expect(nextDelay(1, () => 1)).toBe(2000);
    expect(nextDelay(2, () => 1)).toBe(4000);
    expect(nextDelay(3, () => 1)).toBe(8000);
  });

  it("caps at thirty seconds", () => {
    expect(nextDelay(20, () => 1)).toBe(30000);
    expect(nextDelay(20, () => 0)).toBe(15000);
  });

  it("always returns a positive integer", () => {
    for (let attempt = 0; attempt < 25; attempt++) {
      const delay = nextDelay(attempt);
      expect(Number.isInteger(delay)).toBe(true);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(30000);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project shared`
Expected: FAIL — cannot resolve `../../src/shared/socket`.

- [ ] **Step 3: Write the implementation**

`src/shared/socket.ts`:

```ts
import type { ControlMessage } from "./protocol";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface SocketHandlers {
  onStatus(status: ConnectionStatus): void;
  onFrame(frame: Uint8Array): void;
  onControl(message: ControlMessage): void;
}

export interface SocketHandle {
  /** Returns false if the socket was not open and the frame was dropped. */
  send(frame: Uint8Array): boolean;
  close(): void;
}

const MAX_DELAY_MS = 30000;

export function nextDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_DELAY_MS, 1000 * Math.pow(2, attempt));
  return Math.round(base * (0.5 + 0.5 * random()));
}

export function connect(url: string, handlers: SocketHandlers): SocketHandle {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function scheduleReconnect(): void {
    if (closed || timer !== null) return;
    const delay = nextDelay(attempt);
    attempt += 1;
    timer = setTimeout(() => {
      timer = null;
      open();
    }, delay);
  }

  function open(): void {
    if (closed) return;
    handlers.onStatus("connecting");
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    ws = socket;

    socket.addEventListener("open", () => {
      attempt = 0;
      handlers.onStatus("open");
    });

    socket.addEventListener("message", (event) => {
      const data = (event as MessageEvent).data;
      if (typeof data === "string") {
        try {
          handlers.onControl(JSON.parse(data) as ControlMessage);
        } catch {
          // Ignore unparseable control frames.
        }
        return;
      }
      handlers.onFrame(new Uint8Array(data as ArrayBuffer));
    });

    const drop = (): void => {
      if (ws !== socket) return;
      ws = null;
      handlers.onStatus("closed");
      scheduleReconnect();
    };
    socket.addEventListener("close", drop);
    socket.addEventListener("error", drop);
  }

  // Reconnect immediately when the screen wakes rather than waiting out a backoff.
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !closed && ws === null) {
        clearTimer();
        attempt = 0;
        open();
      }
    });
  }

  open();

  return {
    send(frame) {
      if (ws === null || ws.readyState !== WebSocket.OPEN) return false;
      try {
        ws.send(frame);
        return true;
      } catch {
        return false;
      }
    },
    close() {
      closed = true;
      clearTimer();
      if (ws !== null) ws.close();
      ws = null;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: reconnecting websocket client with jittered backoff"
```

---

### Task 7: Receiver page (car)

**Files:**
- Create: `r/index.html`, `index.html`
- Create: `src/client/app.css`, `src/client/qr.ts`, `src/client/session.ts`, `src/client/receiver.ts`
- Test: covered by Playwright in Task 10; `session.ts` is unit-tested here.
- Test: `tests/shared/session.test.ts`

**Interfaces:**
- Consumes: `derivePairing`, `generateSeed`, `parseSeedCode`, `formatSeedCode`, `buildSenderUrl`, `buildReceiverUrl` (pairing); `seal`, `openEnvelope`, `newMessageId` (envelope); `createSeenStore`, `SeenStore`, `KeyValueStore` (replay); `bumpDropCount`, `recordClockDelta` (diagnostics); `loadHistory`, `pushHistory`, `clearHistory` (history); `connect` (socket).
- Produces:
  - `src/client/session.ts`: `SEED_STORAGE_KEY`, `type SeedSource = "fragment" | "storage" | "generated"`, `type ResolveMode = "generate" | "require"`, `interface ResolvedSeed { seed: Uint8Array; source: SeedSource }`, `resolveSeed(fragment: string, storage: KeyValueStore, mode: ResolveMode): ResolvedSeed | null`, `storeSeed(storage: KeyValueStore, seed: Uint8Array): void`, `clearSeed(storage: KeyValueStore): void`
  - `src/client/qr.ts`: `renderQr(target: HTMLElement, text: string): void`

`resolveSeed` takes a `mode` so the two pages differ in exactly one respect: the car generates a seed when none exists, the phone does not.

- [ ] **Step 1: Write the failing test for seed resolution**

`tests/shared/session.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project shared`
Expected: FAIL — cannot resolve `../../src/client/session`.

- [ ] **Step 3: Write `src/client/session.ts`**

```ts
import { encodeBase32 } from "../shared/base32";
import { parseSeedCode, generateSeed, SEED_BYTES } from "../shared/pairing";
import type { KeyValueStore } from "../shared/replay";

export const SEED_STORAGE_KEY = "teslaport:seed";

export type SeedSource = "fragment" | "storage" | "generated";
export type ResolveMode = "generate" | "require";

export interface ResolvedSeed {
  seed: Uint8Array;
  source: SeedSource;
}

function tryParse(code: string | null): Uint8Array | null {
  if (!code) return null;
  try {
    const seed = parseSeedCode(code);
    return seed.length === SEED_BYTES ? seed : null;
  } catch {
    return null;
  }
}

export function storeSeed(storage: KeyValueStore, seed: Uint8Array): void {
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project shared`
Expected: PASS.

- [ ] **Step 5: Write `src/client/qr.ts`**

`qrcode-generator` ships a CommonJS default export, and its ESM interop under Vite is a known rough edge. If `qrcode(0, "M")` throws "qrcode is not a function", the default import resolved to the module namespace — use `const make = (qrcode as unknown as { default?: typeof qrcode }).default ?? qrcode;` and call `make(0, "M")`. Budget a few minutes for this; do not swap libraries over it.

```ts
import qrcode from "qrcode-generator";

export function renderQr(target: HTMLElement, text: string): void {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  target.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  const svg = target.querySelector("svg");
  if (svg) {
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Pairing QR code");
  }
}
```

- [ ] **Step 6: Write `src/client/app.css`**

```css
:root {
  --bg: #0b0d10;
  --panel: #16191f;
  --line: #2a2f38;
  --text: #f2f5f9;
  --muted: #9aa4b2;
  --accent: #4da3ff;
  --ok: #3ddc84;
  --warn: #ffb020;
  --bad: #ff5d5d;
  color-scheme: dark;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 24px;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.5 system-ui, -apple-system, sans-serif;
}

h1 { font-size: 24px; margin: 0 0 16px; }

.layout { display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start; }
.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 20px;
}
.pair { flex: 0 0 320px; text-align: center; }
.feed { flex: 1 1 420px; min-width: 320px; }

#qr { width: 260px; height: 260px; margin: 0 auto 16px; background: #fff; padding: 12px; border-radius: 8px; }
#qr svg { display: block; }

.code {
  font: 600 22px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 2px;
  word-break: break-all;
}

.hint { color: var(--muted); font-size: 14px; margin-top: 12px; }

.status { display: flex; align-items: center; gap: 8px; justify-content: center; margin-top: 12px; font-size: 15px; }
.dot { width: 12px; height: 12px; border-radius: 50%; background: var(--muted); }
.dot[data-state="open"] { background: var(--ok); }
.dot[data-state="connecting"] { background: var(--warn); }
.dot[data-state="closed"] { background: var(--bad); }

ul.links { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
ul.links a {
  display: block;
  padding: 20px;
  min-height: 64px;
  background: #1d222b;
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--accent);
  font-size: 20px;
  text-decoration: none;
  word-break: break-all;
}
ul.links a:active { background: #262c37; }

button {
  font: inherit;
  min-height: 52px;
  padding: 0 20px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: #1d222b;
  color: var(--text);
  cursor: pointer;
}
button.primary { background: var(--accent); color: #04121f; border-color: transparent; font-weight: 600; }
button:disabled { opacity: 0.45; cursor: not-allowed; }

input[type="url"], input[type="text"] {
  width: 100%;
  font: inherit;
  min-height: 52px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: #0f1216;
  color: var(--text);
}

.empty { color: var(--muted); }
.row { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
.msg { margin-top: 12px; min-height: 24px; font-size: 15px; }
.msg[data-tone="ok"] { color: var(--ok); }
.msg[data-tone="warn"] { color: var(--warn); }
.msg[data-tone="bad"] { color: var(--bad); }
```

- [ ] **Step 7: Write `r/index.html` and `index.html`**

`r/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TeslaPort — Car</title>
    <link rel="stylesheet" href="/src/client/app.css" />
  </head>
  <body>
    <h1>TeslaPort</h1>
    <div class="layout">
      <section class="panel pair">
        <div id="qr"></div>
        <div class="code" id="code"></div>
        <div class="status"><span class="dot" id="dot"></span><span id="status">Connecting…</span></div>
        <p class="hint" id="hint">Scan with your phone to pair.</p>
        <p class="hint" id="bookmark"></p>
        <div class="row">
          <button id="burn">Burn code</button>
          <button id="clear">Clear history</button>
        </div>
      </section>
      <section class="panel feed">
        <h2>Received links</h2>
        <ul class="links" id="links"></ul>
        <p class="empty" id="empty">Nothing yet. Send a link from your phone.</p>
        <p class="hint"><a href="/debug">Diagnostics</a></p>
      </section>
    </div>
    <script type="module" src="/src/client/receiver.ts"></script>
  </body>
</html>
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TeslaPort</title>
    <link rel="stylesheet" href="/src/client/app.css" />
  </head>
  <body>
    <h1>TeslaPort</h1>
    <section class="panel">
      <p>Send links from your phone to your car's browser. Links are encrypted in your browser; the server cannot read them.</p>
      <div class="row">
        <a href="/r"><button class="primary">I'm the car — show my code</button></a>
        <a href="/s"><button>I'm the phone — send a link</button></a>
      </div>
    </section>
  </body>
</html>
```

- [ ] **Step 8: Write `src/client/receiver.ts`**

```ts
import { derivePairing, formatSeedCode, buildSenderUrl, buildReceiverUrl, type Pairing } from "../shared/pairing";
import { encodeBase32 } from "../shared/base32";
import { openEnvelope, seal } from "../shared/envelope";
import { createSeenStore, type SeenStore } from "../shared/replay";
import { bumpDropCount, recordClockDelta, installErrorCapture } from "../shared/diagnostics";
import { loadHistory, pushHistory, clearHistory, type HistoryEntry } from "./history";
import { connect, type SocketHandle } from "../shared/socket";
import { resolveSeed, storeSeed, clearSeed } from "./session";
import { renderQr } from "./qr";

const storage = window.localStorage;
const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let pairing: Pairing;
let seen: SeenStore;
let socket: SocketHandle | null = null;

function renderLinks(entries: HistoryEntry[]): void {
  const list = el<HTMLUListElement>("links");
  list.textContent = "";
  for (const entry of entries) {
    const item = document.createElement("li");
    const anchor = document.createElement("a");
    anchor.href = entry.url;
    // Same tab, deliberately: Tesla's browser handles target="_blank"
    // unreliably, and a link that does nothing when tapped is the worst
    // failure mode on a screen with no developer tools.
    anchor.rel = "noopener noreferrer";
    anchor.textContent = entry.url;
    item.appendChild(anchor);
    list.appendChild(item);
  }
  el("empty").hidden = entries.length > 0;
}

function setStatus(state: string, label: string): void {
  el("dot").dataset.state = state;
  el("status").textContent = label;
}

async function handleFrame(frame: Uint8Array): Promise<void> {
  const result = await openEnvelope(pairing, frame, Date.now());
  if (!result.ok) {
    bumpDropCount(storage, result.reason);
    return;
  }
  if (result.payload.t !== "url") return;

  recordClockDelta(storage, Date.now() - result.payload.ts);
  if (seen.has(result.payload.id)) {
    bumpDropCount(storage, "replay");
    return;
  }
  seen.add(result.payload.id);
  renderLinks(pushHistory(storage, {
    id: result.payload.id,
    url: result.payload.url,
    ts: result.payload.ts,
  }));

  // Acknowledge only after acceptance and render.
  const ack = await seal(pairing, { t: "ack", id: result.payload.id });
  socket?.send(ack);
}

async function start(seed: Uint8Array): Promise<void> {
  pairing = await derivePairing(seed);
  seen = createSeenStore(storage);

  const code = encodeBase32(seed);
  renderQr(el("qr"), buildSenderUrl(location.origin, code));
  el("code").textContent = formatSeedCode(code);
  el("hint").textContent = "Scan with your phone, or type this code at " + location.host + "/s";
  renderLinks(loadHistory(storage));

  // Keep the bookmarkable, seed-carrying URL in the address bar so that
  // bookmarking this page survives a localStorage wipe.
  history.replaceState(null, "", buildReceiverUrl(location.origin, code));

  // The car's browser storage gets cleared by software updates. The bookmark is
  // the only thing that survives, so ask for it explicitly rather than hoping.
  el("bookmark").textContent =
    "Bookmark this page now — the address bar holds your code. If the car clears "
    + "its browser data, opening the bookmark restores this same pairing.";

  socket?.close();
  socket = connect(`${location.origin.replace(/^http/, "ws")}/ws/${pairing.roomId}?role=receiver`, {
    onStatus(status) {
      if (status === "open") setStatus("open", "Ready to receive");
      else if (status === "connecting") setStatus("connecting", "Connecting…");
      else setStatus("closed", "Disconnected — retrying");
    },
    onFrame(frame) { void handleFrame(frame); },
    onControl() { /* the car ignores control messages */ },
  });
}

el("burn").addEventListener("click", () => {
  if (!confirm("Burn this code? Paired phones will stop working.")) return;
  clearSeed(storage);
  clearHistory(storage);
  seen.clear();
  const resolved = resolveSeed("", storage, "generate")!;
  void start(resolved.seed);
});

el("clear").addEventListener("click", () => {
  clearHistory(storage);
  renderLinks([]);
});

installErrorCapture(storage);
const resolved = resolveSeed(location.hash, storage, "generate")!;
storeSeed(storage, resolved.seed);
void start(resolved.seed);
```

- [ ] **Step 9: Build and verify the extensionless routes resolve**

This is the first build in the project, and the first chance to catch an asset-routing 404. Do it now rather than at deploy.

```bash
npm run build && npx wrangler dev
```

```bash
for path in / /r /s /debug; do printf '%s -> ' "$path"; curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8787$path"; done
```

Expected: `200` for all four, with **no trailing slash added**. A 404 or a 301 to `/r/` means `html_handling` in `wrangler.jsonc` is wrong — fix the config, not the links.

Then open `http://localhost:8787/r`. Expected: a QR code renders, a 4×6 dashed code appears below it, the status dot turns green, the bookmark prompt is visible, and the address bar shows `/r#<24 chars>`. Check the browser console is clean — in particular, no CSP violations.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: receiver page with QR pairing, ack, and link history"
```

---

### Task 8: Sender page (phone)

**Files:**
- Create: `s/index.html`, `src/client/sender.ts`
- Test: `tests/shared/sender-url.test.ts`

**Interfaces:**
- Consumes: everything Task 7 produced, plus `ACK_TIMEOUT_MS` from protocol.
- Produces: `normaliseInputUrl(raw: string): string | null` exported from `src/client/sender.ts` for unit testing.

- [ ] **Step 1: Write the failing test**

`tests/shared/sender-url.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normaliseInputUrl } from "../../src/client/sender";

describe("sender input normalisation", () => {
  it("accepts full http(s) urls unchanged", () => {
    expect(normaliseInputUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(normaliseInputUrl("http://example.com/")).toBe("http://example.com/");
  });

  it("prepends https to a bare host", () => {
    expect(normaliseInputUrl("example.com")).toBe("https://example.com/");
    expect(normaliseInputUrl("example.com/path")).toBe("https://example.com/path");
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseInputUrl("  https://example.com/  ")).toBe("https://example.com/");
  });

  it("rejects non-http schemes", () => {
    expect(normaliseInputUrl("javascript:alert(1)")).toBeNull();
    expect(normaliseInputUrl("data:text/html,x")).toBeNull();
    expect(normaliseInputUrl("file:///etc/passwd")).toBeNull();
  });

  it("rejects empty and unparseable input", () => {
    expect(normaliseInputUrl("")).toBeNull();
    expect(normaliseInputUrl("   ")).toBeNull();
    expect(normaliseInputUrl("http://")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project shared`
Expected: FAIL — cannot resolve `../../src/client/sender`.

Note: `sender.ts` runs DOM setup at module scope, which would break this Node-pool test. Guard the bootstrap so the module is importable without a DOM — the implementation below does this with a `typeof document` check.

- [ ] **Step 3: Write `s/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TeslaPort — Phone</title>
    <link rel="stylesheet" href="/src/client/app.css" />
  </head>
  <body>
    <h1>Send to car</h1>
    <section class="panel" id="paired" hidden>
      <div class="status"><span class="dot" id="dot"></span><span id="status">Connecting…</span></div>
      <p><input type="url" id="url" placeholder="Paste a link" autocomplete="off" autocapitalize="off" spellcheck="false" /></p>
      <div class="row"><button class="primary" id="send" disabled>Send</button></div>
      <p class="msg" id="msg"></p>
    </section>
    <section class="panel" id="unpaired">
      <p>Not paired yet.</p>
      <p class="hint">Open TeslaPort on your car screen and scan the QR code, or type the code below.</p>
      <p><input type="text" id="manual" placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX" autocapitalize="characters" autocomplete="off" spellcheck="false" /></p>
      <div class="row"><button class="primary" id="pair">Pair</button></div>
      <p class="msg" id="pairmsg"></p>
    </section>
    <script type="module" src="/src/client/sender.ts"></script>
  </body>
</html>
```

- [ ] **Step 4: Write `src/client/sender.ts`**

```ts
import { derivePairing, parseSeedCode, type Pairing } from "../shared/pairing";
import { encodeBase32 } from "../shared/base32";
import { seal, openEnvelope, newMessageId } from "../shared/envelope";
import { connect, type SocketHandle, type ConnectionStatus } from "../shared/socket";
import { installErrorCapture } from "../shared/diagnostics";
import { resolveSeed, storeSeed } from "./session";
import { ACK_TIMEOUT_MS } from "../shared/protocol";

export function normaliseInputUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function bootstrap(): void {
  const storage = window.localStorage;
  installErrorCapture(storage);
  const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

  let pairing: Pairing;
  let socket: SocketHandle | null = null;
  let receivers = 0;
  let connection: ConnectionStatus = "connecting";
  let pending: { id: string; timer: number } | null = null;

  function message(text: string, tone: "ok" | "warn" | "bad" | ""): void {
    const node = el("msg");
    node.textContent = text;
    node.dataset.tone = tone;
  }

  /**
   * Single place that paints connection state. Presence and connection status
   * arrive independently, so neither may write the status text directly — a
   * late presence frame would otherwise paint "Car connected" over a socket
   * that has already dropped.
   */
  function paint(): void {
    const dot = el("dot");
    const status = el("status");
    if (connection === "open") {
      dot.dataset.state = "open";
      status.textContent = receivers > 0 ? "Car connected" : "Car not connected";
    } else if (connection === "connecting") {
      dot.dataset.state = "connecting";
      status.textContent = "Connecting…";
    } else {
      dot.dataset.state = "closed";
      status.textContent = "Reconnecting…";
    }
    (el("send") as HTMLButtonElement).disabled =
      !(connection === "open" && receivers > 0 && pending === null);
  }

  function clearPending(): void {
    if (pending) window.clearTimeout(pending.timer);
    pending = null;
    paint();
  }

  async function send(): Promise<void> {
    if (pending !== null) return;
    const input = el<HTMLInputElement>("url");
    const url = normaliseInputUrl(input.value);
    if (!url) {
      message("That doesn't look like a web link.", "bad");
      return;
    }

    // Claim the pending slot BEFORE awaiting seal(), so a double-tap during
    // encryption cannot ship the same link twice.
    const id = newMessageId();
    pending = { id, timer: 0 };
    paint();
    message("Sending…", "");

    const frame = await seal(pairing, { t: "url", id, url, ts: Date.now() });
    if (pending === null || pending.id !== id) return; // superseded while sealing

    if (socket === null || !socket.send(frame)) {
      clearPending();
      message("Not connected — the link was not sent. Try again in a moment.", "bad");
      return;
    }

    pending.timer = window.setTimeout(() => {
      clearPending();
      message(
        "No confirmation from the car. The link may not have arrived — open /debug on the car screen.",
        "bad",
      );
    }, ACK_TIMEOUT_MS);
  }

  async function handleFrame(frame: Uint8Array): Promise<void> {
    const result = await openEnvelope(pairing, frame, Date.now());
    if (!result.ok || result.payload.t !== "ack") return;
    if (!pending || pending.id !== result.payload.id) return;
    clearPending();
    el<HTMLInputElement>("url").value = "";
    message("Sent ✓", "ok");
  }

  async function start(seed: Uint8Array): Promise<void> {
    pairing = await derivePairing(seed);
    el("unpaired").hidden = true;
    el("paired").hidden = false;

    socket?.close();
    socket = connect(`${location.origin.replace(/^http/, "ws")}/ws/${pairing.roomId}?role=sender`, {
      onStatus(status) {
        connection = status;
        // Presence is only meaningful on a live socket; a stale count must not
        // survive a drop.
        if (status !== "open") receivers = 0;
        paint();
      },
      onFrame(frame) { void handleFrame(frame); },
      onControl(control) {
        if (control.t === "presence") {
          receivers = control.receivers;
          paint();
        } else if (control.t === "no-receiver") {
          clearPending();
          message("Car not connected — open TeslaPort on the car screen.", "bad");
        } else if (control.t === "error") {
          clearPending();
          message(control.code === "too_large" ? "That link is too long." : "Slow down — too many sends.", "bad");
        }
      },
    });
  }

  el("send").addEventListener("click", () => void send());
  el<HTMLInputElement>("url").addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter" && !(el("send") as HTMLButtonElement).disabled) void send();
  });

  el("pair").addEventListener("click", () => {
    const raw = el<HTMLInputElement>("manual").value;
    try {
      const seed = parseSeedCode(raw);
      storeSeed(storage, seed);
      history.replaceState(null, "", `/s#${encodeBase32(seed)}`);
      void start(seed);
    } catch {
      const node = el("pairmsg");
      node.textContent = "That code isn't valid. Check it against the car screen.";
      node.dataset.tone = "bad";
    }
  });

  const resolved = resolveSeed(location.hash, storage, "require");
  if (resolved) void start(resolved.seed);
}

if (typeof document !== "undefined") bootstrap();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --project shared`
Expected: PASS.

- [ ] **Step 6: Manually verify the end-to-end path**

```bash
npm run build && npx wrangler dev
```

Open `http://localhost:8787/r` in one window. Copy the `/r#…` fragment, open `http://localhost:8787/s#<same 24 chars>` in a second window. Expected: sender shows "Car connected"; paste `https://example.com`, click Send; the link appears on the receiver and the sender shows "Sent ✓" with a cleared box.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: sender page with presence gating and end-to-end ack"
```

---

### Task 9: Diagnostics page

Without this, a failure in the car is undiagnosable — there are no developer tools.

**Files:**
- Create: `debug/index.html`, `src/client/debug.ts`

**Interfaces:**
- Consumes: `derivePairing`, `generateSeed`, `resolveSeed`, `openEnvelope`, `seal`, `newMessageId`, `loadHistory`, `loadDropCounts`, `readClockDelta`.
- Produces: nothing consumed by other tasks. Drop counters and the clock delta are read from localStorage, which is what makes them visible on this separate page.

- [ ] **Step 1: Write `debug/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TeslaPort — Diagnostics</title>
    <link rel="stylesheet" href="/src/client/app.css" />
  </head>
  <body>
    <h1>Diagnostics</h1>
    <section class="panel"><dl id="report"></dl></section>
    <section class="panel">
      <h2>Recent errors</h2>
      <pre id="log" class="hint"></pre>
    </section>
    <p class="hint"><a href="/r">Back to the car page</a></p>
    <script type="module" src="/src/client/debug.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `src/client/debug.ts`**

```ts
import { derivePairing, generateSeed, base64url } from "../shared/pairing";
import { seal, openEnvelope, newMessageId } from "../shared/envelope";
import { loadHistory } from "./history";
import { loadDropCounts, readClockDelta, loadErrors, installErrorCapture } from "../shared/diagnostics";
import { resolveSeed } from "./session";

installErrorCapture(window.localStorage);

const rows: Array<[string, string]> = [];

function add(label: string, value: string): void {
  rows.push([label, value]);
}

function render(): void {
  const list = document.getElementById("report")!;
  list.textContent = "";
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    dd.style.marginBottom = "12px";
    list.appendChild(dt);
    list.appendChild(dd);
  }
  // Errors are read from storage, so failures on /r are visible here.
  const errors = loadErrors(window.localStorage);
  document.getElementById("log")!.textContent = errors.length ? errors.join("\n") : "none";
}

/**
 * Opens a real socket to a throwaway room, sends a byte, and waits for the
 * server's `no-receiver` control reply. That proves the upgrade, the frame
 * path, and the return path — everything the app depends on.
 */
async function probeWebSocket(): Promise<string> {
  if (typeof WebSocket !== "function") return "MISSING: no WebSocket constructor";
  const probeRoom = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const url = `${location.origin.replace(/^http/, "ws")}/ws/${probeRoom}?role=sender`;
  return new Promise<string>((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      resolve(`FAILED to construct: ${String(error)}`);
      return;
    }
    const started = Date.now();
    const finish = (result: string): void => {
      try { ws.close(); } catch { /* already closing */ }
      resolve(result);
    };
    const timer = setTimeout(() => finish("FAILED: no reply within 5s"), 5000);
    ws.addEventListener("open", () => ws.send(new Uint8Array([0])));
    ws.addEventListener("message", (event) => {
      if (typeof (event as MessageEvent).data !== "string") return;
      clearTimeout(timer);
      finish(`ok (${Date.now() - started} ms)`);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      finish("FAILED: connection error");
    });
  });
}

async function run(): Promise<void> {
  add("User agent", navigator.userAgent);
  add("Secure context", String(window.isSecureContext));
  add("Local time", new Date().toISOString());

  // Live round-trip checks, not feature sniffing.
  try {
    window.localStorage.setItem("teslaport:probe", "1");
    const ok = window.localStorage.getItem("teslaport:probe") === "1";
    window.localStorage.removeItem("teslaport:probe");
    add("localStorage round-trip", ok ? "ok" : "FAILED");
  } catch (error) {
    add("localStorage round-trip", `FAILED: ${String(error)}`);
  }

  add("crypto.subtle", typeof crypto !== "undefined" && !!crypto.subtle ? "present" : "MISSING");

  // A live round trip, not a constructor check: proxies, TLS interception and
  // captive portals all leave `WebSocket` defined while breaking the connection.
  add("WebSocket round-trip", await probeWebSocket());

  try {
    const pairing = await derivePairing(generateSeed());
    const id = newMessageId();
    const frame = await seal(pairing, { t: "url", id, url: "https://example.com/", ts: Date.now() });
    const result = await openEnvelope(pairing, frame, Date.now());
    add("Crypto round-trip", result.ok && result.payload.t === "url" ? "ok" : "FAILED");
  } catch (error) {
    add("Crypto round-trip", `FAILED: ${String(error)}`);
  }

  const resolved = resolveSeed("", window.localStorage, "require");
  add("Stored seed", resolved ? `present (${resolved.source})` : "none — this device is not paired");
  if (resolved) {
    const pairing = await derivePairing(resolved.seed);
    add("Room ID", pairing.roomId);
  }

  add("History entries", String(loadHistory(window.localStorage).length));

  const drops = loadDropCounts(window.localStorage);
  add(
    "Rejected messages",
    `decrypt ${drops.decrypt}, malformed ${drops.malformed}, bad scheme ${drops.scheme}, `
      + `stale ${drops.stale}, replay ${drops.replay}`,
  );

  const delta = readClockDelta(window.localStorage);
  add(
    "Clock delta vs last sender (ms)",
    delta === null
      ? "no message received yet"
      : `${delta}${Math.abs(delta) > 300000 ? " — OVER THE 5 MINUTE WINDOW, messages will be rejected" : ""}`,
  );

  render();
}

void run();
```

- [ ] **Step 3: Verify manually**

```bash
npm run build && npx wrangler dev
```

Open `http://localhost:8787/debug`. Expected: every round-trip row says `ok`, `Room ID` matches the value the car page derives, and "Recent errors" says `none`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: on-screen diagnostics page for the car browser"
```

---

### Task 10: Playwright integration tests

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/pairing.spec.ts`

**Interfaces:**
- Consumes: the running app.
- Produces: nothing.

- [ ] **Step 1: Install Playwright**

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Write `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30000,
  use: { baseURL: "http://localhost:8787" },
  webServer: {
    command: "npm run build && npx wrangler dev --port 8787",
    url: "http://localhost:8787/",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
```

- [ ] **Step 3: Write the failing test**

`tests/e2e/pairing.spec.ts`:

```ts
import { test, expect, type Page, type Browser } from "@playwright/test";

async function openCar(browser: Browser): Promise<{ page: Page; code: string; roomId: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/r");
  await expect(page.locator("#qr svg")).toBeVisible();
  await expect(page.locator("#dot")).toHaveAttribute("data-state", "open");
  const code = new URL(page.url()).hash.replace(/^#/, "");
  expect(code).toHaveLength(24);

  const debugPage = await context.newPage();
  await debugPage.goto("/debug");
  const roomId = await debugPage.locator("dt:text-is('Room ID') + dd").innerText();
  await debugPage.close();

  return { page, code, roomId };
}

test("pairs, sends a link, renders it, and acks", async ({ browser }) => {
  const car = await openCar(browser);
  const phone = await (await browser.newContext()).newPage();
  await phone.goto(`/s#${car.code}`);

  await expect(phone.locator("#status")).toHaveText("Car connected");
  await phone.locator("#url").fill("https://example.com/hello");
  await phone.locator("#send").click();

  await expect(phone.locator("#msg")).toHaveText("Sent ✓");
  await expect(phone.locator("#url")).toHaveValue("");
  await expect(car.page.locator("ul#links a")).toHaveText("https://example.com/hello");
  await expect(car.page.locator("ul#links a")).toHaveAttribute("rel", "noopener noreferrer");
  // Same tab, deliberately — Tesla's browser mishandles target="_blank".
  await expect(car.page.locator("ul#links a")).not.toHaveAttribute("target", /.*/);
});

test("disables send when the car is absent", async ({ browser }) => {
  const car = await openCar(browser);
  const code = car.code;
  await car.page.context().close();

  const phone = await (await browser.newContext()).newPage();
  await phone.goto(`/s#${code}`);
  await expect(phone.locator("#status")).toHaveText("Car not connected");
  await expect(phone.locator("#send")).toBeDisabled();
});

test("reconnects the car after the network drops", async ({ browser }) => {
  const car = await openCar(browser);
  const context = car.page.context();

  await context.setOffline(true);
  await expect(car.page.locator("#dot")).toHaveAttribute("data-state", "closed");

  await context.setOffline(false);
  await expect(car.page.locator("#dot")).toHaveAttribute("data-state", "open", { timeout: 20000 });
});

test("an unkeyed receiver neither displaces the car nor acks", async ({ browser }) => {
  const car = await openCar(browser);

  // A third party that learned only the roomId connects as a receiver.
  const intruderPage = await (await browser.newContext()).newPage();
  await intruderPage.goto("/");
  const received = intruderPage.evaluate((roomId) => {
    return new Promise<number>((resolve) => {
      const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws/${roomId}?role=receiver`);
      ws.binaryType = "arraybuffer";
      ws.addEventListener("message", (event) => resolve((event.data as ArrayBuffer).byteLength));
    });
  }, car.roomId);

  const phone = await (await browser.newContext()).newPage();
  await phone.goto(`/s#${car.code}`);
  await expect(phone.locator("#status")).toHaveText("Car connected");
  await phone.locator("#url").fill("https://example.com/secret");
  await phone.locator("#send").click();

  // The car still receives, renders, and acks.
  await expect(car.page.locator("ul#links a")).toHaveText("https://example.com/secret");
  await expect(phone.locator("#msg")).toHaveText("Sent ✓");
  // The intruder received only opaque bytes.
  expect(await received).toBeGreaterThan(12);
});

test("burning the code strands the old phone", async ({ browser }) => {
  const car = await openCar(browser);
  const oldCode = car.code;

  car.page.on("dialog", (dialog) => void dialog.accept());
  await car.page.locator("#burn").click();
  await expect(car.page).toHaveURL(new RegExp("/r#(?!" + oldCode + ")"));

  const phone = await (await browser.newContext()).newPage();
  await phone.goto(`/s#${oldCode}`);
  await expect(phone.locator("#status")).toHaveText("Car not connected");
  await expect(phone.locator("#send")).toBeDisabled();
});
```

- [ ] **Step 4: Run the tests**

Run: `npx playwright test`
Expected: 5 passing tests.

If the "reconnects" test is slow, that is the jittered backoff working as designed — the 20-second timeout accommodates it. Do not shorten the backoff to make the test faster.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: playwright integration coverage for pair, send, ack, and intruder"
```

---

### Task 11: Deployment, README, and the in-car checklist

**Files:**
- Create: `README.md`, `docs/in-car-checklist.md`
- Modify: `package.json` (add `check` script)

**Interfaces:**
- Consumes: everything.
- Produces: a deployable app.

- [ ] **Step 1: Add an aggregate check script**

In `package.json` scripts, add:

```json
"check": "npm run typecheck && npm run test && npm run test:e2e"
```

- [ ] **Step 2: Run the full suite**

Run: `npm run check`
Expected: typecheck clean, all unit and worker tests pass, all Playwright tests pass. Do not proceed until every one is green.

- [ ] **Step 3: Write `docs/in-car-checklist.md`**

```markdown
# In-car verification checklist

Nothing in the automated suite proves the real Tesla browser works. Run this
once after the first deploy, and again after any change to `src/shared` or
`src/client`.

1. **Load `/debug` on the car screen.** Every round-trip row — localStorage,
   crypto, and WebSocket — must read `ok`.
   Record the user agent string here the first time: `________`.
   If `crypto.subtle` is MISSING, the page is not on HTTPS — stop and fix that.
   If the WebSocket round-trip fails, nothing else will work; stop here.
2. **Load `/r`.** A QR code renders and the status dot is green.
3. **Scan the QR with a phone.** The phone opens `/s` already paired and shows
   "Car connected".
4. **Send a link.** It appears on the car screen and the phone shows "Sent ✓".
5. **Tap the link on the car screen.** It opens the page **in the same tab**.
   Use the browser's back control to return to `/r`; the pairing and history
   must still be there. If you want links to open in a new tab instead, verify
   `target="_blank"` actually works in this browser build first — the design
   deliberately does not assume it.
6. **Bookmark the `/r#…` URL**, then clear the car browser's data, then open
   the bookmark. The same code must reappear — not a new one.
7. **Put the car to sleep for ten minutes, then wake it.** The status dot
   returns to green without a manual reload.
8. **Check the clock.** On `/debug`, "Clock delta vs last sender" should be
   within a few seconds. A delta over 5 minutes will silently reject every
   message.
9. **Burn the code.** The old phone must fall back to "Car not connected".
```

- [ ] **Step 4: Write `README.md`**

```markdown
# TeslaPort

Send links from your phone to your Tesla's browser. Links are encrypted in your
browser and decrypted in the car; the server relays opaque bytes and cannot read
them.

## How it works

The car generates a 15-byte seed. Both a `roomId` (routing) and an AES-256-GCM
`contentKey` (encryption) are derived from it with HKDF-SHA256. Only the
`roomId` reaches the server. The seed travels to the phone in a URL fragment,
which browsers never transmit in an HTTP request.

The server is a Cloudflare Durable Object that persists nothing: it fans binary
frames from senders out to receivers and acks back, then forgets them.

See `docs/superpowers/specs/2026-07-30-teslaport-design.md` for the full design,
including what the server can still observe.

## Develop

```bash
npm install
npm run dev        # builds and serves on http://localhost:8787
npm run check      # typecheck + unit + worker + e2e
```

## Deploy

```bash
npx wrangler login
npm run deploy
```

Then point a domain at the Worker in the Cloudflare dashboard. Durable Objects
run on the free plan, so hosting cost is the domain registration only.

## Limits

One pairing per browser profile. The seed occupies a single storage slot, so
opening `/s` with a different code repairs that phone to the new car rather
than remembering both. Pairing several phones to one car works fine — that
direction is unlimited.

After the first deploy, run `docs/in-car-checklist.md` in the car.
```

- [ ] **Step 5: Deploy**

```bash
npx wrangler login
npm run deploy
```

Expected: Wrangler prints a `*.workers.dev` URL. Open `/debug` there in a desktop browser first; every row must read `ok`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: readme, in-car checklist, and deploy script"
```

---

## Post-implementation

The two open items the spec deferred are now resolved: the QR library is `qrcode-generator`, and the wire encoding is binary frames for envelopes with JSON text frames for control. The only remaining decision is the domain name, which is a Cloudflare dashboard action, not code.

Run `docs/in-car-checklist.md` in the actual car before considering this done. Record the Tesla browser's user agent in that file — it is the single most useful fact for any future debugging, and there is no other way to obtain it.
