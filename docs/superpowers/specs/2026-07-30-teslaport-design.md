# TeslaPort — Design

**Date:** 2026-07-30
**Status:** Approved, ready for implementation planning

## Purpose

Send a URL from a phone to the browser in a Tesla, so it can be tapped and opened on the car screen. Existing tools do this, but route links through third-party servers in plaintext. TeslaPort exists to do it without any server — including its own — ever being able to read the links.

## Hard constraints

These are architectural invariants, not preferences. A future feature that violates one is out of scope by definition.

1. **The server can never read a shared link.** Not "does not log"; cannot decrypt. Any feature requiring server-side knowledge of link contents (page-title fetching, previews, link history sync, search) is permanently excluded.
2. **The server persists nothing.** No database, no key-value store, no Durable Object storage. Link payloads exist on the server only in transit through an open socket.
3. **No third-party services in the request path.** No analytics, no CDN beyond the host, no error-reporting SaaS.

## Non-goals for v1

- Native share-sheet integration (Android Web Share Target, iOS Shortcut). The protocol is designed so this can be added later without changing it.
- Sending anything other than URLs (text notes, files, images).
- Multiple cars or multiple simultaneous senders as an explicit feature. The design tolerates them; it does not optimize for them.
- Any account, login, or user identity.

## User-facing workflow

1. On the car screen, open TeslaPort. It shows a QR code and a typed code, permanently visible.
2. On a phone, scan the QR (or type the code). The phone opens the sender page, already paired.
3. Paste a link, tap Send.
4. The link appears at the top of a list on the car screen. Tap it to open.

Pairing happens once per car. The phone stores the pairing too, so on later trips the phone can open its own bookmark and skip scanning — but scanning the always-visible code works from any phone at any time.

## Architecture

**Cloudflare Workers + one Durable Object per pairing.**

A Durable Object is a globally-unique, single-threaded object addressed by a string. Addressing it by room ID gives an exact rendezvous point for one car/phone pair with no locking, no shared database, and no cross-region consistency problem. It holds the car's open WebSocket and relays blobs to it. WebSocket Hibernation means a parked car with the tab open incurs no duration cost.

Static assets ship from the same Worker. Running cost is $0 on Cloudflare's free tier, plus roughly $10/yr for a domain.

**Alternatives rejected:**

| Option | Why not |
|---|---|
| Workers + KV, phone polls | KV is eventually consistent, up to ~60s propagation. Unusable for a send-and-it-appears flow. |
| Linode VPS running a small Node/Go process | Works, and the DO is only ~150 lines of `Map<roomId, sockets>` logic that would port directly. But it adds patching, TLS renewal, uptime ownership, and single-region latency for no benefit. Keep as the escape hatch, not the plan. |

**Stack:** TypeScript, no UI framework (both pages are small), Vite for the client bundle, Wrangler for deploy, Vitest + `@cloudflare/vitest-pool-workers` for the Worker, Playwright for integration.

## Pairing and cryptography

### One secret, two derived values

The receiver generates a single 100-bit random **seed**. Everything else derives from it:

```
seed       = 100 random bits
roomId     = HKDF-SHA256(seed, info="room")   → sent to the server, used only for routing
contentKey = HKDF-SHA256(seed, info="key")    → AES-256-GCM key, never leaves the browsers
```

The server learns only `roomId`. Because HKDF is one-way, recovering `contentKey` from `roomId` requires brute-forcing 100 bits offline. The server is structurally incapable of reading a link.

100 bits was chosen as the point where the typed fallback stays humane (20 characters) while offline brute force stays firmly infeasible.

### Carrying the seed to the phone

Both transports carry an identical payload:

- **QR code** encodes `https://<host>/s#<seed>`. The fragment is load-bearing: browsers never transmit `#…` in an HTTP request, so the seed reaches the phone's JavaScript without touching the edge. The QR is rendered client-side by a bundled library, so the server sees nothing at pairing time either.
- **Typed fallback**: the same seed as 20 Crockford base32 characters, grouped `K7M29-XQP4R-TB8WN-C3JHF`. Crockford excludes I, L, O, and U and is case-insensitive, removing digit/letter ambiguity on a car screen. This exists for when a camera won't cooperate; QR is the everyday path.

### Message envelope

The sender encrypts `{url, ts}` with AES-256-GCM under `contentKey` using a fresh 96-bit nonce. The wire format is `nonce ‖ ciphertext`, opaque to the server and indistinguishable from noise.

### Hardening

- The receiver validates that the **decrypted** URL has scheme `http:` or `https:` before rendering. Without this, an attacker holding the key could deliver a `javascript:` URL to the car screen.
- Payloads are capped at 8 KB and rate-limited to 30 messages per minute per room, so the relay cannot be repurposed as anonymous storage or a general-purpose tunnel.
- Rendered links carry `rel="noopener noreferrer"` and are never auto-opened.

### Recovering from a wiped car

Tesla's browser clears localStorage more aggressively than a desktop browser (software updates, Clear Browsing Data, profile changes). localStorage is therefore the convenience path, not the source of truth.

The receiver page also accepts the seed in its own fragment — `https://<host>/r#<seed>` — and the first-run UI prompts the user to bookmark exactly that URL. After a wipe, tapping the bookmark restores the pairing, instead of silently generating a fresh code and leaving the user wondering why their phone stopped working.

### Burning a code

Regenerating the seed client-side is the entire operation; there is no server-side room state to delete. Previously paired phones land in a room no receiver ever joins and simply report "Car not connected" — which also leaks less than an explicit revocation message would.

## What the server can still observe

Being honest about the residual leak matters more than claiming none exists. Cloudflare, or anyone with equivalent access, can see:

