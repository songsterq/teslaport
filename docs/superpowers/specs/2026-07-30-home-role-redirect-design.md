# Home role redirect — Design

**Date:** 2026-07-30
**Status:** Approved

## Purpose

Visiting `/` from the car after a pairing already exists still shows the role chooser (“I'm the car — show my code”). That step is redundant. `/` should resume the last role this browser used.

## Relationship to existing design

Compatible with hard constraints in `2026-07-30-teslaport-design.md`: detection and redirect are client-side only; the server never learns the role; no new persistence on the Worker.

Aligns with the intended car workflow (“open TeslaPort → see QR”), which treated the chooser as incidental, not primary.

### Assumption addressed

Car and phone share `teslaport:seed`. Seed presence alone cannot distinguish roles. This design stores an explicit last role instead of inferring from the seed.

## Behavior

| Visit `/` | Result |
|---|---|
| No valid `teslaport:role` | Show the existing static chooser (even if a seed is already stored — preserves legacy devices until the user picks once) |
| Role = `receiver` | `location.replace("/r")` |
| Role = `sender` | `location.replace("/s")` |

| Event | Side effect |
|---|---|
| `/r` loads | Persist role `receiver` |
| `/s` loads | Persist role `sender` |
| Cross-link on `/r` → `/s` | Navigation; `/s` sets `sender` |
| Cross-link on `/s` → `/r` | Navigation; `/r` sets `receiver` |
| Burn code / clear history | Do **not** clear role |

Role switching on the same browser uses quiet cross-links on `/r` and `/s` (“I'm the phone instead” / “I'm the car instead”). There is no `/?choose` escape; once a role exists, `/` always redirects.

## Implementation

1. **`session.ts`** — add `ROLE_STORAGE_KEY = "teslaport:role"`, type `Role = "receiver" | "sender"`, and `storeRole` / `loadRole` (missing or corrupt → `null`).
2. **`home.ts` + `index.html`** — on load, if `loadRole` returns a role, `location.replace` to the matching page; otherwise leave the chooser unchanged.
3. **`receiver.ts` / `sender.ts`** — call `storeRole` at startup for that page’s role.
4. **HTML** — one hint-level cross-link on each of `/r` and `/s`.
5. **Tests** — unit tests for role load/store (valid, missing, corrupt).

No Worker, crypto, envelope, or WebSocket changes.

## Edge cases

| Case | Behavior |
|---|---|
| Corrupt role value | Treat as missing → chooser |
| `localStorage` unavailable / throws | Show chooser; do not crash |
| Back after `replace` to `/r` or `/s` | Does not return to the chooser (intentional) |
| Direct `/r` or `/s` | Unchanged; sets role for subsequent `/` visits |
| Seed burned, role remains | `/` still redirects to `/r`; user stays in car flow with a new code |
| Phone vs car devices | Independent `localStorage`; no cross-device coupling |

## Out of scope

- Server-side or cookie-based redirects
- User-agent sniffing to detect “in the car”
- Changing seed generation or wipe-recovery (`/r#…` bookmark) behavior
- Clearing role on burn

## Testing

- Unit: `loadRole` / `storeRole` as above.
- Manual: pair on `/r`, return to `/`, confirm replace to `/r`; use cross-link to `/s`, return to `/`, confirm replace to `/s`; clear site data, confirm chooser returns.
