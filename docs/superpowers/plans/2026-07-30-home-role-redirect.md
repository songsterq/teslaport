# Home Role Redirect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a browser revisits `/`, skip the role chooser and resume the last role (`/r` or `/s`) this device used.

**Architecture:** Persist `teslaport:role` (`"receiver"` | `"sender"`) in `localStorage` alongside the existing seed. `/r` and `/s` write the role on load; a tiny `home.ts` on `/` reads it and `location.replace`s, unless `?choose` is present. A quiet “Start over” link on each page routes back to `/?choose` so the chooser is always reachable.

**Tech Stack:** TypeScript, Vite multi-page app (no UI framework), Vitest, existing `session.ts` / `KeyValueStore` patterns.

**Spec:** `docs/superpowers/specs/2026-07-30-home-role-redirect-design.md`. Where this plan and the spec disagree, the spec wins — stop and raise it.

## Global Constraints

Every task's requirements implicitly include this section.

1. **Client-only.** No Worker, cookie, or server redirect. Role never leaves the browser.
2. **Do not clear role on burn / clear history.**
3. **Legacy devices:** seed present but no role → show chooser (do not infer role from seed).
4. **Corrupt / missing role → `null`** → show chooser.
5. **Hard invariants from the main TeslaPort design still apply** (server never reads links, persists nothing, no third-party request-path services).

## File structure

| File | Responsibility |
|---|---|
| `src/client/session.ts` | Seed + role persistence helpers |
| `tests/shared/session.test.ts` | Unit tests for seed and role helpers |
| `src/client/home.ts` | `/` redirect: load role → `location.replace` or no-op |
| `index.html` | Chooser shell; loads `home.ts` |
| `src/client/receiver.ts` | Car page; call `storeRole(..., "receiver")` |
| `src/client/sender.ts` | Phone page; call `storeRole(..., "sender")` |
| `r/index.html` | “Start over” link to `/?choose` |
| `s/index.html` | “Start over” link to `/?choose` |

---

### Task 1: Role storage helpers

**Files:**
- Modify: `src/client/session.ts`
- Modify: `tests/shared/session.test.ts`

**Interfaces:**
- Consumes: existing `KeyValueStore` from `src/shared/replay.ts`
- Produces:
  - `export const ROLE_STORAGE_KEY = "teslaport:role"`
  - `export type Role = "receiver" | "sender"`
  - `export function storeRole(storage: KeyValueStore, role: Role): void`
  - `export function loadRole(storage: KeyValueStore): Role | null`

- [ ] **Step 1: Write the failing tests**

Append to `tests/shared/session.test.ts` (keep the existing `memoryStore` helper and seed suite; add imports for the new symbols):

```ts
import {
  resolveSeed,
  storeSeed,
  clearSeed,
  SEED_STORAGE_KEY,
  storeRole,
  loadRole,
  ROLE_STORAGE_KEY,
} from "../../src/client/session";

describe("role storage", () => {
  it("stores and loads receiver and sender", () => {
    const storage = memoryStore();
    storeRole(storage, "receiver");
    expect(storage.getItem(ROLE_STORAGE_KEY)).toBe("receiver");
    expect(loadRole(storage)).toBe("receiver");
    storeRole(storage, "sender");
    expect(loadRole(storage)).toBe("sender");
  });

  it("returns null when missing", () => {
    expect(loadRole(memoryStore())).toBeNull();
  });

  it("returns null for corrupt values", () => {
    const storage = memoryStore();
    storage.setItem(ROLE_STORAGE_KEY, "car");
    expect(loadRole(storage)).toBeNull();
    storage.setItem(ROLE_STORAGE_KEY, "");
    expect(loadRole(storage)).toBeNull();
  });

  it("does not clear role when clearing the seed", () => {
    const storage = memoryStore();
    storeRole(storage, "receiver");
    storeSeed(storage, generateSeed());
    clearSeed(storage);
    expect(loadRole(storage)).toBe("receiver");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/session.test.ts -v`

Expected: FAIL — `storeRole` / `loadRole` / `ROLE_STORAGE_KEY` are not exported.

- [ ] **Step 3: Implement role helpers**

Add to `src/client/session.ts` (after the existing seed helpers is fine):

```ts
export const ROLE_STORAGE_KEY = "teslaport:role";

export type Role = "receiver" | "sender";

export function storeRole(storage: KeyValueStore, role: Role): void {
  storage.setItem(ROLE_STORAGE_KEY, role);
}

export function loadRole(storage: KeyValueStore): Role | null {
  const value = storage.getItem(ROLE_STORAGE_KEY);
  if (value === "receiver" || value === "sender") return value;
  return null;
}
```

Do **not** change `clearSeed` to also remove the role.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/session.test.ts -v`

Expected: PASS (all seed + role tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/session.ts tests/shared/session.test.ts
git commit -m "$(cat <<'EOF'
feat: persist last UI role in localStorage

EOF
)"
```

---

### Task 2: Home page redirect

**Files:**
- Create: `src/client/home.ts`
- Modify: `index.html`
- Modify: `tests/shared/session.test.ts` (optional pure helper — prefer testing redirect mapping via a tiny exported function)

**Interfaces:**
- Consumes: `loadRole`, `Role` from `src/client/session.ts`
- Produces:
  - `export const CHOOSE_PARAM = "choose"`
  - `export function redirectTarget(role: Role | null, search: string): "/r" | "/s" | null`
  - `src/client/home.ts` side-effect module that uses `redirectTarget` + `location.replace`

- [ ] **Step 1: Write the failing tests for path mapping**