- **Room IDs** — opaque 100-bit-derived identifiers. They link a car and a phone to each other, and are stable until the code is burned.
- **IP addresses** of both devices, and therefore approximate location and the fact that a given phone and car pair up.
- **Timing and size** — when a send happened and roughly how long the URL was.

It cannot see any URL, page title, or domain. For the stated threat model — third-party profiling of browsing destinations, and server compromise or subpoena — this is the intended outcome. It is not anonymity from the host, and the design does not claim to be.

## Server state

**The Durable Object persists zero bytes.** No `storage.put`, no SQLite. Its entire state is the set of currently-open WebSockets, retrieved via `ctx.getWebSockets()`, which the runtime preserves across hibernation. It is a pure switchboard: a blob arrives on a sender socket, is written to the receiver socket, and is gone.

**Consequence, accepted deliberately: if the car is not connected, the send fails.** There is no offline queue. This matches the real workflow — the user is sitting in the car with the page open — and the sender page knows presence live, so it disables Send *before* the user pastes rather than failing afterward.

Rate-limit counters and the size cap are in-memory only. A counter that resets on DO eviction is a marginally weaker abuse control, and that is the correct trade for zero storage. Cloudflare's edge rate limiting is available at no cost if it ever becomes necessary.

**All persistent state lives on the two clients:**

| Data | Location | Survives car wipe? |
|---|---|---|
| Seed | localStorage on each device | Via the bookmark, yes |
| Received-link history (last 20, plaintext) | Car localStorage only | No — acceptable |

The car UI has a "Clear history" button.

## Runtime behavior

### Connections

Both pages open a WebSocket to `/ws/<roomId>?role=receiver|sender`; the Worker upgrades it and forwards to the DO named by that room ID. The DO relays **sender → receiver only**. It never relays receiver → sender or sender → sender, so a second phone cannot spam the first.

### Presence drives the sender UX

When a receiver socket opens or closes, the DO pushes a presence event to every connected sender. The phone always shows one of three honest states:

- **Car connected** — Send enabled
- **Car not connected** — Send disabled, with "Open TeslaPort on the car screen"
- **Reconnecting…** — the phone's own socket is down

### Acknowledged sends

Each send carries a message ID. The DO replies `delivered` once the blob is written to a receiver socket, or `no-receiver` if none is present. The phone shows a checkmark on delivery and retains the text in the box on failure, so nothing is silently lost.

### Reconnection

Drops are normal: parked cars sleep, phones change networks, Cloudflare recycles connections. Both clients auto-reconnect with jittered exponential backoff (1s → 30s) and reconnect immediately on `visibilitychange` to visible, so the car resumes the moment the screen wakes rather than after a pending backoff timer. A live status dot sits next to the QR; the car never shows a dead connection without saying so.

### Failure modes

| Condition | Behavior |
|---|---|
| Decryption fails (wrong key, garbage, tampering) | Silently dropped, counter incremented on `/debug`. Never rendered. |
| Decrypted payload is not `http:` or `https:` | Dropped, counter incremented |
| Payload > 8 KB, or rate limit exceeded | DO rejects; sender shows an explicit error |
| Car localStorage wiped | `/r` finds no seed, shows first-run pairing screen; bookmark restores |
| `/s` opened with no fragment and no stored seed | "Scan the code on your car screen" — no half-paired state |

## Tesla browser constraints

The car browser is the highest-risk surface: Chromium of an unknown vintage, with **no developer tools**. Nothing can be inspected, no console read, no breakpoint set. Two decisions follow.

**`/debug` is a first-class deliverable.** It renders on screen, in large text: user agent; live round-trip tests (not feature sniffing) for `crypto.subtle`, `WebSocket`, and `localStorage`; current connection state; seed presence; drop counters; and a rolling log of recent errors. In the car, this is the only diagnostic channel that exists.

**Conservative output.** Target ES2019, no top-level await, no exotic APIs, polyfill-free but unadventurous. `crypto.subtle` requires a secure context, satisfied by HTTPS.

**UI.** Dark theme, high contrast, large touch targets. The screen is bright, large, fingertip-operated, and often used at night.

## Module structure

| Module | Responsibility | Depends on |
|---|---|---|
| `shared/pairing.ts` | Seed generation, Crockford base32 encode/decode, HKDF derivation | WebCrypto |
| `shared/envelope.ts` | Encrypt, decrypt, validate message payloads | WebCrypto |
| `shared/socket.ts` | Reconnecting WebSocket client | — |
| `worker/room.ts` | Durable Object switchboard | — |
| `worker/index.ts` | Routing, WS upgrade, static assets | `worker/room.ts` |
| `client/receiver.ts` | Car UI, QR render, history store | `shared/*` |
| `client/sender.ts` | Phone UI, paste and send | `shared/*` |
| `client/debug.ts` | Diagnostics page | `shared/*` |

`shared/pairing.ts` and `shared/envelope.ts` are pure functions over bytes. They carry the densest tests: a bug there is both most likely and most costly.

## Testing

- **Unit** — base32 round-trips including case-insensitivity and rejection of excluded letters; HKDF derivation vectors; encrypt/decrypt round-trip; tamper detection (a flipped ciphertext bit must fail authentication); URL-scheme rejection.
- **Worker** — `@cloudflare/vitest-pool-workers` against the real Durable Object: relay correctness, role isolation (sender→sender must not relay), presence events on connect and disconnect, size cap, rate limit.
- **Integration** — Playwright with two browser contexts (car and phone) covering pair → send → render, and a disconnect/reconnect cycle.
- **Manual** — a short in-car checklist, since nothing above proves the real Tesla browser works.

## Open items for the implementation plan

- Domain name selection and DNS setup.
- Choice of bundled QR library (must be small, dependency-free, and client-side).
- Exact wire encoding of the envelope (base64 over a text frame vs. binary frame).
