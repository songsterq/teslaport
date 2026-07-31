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

The receiver generates a single 15-byte random **seed**. Everything else derives from it.

All parameters below are normative — the unit tests assert against them, and any deviation breaks interoperability between the two pages.

```
seed        = 15 random bytes (120 bits), crypto.getRandomValues

HKDF        = HKDF-SHA256  (RFC 5869)
  salt      = empty (zero-length, the RFC 5869 default)
  IKM       = the 15 seed bytes
  roomId    = HKDF(info="teslaport:room:v1", L=16 bytes)
              → base64url, unpadded, 22 chars. Sent to the server; routing only.
  contentKey= HKDF(info="teslaport:key:v1",  L=32 bytes)
              → AES-256-GCM key. Never leaves the browsers.
```

The server learns only `roomId`. Because HKDF is one-way, recovering `contentKey` from `roomId` requires brute-forcing 120 bits offline. The server is structurally incapable of reading a link.

**Why these choices.** 120 bits is byte-aligned and encodes to exactly 24 Crockford base32 characters, so the encoder needs no padding rules — padding rules in a hand-written base32 codec are a reliable source of bugs. The `info` strings carry a `:v1` suffix so a future scheme change can be introduced without altering the URL layout.

### Carrying the seed to the phone

Both transports carry the **identical string**: the seed as 24 Crockford base32 characters. Crockford excludes I, L, O, and U and is case-insensitive, removing digit/letter ambiguity on a car screen.

- **QR code** encodes `https://<host>/s#K7M29XQP4RTB8WNC3JHFG2PQ` — the fragment is the bare 24-character string, dashes stripped. The fragment is load-bearing: browsers never transmit `#…` in an HTTP request, so the seed reaches the phone's JavaScript without touching the edge. The QR is rendered client-side by a bundled library, so the server sees nothing at pairing time either.
- **Typed fallback** displays the same 24 characters grouped 4×6 for legibility: `K7M29X-QP4RTB-8WNC3J-HFG2PQ`. Dashes are display-only; the decoder strips them. This path exists for when a camera won't cooperate — QR is the everyday path.

Because both transports carry one string through one encoder, the same tests cover both.

### Message envelope

```
AES-256-GCM
  key       = contentKey
  nonce     = 96-bit, crypto.getRandomValues, fresh per message
  tag       = 128-bit (WebCrypto default)
  AAD       = the 16 roomId bytes
  wire      = nonce ‖ ciphertext, sent as a binary WebSocket frame
```

Random 96-bit nonces are safe at this volume: the birthday bound is roughly 2³² messages under a single key, and this application will send thousands over its lifetime. AAD binding to `roomId` is strictly redundant given per-room keys, but it costs nothing and forecloses cross-room splicing becoming possible through some later change.

The plaintext is a tagged JSON payload, flowing in **both** directions:

```
url frame:  { t: "url", id, url, ts }
ack frame:  { t: "ack", id }
```

`id` is a random 128-bit message identifier and `ts` is the sender's clock in epoch milliseconds. **Both live inside the authenticated plaintext, never in a wire header** — otherwise the server could rewrite them and defeat the replay defenses below.

### End-to-end delivery acknowledgement

The receiver emits an `ack` frame, encrypted under the same `contentKey`, once it has decrypted a `url` frame, accepted it, and rendered it. Because the ack is authenticated, only a genuine key-holder can produce one: this is an *unforgeable* delivery signal, not merely an end-to-end one.

This exists because server-attested delivery reports success for a set of failures the car detects but the server cannot see. Note that a *key mismatch* is not among them: `roomId` and `contentKey` derive from the same seed, so two honest clients sharing a room necessarily share a key. The failures that do occur are:

- **Clock skew** pushing `ts` outside the freshness window (see below) — the most likely of these, and completely invisible otherwise
- **Replay-dedupe rejection** of a repeated `id`
- **A keyless receiver squatting the room** — under fan-out (below) the car is not guaranteed to be the only listener, so "relayed to someone" is not "the car has it"
- **A malformed or hostile frame**, or a client-side crash after receipt