Add to `tests/shared/session.test.ts` (or a new `tests/shared/home.test.ts` if you prefer isolation — either is fine; this plan uses `tests/client/home.test.ts`):

Create `tests/client/home.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { redirectTarget, CHOOSE_PARAM } from "../../src/client/home";

describe("redirectTarget", () => {
  it("maps receiver to /r and sender to /s", () => {
    expect(redirectTarget("receiver", "")).toBe("/r");
    expect(redirectTarget("sender", "")).toBe("/s");
  });

  it("returns null when no role", () => {
    expect(redirectTarget(null, "")).toBeNull();
  });

  it("stays on the chooser when the choose flag is present", () => {
    expect(redirectTarget("receiver", `?${CHOOSE_PARAM}`)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/home.test.ts -v`

Expected: FAIL — module or export missing.

- [ ] **Step 3: Implement `home.ts` and wire `index.html`**

Create `src/client/home.ts`:

```ts
import { loadRole, type Role } from "./session";

export const CHOOSE_PARAM = "choose";

export function redirectTarget(role: Role | null, search: string): "/r" | "/s" | null {
  if (new URLSearchParams(search).has(CHOOSE_PARAM)) return null;
  if (role === "receiver") return "/r";
  if (role === "sender") return "/s";
  return null;
}

function bootstrap(): void {
  let role: Role | null = null;
  try {
    role = loadRole(window.localStorage);
  } catch {
    // localStorage unavailable — leave the chooser visible.
    return;
  }
  const path = redirectTarget(role, location.search);
  if (path) location.replace(path);
}

if (typeof document !== "undefined") bootstrap();
```

Update `index.html` — keep the existing chooser markup; add the module script before `</body>`:

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
    <script type="module" src="/src/client/home.ts"></script>
  </body>
</html>
```

Use `location.replace` (not `assign`) so Back does not return to the chooser.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/home.test.ts tests/shared/session.test.ts -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/home.ts index.html tests/client/home.test.ts
git commit -m "$(cat <<'EOF'
feat: redirect home to last role when known

EOF
)"
```

---

### Task 3: Record role on `/r` and `/s`, add “Start over” links

**Files:**
- Modify: `src/client/receiver.ts`
- Modify: `src/client/sender.ts`
- Modify: `r/index.html`
- Modify: `s/index.html`

**Interfaces:**
- Consumes: `storeRole` from `src/client/session.ts`
- Produces: pages that persist role on load; a hint link back to the chooser

- [ ] **Step 1: Persist role in receiver and sender**

In `src/client/receiver.ts`, extend the session import and call `storeRole` before resolving the seed (near the bottom bootstrap):

```ts
import { resolveSeed, storeSeed, clearSeed, storeRole } from "./session";
```

At the bottom, immediately after `installErrorCapture(storage);` (or just before `resolveSeed`):

```ts
storeRole(storage, "receiver");
const resolved = resolveSeed(location.hash, storage, "generate")!;
void start(resolved.seed);
```

In `src/client/sender.ts`, extend the session import. Inside `bootstrap()`, right after `const storage = window.localStorage;`:

```ts
import { resolveSeed, storeSeed, storeRole } from "./session";
```

```ts
function bootstrap(): void {
  const storage = window.localStorage;
  storeRole(storage, "sender");
  // ... rest unchanged
}
```

Burn / clear handlers must **not** call anything that clears the role.

- [ ] **Step 2: Add “Start over” links in HTML**

In `r/index.html`, add the link in the feed panel near Diagnostics:

```html
<p class="hint"><a href="/?choose">Start over</a> · <a href="/debug">Diagnostics</a></p>
```

(Replace the existing Diagnostics-only hint paragraph.)

In `s/index.html`, add the link after both sections so it is reachable in either state:

```html
    <section class="panel" id="paired" hidden>
      ...
    </section>
    <section class="panel" id="unpaired">
      ...
    </section>
    <p class="hint"><a href="/?choose">Start over</a></p>
    <script type="module" src="/src/client/sender.ts"></script>
```

- [ ] **Step 3: Typecheck and unit tests**

Run:

```bash
npm run typecheck && npx vitest run tests/shared/session.test.ts tests/client/home.test.ts -v
```

Expected: PASS / no type errors.

- [ ] **Step 4: Manual smoke (dev server)**

Run: `npm run dev`

Then:

1. Open `/` → chooser visible (no role yet).
2. Click “I'm the car” → `/r` shows QR; confirm `localStorage.teslaport:role === "receiver"`.
3. Open `/` again → should land on `/r` without chooser.
4. Click “Start over” → `/?choose` shows the chooser; pick phone → `/s`; open `/` → lands on `/s`.
5. Burn code on `/r` → still on `/r` with new code; open `/` → still `/r`.

- [ ] **Step 5: Commit**

```bash
git add src/client/receiver.ts src/client/sender.ts r/index.html s/index.html
git commit -m "$(cat <<'EOF'
feat: remember role on car/phone pages with switch links

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|---|---|
| Persist `teslaport:role` | Task 1 |
| `/` redirect via `location.replace` | Task 2 |
| Legacy: no role → chooser even if seed exists | Task 2 (`redirectTarget(null, "")`) |
| `/r` / `/s` set role on load | Task 3 |
| “Start over” escape back to the chooser | Task 2 (`redirectTarget`) + Task 3 |
| Burn does not clear role | Task 1 test + Task 3 (no clear) |
| Corrupt role → chooser | Task 1 |
| localStorage throw → chooser | Task 2 try/catch |
| No Worker/crypto changes | All tasks |
| Unit tests for load/store | Task 1 |
| Manual verify redirect loop | Task 3 Step 4 |
