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
| `?choose` present in the query | Show the chooser regardless of stored role |
| Role = `receiver` | `location.replace("/r")` |
| Role = `sender` | `location.replace("/s")` |

| Event | Side effect |
|---|---|
| `/r` loads | Persist role `receiver` |
| `/s` loads | Persist role `sender` |
| “Start over” on `/r` or `/s` | Navigate to `/?choose`; no storage is touched until a role is picked |
| Burn code / clear history | Do **not** clear role |

Role switching goes through the chooser, not through direct cross-links between
`/r` and `/s`. Each page carries one quiet “Start over” link to `/?choose`.

`?choose` is what keeps the chooser reachable. Without it, a browser that had
opened `/r` or `/s` even once could never see the chooser again, and the only
way back would be clearing site data — which on the car also destroys the
pairing seed and silently breaks every paired phone.

Direct cross-links (“I'm the phone instead” on the car screen) were rejected:
on a car touchscreen, a stray tap on a hint-level link beside *Diagnostics*
would silently rewrite the persisted role, and the user would discover it only
on some later visit to `/`. “Start over” is inert by comparison — it navigates,
and nothing is persisted until the user actually picks a role.

## Implementation

1. **`session.ts`** — add `ROLE_STORAGE_KEY = "teslaport:role"`, type `Role = "receiver" | "sender"`, and `storeRole` / `loadRole` (missing or corrupt → `null`).
2. **`home.ts` + `index.html`** — on load, unless `?choose` is present, if `loadRole` returns a role, `location.replace` to the matching page; otherwise leave the chooser unchanged.
3. **`receiver.ts` / `sender.ts`** — call `storeRole` at startup for that page’s role.
4. **HTML** — one hint-level “Start over” link to `/?choose` on each of `/r` and `/s`.
5. **Tests** — unit tests for role load/store (valid, missing, corrupt).

No Worker, crypto, envelope, or WebSocket changes.

## Edge cases

| Case | Behavior |
|---|---|
| Corrupt role value | Treat as missing → chooser |
| `localStorage` unavailable / throws | Show chooser; do not crash |
| Back after `replace` to `/r` or `/s` | Does not return to the chooser (intentional); “Start over” is the way back |
| `?choose` with no role stored | Chooser, same as a bare `/` |
| Unrelated query string on `/` (e.g. `?utm_source=…`) | Redirects normally; only `choose` suppresses it |
| Direct `/r` or `/s` | Unchanged; sets role for subsequent `/` visits |
| Seed burned, role remains | `/` still redirects to `/r`; user stays in car flow with a new code |
| Phone vs car devices | Independent `localStorage`; no cross-device coupling |

## Out of scope

- Server-side or cookie-based redirects
- Direct `/r` ↔ `/s` cross-links (superseded by “Start over”)
- User-agent sniffing to detect “in the car”
- Changing seed generation or wipe-recovery (`/r#…` bookmark) behavior
- Clearing role on burn

## Testing

- Unit: `loadRole` / `storeRole` as above; `redirectTarget` across role × query-string combinations.
- End-to-end: `/` redirects after visiting `/r` and after `/s`; a fresh browser sees the chooser; `/?choose` shows the chooser despite a stored role; “Start over” round-trips to a different role.
- Manual: pair on `/r`, return to `/`, confirm replace to `/r`; tap “Start over”, pick phone, return to `/`, confirm replace to `/s`; clear site data, confirm chooser returns.