The sender therefore distinguishes three outcomes:

| Outcome | Sender shows |
|---|---|
| `no-receiver` from the DO | "Car not connected" |
| Relayed, but no valid ack within 3s | "The car received it but didn't accept it — open /debug on the car screen." |
| Valid `ack` for the message `id` | ✓ Sent |

Only the third clears the text box. Acks are deduplicated by `id`; the first valid one wins, so multiple legitimate car tabs do not confuse the sender.

### Replay defense

Anyone on the socket path can re-inject a previously seen `nonce ‖ ciphertext`; it will decrypt correctly, because it is genuine. Two checks, both required:

- Reject if `|now − ts| > 5 minutes` — bounds the window in which a replay is possible at all.
- Reject if `id` is already in the receiver's recent-ID set (last 200 ids, in car localStorage) — eliminates replay *within* that window.

**Residual hole, accepted:** a localStorage wipe clears the seen-ID set, leaving a 5-minute window in which a captured message could be replayed once. The consequence is a duplicate link appearing on screen.

This makes clock skew a real failure mode, so `/debug` displays the observed delta between sender `ts` and receiver `now`. Without developer tools in the car, a silent "nothing arrives" caused by a wrong clock would otherwise be undiagnosable.

### Hardening

- The receiver validates that the **decrypted** URL has scheme `http:` or `https:` before rendering. Without this, an attacker holding the key could deliver a `javascript:` URL to the car screen. A rejected frame is never acked.
- Payloads are capped at 8 KB and rate-limited to 30 messages per minute **per socket, in both roles**, so the relay cannot be repurposed as anonymous storage or a general-purpose tunnel, and a rogue receiver cannot flood senders with ack frames.
- Rendered links carry `rel="noopener noreferrer"` and are never auto-opened.

### Recovering from a wiped car

Tesla's browser clears localStorage more aggressively than a desktop browser (software updates, Clear Browsing Data, profile changes). localStorage is therefore the convenience path, not the source of truth.

The receiver page also accepts the seed in its own fragment — `https://<host>/r#<seed>` — and the first-run UI prompts the user to bookmark exactly that URL. After a wipe, tapping the bookmark restores the pairing, instead of silently generating a fresh code and leaving the user wondering why their phone stopped working.

### Burning a code

Regenerating the seed client-side is the entire operation; there is no server-side room state to delete. Previously paired phones land in a room no receiver ever joins and simply report "Car not connected" — which also leaks less than an explicit revocation message would.

## What the server can still observe

Being honest about the residual leak matters more than claiming none exists. Cloudflare, or anyone with equivalent access, can see:

- **Room IDs** — opaque identifiers derived from the seed. They link a car and a phone to each other, and are stable until the code is burned.
- **IP addresses** of both devices, and therefore approximate location and the fact that a given phone and car pair up.
- **Timing and size** — when a send happened and roughly how long the URL was.

It cannot see any URL, page title, or domain. For the stated threat model — third-party profiling of browsing destinations, and server compromise or subpoena — this is the intended outcome. It is not anonymity from the host, and the design does not claim to be.

**What the host could actively do.** Two limits are worth stating rather than discovering later:

- **Presence and `no-receiver` are server-attested, and therefore untrusted.** A compromised host can claim the car is connected when it isn't, or vice versa. These drive UX only. The encrypted `ack` is the sole trustworthy delivery signal, because forging it requires `contentKey`.
- **Availability is not protected.** A compromised host can silently drop messages, and nothing at this cost level changes that. Confidentiality and integrity are protected; delivery is not.

A host that knows a `roomId` — from its own logs — can also connect as a receiver and observe ciphertext, timing, and size. It cannot decrypt, and under the fan-out rule below it cannot displace the car.

## Server state

