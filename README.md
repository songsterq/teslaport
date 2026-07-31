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

## Search engines

The home page is the only indexable page; `/r`, `/s` and `/debug` carry
`noindex,nofollow` and are deliberately left crawlable so the crawler can read
that tag. `public/` holds `robots.txt`, `sitemap.xml` and the social card,
which vite copies into the build as-is.

The canonical origin is hardcoded, so **changing the domain means editing all
four pages plus `public/`**. `tests/e2e/seo.spec.ts` asserts the current one
and will fail loudly if only some are updated. Regenerate the social card with:

```bash
node tools/og-image.mjs public/og.png
```

## Limits

One pairing per browser profile. The seed occupies a single storage slot, so
opening `/s` with a different code repairs that phone to the new car rather
than remembering both. Pairing several phones to one car works fine — that
direction is unlimited.

After the first deploy, run `docs/in-car-checklist.md` in the car.
