# SEO — design

Target keyword: **Tesla link sharing**. Canonical origin:
`https://teslaport.endlessrainstudio.com`.

The site is four static pages behind a Worker. Only one of them — the home
page — is a document a searcher should ever land on. `/r`, `/s` and `/debug`
are application surfaces: thin, stateful, and meaningless without a pairing.
The whole design follows from that split.

## Indexing policy

The home page is indexable and carries every signal. The three app pages carry
`noindex,nofollow` and a self-referencing canonical.

`robots.txt` allows all crawling and does nothing but name the sitemap. It
deliberately does **not** `Disallow: /r`. A disallowed URL cannot be fetched,
so the crawler never reads the `noindex` on it, and the URL remains eligible to
appear as a bare, untitled result. Crawl-and-noindex is the combination that
actually removes a page; disallow-only is the combination that strands it.

## Static files

A new `public/` directory. Vite's default `publicDir` is `public`, so its
contents are copied to `dist/client` verbatim with no config change.

- `public/robots.txt` — allow-all plus `Sitemap:` line.
- `public/sitemap.xml` — one `<url>`, the home page. The app pages are noindex
  and do not belong in a sitemap.
- `public/og.png` — 1200×630 social card, rendered once from the existing brand
  mark with sharp and committed as a binary. sharp is not added to
  `package.json`; it is a one-time authoring tool, not a build step.

These land at the origin root, so they are matched by `run_worker_first`'s
`/*` and served through the Worker. That is correct and cheap: three small
files, and the security headers apply uniformly.

## Head metadata

Home page:

| Tag | Value |
| --- | --- |
| `<title>` | `TeslaPort — Tesla Link Sharing From Phone to Car Browser` |
| `description` | Leads with the keyword, ~150 chars. |
| `canonical` | `https://teslaport.endlessrainstudio.com/` |
| `robots` | `index,follow,max-image-preview:large` |
| `og:type` / `og:site_name` / `og:title` / `og:description` / `og:url` / `og:image` | Set; image is the absolute URL of `og.png`. |
| `twitter:card` | `summary_large_image` |

`/r`, `/s`, `/debug`: `robots` set to `noindex,nofollow`, plus a
self-referencing canonical. Their titles stay short — they are read on a car
screen at arm's length, and title length is not a ranking factor for a page
that is not in the index.

## Structured data

Two inline JSON-LD blocks on the home page: `SoftwareApplication` (name,
description, `applicationCategory: UtilitiesApplication`, a free `offers`
node) and `FAQPage` mirroring the on-page FAQ verbatim. Marking up an answer
that does not appear on the page is a structured-data violation, so the two
must stay in sync; keeping them adjacent in the same file is the mechanism.

**Open risk, to be measured, not assumed.** The CSP is `script-src 'self'`
with no `'unsafe-inline'`. Browsers are expected to treat
`<script type="application/ld+json">` as a data block outside the reach of
`script-src`, but this project's convention is to measure such claims. Build,
load the home page against the real Worker, and read the console. If the block
is reported as a CSP violation, add a `'sha256-…'` source for that specific
block. Do not add `'unsafe-inline'` — the CSP's job here is to stop an injected
script from exfiltrating decrypted links, and a blanket inline allowance
retires that guarantee for a search-engine nicety.

## On-page copy

Keyword placement is limited to positions where it reads naturally. No density
targets.

- `h1` → `Tesla link sharing` with the existing `.accent` span carrying
  `from your phone to your car screen.` The two-tone treatment is preserved.
- `.eyebrow` → `Tesla link sharing · encrypted relay`.
- Section headings reworded to carry variants ("send links to your Tesla's
  browser", "share a link with your car") rather than repeating the exact
  phrase.

A new FAQ `<section class="section">` before the footer, using the existing
`.cards` / `.card` markup so no CSS is added. Six questions chosen for
long-tail intent:

1. What is Tesla link sharing?
2. How do I send a link from my phone to my Tesla?
3. Do I need an app or a Tesla account?
4. Does this work with Tesla's built-in browser?
5. Is sharing a link to my Tesla private?
6. Which Tesla models does this work with?

Answers are short and factual, and must not claim more than the app does —
question 6 in particular says "any Tesla whose touchscreen has the web
browser", because nothing here has been tested across model years.

## Tests

Added to the Playwright suite:

- Home page: has a canonical pointing at the production origin, has no
  `noindex`, has a non-empty `og:image`.
- `/r`, `/s`, `/debug`: each carries `noindex`.
- `robots.txt` and `sitemap.xml`: 200, correct content type, sitemap names the
  home URL.
- Every `application/ld+json` block on the home page parses as JSON and has an
  `@context` of `https://schema.org`.

## Out of scope

Separate keyword landing pages (`/tesla-link-sharing`, a how-to guide). One
page with real content outranks several thin ones for a term this narrow, and
each extra page is a maintenance surface. Revisit only if the home page ranks
and the term proves to have volume worth splitting.