**The Durable Object persists zero bytes.** No `storage.put`, no SQLite. Its entire state is the set of currently-open WebSockets, retrieved via `ctx.getWebSockets()`, which the runtime preserves across hibernation. It is a pure switchboard: a blob arrives on a socket, is written to the sockets of the opposite role, and is gone.

**Consequence, accepted deliberately: if the car is not connected, the send fails.** There is no offline queue. This matches the real workflow — the user is sitting in the car with the page open — and the sender page knows presence live, so it disables Send *before* the user pastes rather than failing afterward.

Rate-limit counters and the size cap are in-memory only, tracked per socket. A counter that resets on DO eviction is a marginally weaker abuse control, and that is the correct trade for zero storage. Cloudflare's edge rate limiting is available at no cost if it ever becomes necessary.

**All persistent state lives on the two clients:**

| Data | Location | Survives car wipe? |
|---|---|---|
| Seed | localStorage on each device | Via the bookmark, yes |
| Received-link history (last 20, plaintext) | Car localStorage only | No — acceptable |
| Recent message-ID set (last 200, replay defense) | Car localStorage only | No — see the residual hole above |

The car UI has a "Clear history" button.

## Runtime behavior

### Connections

Both pages open a WebSocket to `/ws/<roomId>?role=receiver|sender`; the Worker upgrades it and forwards to the DO named by that room ID.

**The relay invariant is cross-role fan-out.** A binary frame from a socket is delivered to *every* socket of the opposite role, and to none of the same role:

- sender → all receivers (a link)
- receiver → all senders (an ack)
- **never** sender → sender or receiver → receiver

The same-role prohibition is the property that matters: a second phone cannot spam the first, and a second car tab cannot spam the first. Allowing the reverse direction is what makes the end-to-end ack possible, and it does not weaken that guarantee.

### Multiple receivers: fan-out, and why the alternatives are unsafe

Two tabs can legitimately connect as receivers — a bookmark plus a fresh tab, or a phone opening `/r` to test. The rule must also survive a hostile third party who has learned a `roomId` from logs or a URL, since connecting as a receiver requires no key.

| Rule | Effect of an attacker holding only `roomId` |
|---|---|
| Reject the second receiver | Attacker connects first and **locks the car out permanently** |
| Last-writer-wins | Attacker connects at any time and **displaces the car** |
| **Fan-out (chosen)** | Attacker receives ciphertext it cannot decrypt. **No effect on the car.** |

Fan-out is the only rule under which knowledge of a `roomId` — which is not secret from the host — cannot deny service. The attacker gains timing and size metadata that a passive observer of the socket path already has, and gains nothing else.

The consequence is that **presence becomes advisory and the ack becomes truth.** "Two screens connected" is a fuzzy signal that includes any squatter; "a key-holder accepted message `id`" is not.

### Presence drives the sender UX

When a receiver socket opens or closes, the DO pushes a presence event to every connected sender. The phone always shows one of three states:

- **Car connected** — Send enabled
- **Car not connected** — Send disabled, with "Open TeslaPort on the car screen"
- **Reconnecting…** — the phone's own socket is down

Presence exists to disable Send *before* the user pastes rather than failing afterward. It is server-attested and therefore advisory; see the threat-model notes above.

### Acknowledged sends

The DO emits exactly one control message, `no-receiver`, when a sender's frame has no receiver to fan out to. There is no server-attested `delivered` — it would report success for failures the server cannot observe, so the end-to-end `ack` frame subsumes it entirely.

The phone clears the text box only on a valid `ack` for that message's `id`. Anything else leaves the text in place, so nothing is silently lost. The three outcomes and their wording are specified under "End-to-end delivery acknowledgement" above.

### Reconnection

Drops are normal: parked cars sleep, phones change networks, Cloudflare recycles connections. Both clients auto-reconnect with jittered exponential backoff (1s → 30s) and reconnect immediately on `visibilitychange` to visible, so the car resumes the moment the screen wakes rather than after a pending backoff timer. A live status dot sits next to the QR; the car never shows a dead connection without saying so.

### Failure modes

