# Contributing to TeslaPort

Thanks for helping. TeslaPort is deliberately small: two device pages, a
WebSocket relay, and cryptography that never leaves the browser. Please keep
changes in that spirit.

## Setup

```bash
npm install
npm run dev        # http://localhost:8787
npm run check      # typecheck + unit + worker + e2e
```

You need a recent Node.js and Playwright browsers once:

```bash
npx playwright install
```

## What belongs where

| Area | Path |
| --- | --- |
| Phone / car / home pages | `index.html`, `s/`, `r/`, `src/client/` |
| Protocol, crypto, framing | `src/shared/` |
| Cloudflare Worker + room Durable Object | `src/worker/` |
| Design notes | `docs/` |

Prefer a design note under `docs/` when a change touches the threat model,
pairing format, or wire protocol.

## Pull requests

1. Open an issue first for large behaviour or protocol changes.
2. Keep the diff focused — one concern per PR.
3. Match the surrounding code style (TypeScript, short comments for non-obvious
   crypto/protocol constraints).
4. Run `npm run check` before opening the PR.
5. Explain *why* in the PR body; point at the relevant design doc when there is
   one.

## Security issues

Do not open a public issue for vulnerabilities. See [SECURITY.md](SECURITY.md).

## Code of conduct

Participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