| Condition | Behavior |
|---|---|
| Decryption fails (garbage, tampering, squatter traffic) | Dropped, not acked, counter incremented on `/debug`. Never rendered. |
| Decrypted payload is not `http:` or `https:` | Dropped, not acked, counter incremented |
| `ts` outside the ±5 minute window | Dropped, not acked, counter incremented. `/debug` shows the observed clock delta. |
| `id` already in the recent-ID set | Dropped as a replay, not acked, counter incremented |
| Relayed but no ack within 3s | Sender: "The car received it but didn't accept it — open /debug on the car screen." Text retained. |
| Payload > 8 KB, or rate limit exceeded | DO rejects; sender shows an explicit error |
| Car localStorage wiped | `/r` finds no seed, shows first-run pairing screen; bookmark restores |
| `/s` opened with no fragment and no stored seed | "Scan the code on your car screen" — no half-paired state |

## Tesla browser constraints

The car browser is the highest-risk surface: Chromium of an unknown vintage, with **no developer tools**. Nothing can be inspected, no console read, no breakpoint set. Two decisions follow.

**`/debug` is a first-class deliverable.** It renders on screen, in large text: user agent; live round-trip tests (not feature sniffing) for `crypto.subtle`, `WebSocket`, and `localStorage`; current connection state; seed presence; the observed clock delta between the last sender `ts` and local time; per-reason drop counters (decrypt failure, bad scheme, stale `ts`, replayed `id`); and a rolling log of recent errors. In the car, this is the only diagnostic channel that exists, and every "nothing arrived" report resolves here.

**Conservative output.** Target ES2019, no top-level await, no exotic APIs, polyfill-free but unadventurous. `crypto.subtle` requires a secure context, satisfied by HTTPS.

**UI.** Dark theme, high contrast, large touch targets. The screen is bright, large, fingertip-operated, and often used at night.

## Module structure

| Module | Responsibility | Depends on |
|---|---|---|
| `shared/pairing.ts` | Seed generation, Crockford base32 encode/decode, HKDF derivation | WebCrypto |
| `shared/envelope.ts` | Encrypt, decrypt, validate payloads; freshness and replay checks | WebCrypto |
| `shared/socket.ts` | Reconnecting WebSocket client | — |
| `worker/room.ts` | Durable Object switchboard | — |
| `worker/index.ts` | Routing, WS upgrade, static assets | `worker/room.ts` |
| `client/receiver.ts` | Car UI, QR render, history store | `shared/*` |
| `client/sender.ts` | Phone UI, paste and send | `shared/*` |
| `client/debug.ts` | Diagnostics page | `shared/*` |

`shared/pairing.ts` and `shared/envelope.ts` are pure functions over bytes. They carry the densest tests: a bug there is both most likely and most costly.

## Testing

- **Unit** — base32 round-trips including case-insensitivity, dash stripping, and rejection of excluded letters; frozen HKDF vectors pinning `info` strings, salt, and output lengths, so a derivation change cannot land silently; encrypt/decrypt round-trip; tamper detection (a flipped ciphertext bit must fail authentication); AAD mismatch rejection; URL-scheme rejection; stale-`ts` rejection at the window boundary; replayed-`id` rejection.
- **Worker** — `@cloudflare/vitest-pool-workers` against the real Durable Object: cross-role fan-out to multiple receivers; the same-role prohibition in both directions (sender→sender and receiver→receiver must not relay); ack path receiver→sender; presence events on connect and disconnect; `no-receiver` when a room has none; size cap; per-socket rate limit in both roles.
- **Integration** — Playwright with two browser contexts (car and phone) covering pair → send → render → ack, a disconnect/reconnect cycle, and a third context connecting as an unkeyed receiver to prove it neither displaces the car nor produces an ack.
- **Manual** — a short in-car checklist, since nothing above proves the real Tesla browser works.

## Open items for the implementation plan

- Domain name selection and DNS setup.
- Choice of bundled QR library (must be small, dependency-free, and client-side).
