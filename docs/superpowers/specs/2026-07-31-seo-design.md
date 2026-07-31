# SEO — design

Target keyword: **Tesla link sharing**.

> **Amended after implementation.** The canonical origin was first hardcoded
> as `https://teslaport.endlessrainstudio.com` in each page and in
> `public/robots.txt` / `public/sitemap.xml`. It is now derived from the
> request host by the Worker; no domain appears in the source. The sections
> below reflect the amended design, and "Deriving the origin" records what
> changed and why.

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

## Deriving the origin

Canonical and Open Graph URLs have to be absolute, and `robots.txt` and
`sitemap.xml` have to name the site's own origin. Writing that origin into the
source put the same domain in six files and made a domain move a six-file edit
that would half-apply. The Worker supplies it instead, from `new URL(request.url)`:

- `<link rel="canonical">` is **injected** into `<head>`, not rewritten in
  place. Vite's HTML plugin resolves every `<link href>` as a build asset, so
  an authored `href="/s"` is read as a file path, finds the `s/` directory and
  fails the build with `EISDIR`. `<meta>` is not treated that way, so the
  `og:` URLs can stay in the markup and merely have their origin filled in.
- The canonical path is `url.pathname`, so a query string cannot mint a second
  URL for the same page — `/?choose` is canonical to `/`. Trailing slashes are
  already normalised by `drop-trailing-slash` before the Worker sees them.
- `robots.txt` and `sitemap.xml` are generated in the Worker rather than served
  from `public/`, because both must state the origin absolutely.
- `Content-Length` is dropped when the document is rewritten. The upstream
  asset response describes the un-rewritten body, and a stale value truncates
  the page at the browser — at the end, which is where the JSON-LD sits.

The cost of this is that every hostname reaching the Worker claims to be the
canonical one. That includes the `workers.dev` hostname assigned on the first
deploy, which under the old hardcoded scheme correctly pointed at the real
domain and now self-canonicalises into an indexable duplicate. Nothing in the
Worker knows which domain is real, so rather than reintroduce a configured one,
responses on `*.workers.dev` carry `X-Robots-Tag: noindex`. A second *real*
domain would still split the ranking and is a deployment decision, not
something this design can detect.

## Static files

A new `public/` directory. Vite's default `publicDir` is `public`, so its
contents are copied to `dist/client` verbatim with no config change. It holds
one file:

- `public/og.png` — 1200×630 social card, rendered once from the existing brand
  mark with sharp and committed as a binary. sharp is not added to
  `package.json`; it is a one-time authoring tool, not a build step.

## Head metadata

Home page:

| Tag | Value |
| --- | --- |
| `<title>` | `TeslaPort — Tesla Link Sharing From Phone to Car Browser` |
| `description` | Leads with the keyword, ~150 chars. |
| `canonical` | Injected by the Worker as `<origin>/`. |
| `robots` | `index,follow,max-image-preview:large` |
| `og:type` / `og:site_name` / `og:title` / `og:description` / `og:url` / `og:image` | Set; the two URLs are authored root-relative and absolutised by the Worker. |
| `twitter:card` | `summary_large_image` |

`/r`, `/s`, `/debug`: `robots` set to `noindex,nofollow`. Their titles stay
short — they are read on a car screen at arm's length, and title length is not
a ranking factor for a page that is not in the index.

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

No test names a production domain; each derives the expected origin from the
response it got, which is the property under test.

Playwright, against the real wrangler dev server:

- Home page: canonical, `og:url` and `og:image` all absolute on the serving
  origin; no `noindex`; title ≤ 60 chars and description ≤ 160.
- The canonical origin follows the host — the same server fetched as
  `localhost` and as `127.0.0.1` yields different canonicals.
- The rewritten document is not truncated: any `Content-Length` matches the
  body, and the document ends with `</html>`.
- `/r`, `/s`, `/debug`: each carries `noindex`.
- `og.png` is served, and its PNG `IHDR` dimensions match what the `og:image`
  meta tags claim.
- The FAQ JSON-LD matches the on-page FAQ character for character.
- Both `ld+json` blocks parse with an `@context` of `https://schema.org`, and
  neither reports a `script-src` violation.

Vitest against the Worker, where `robots.txt`, `sitemap.xml` and the
preview-host rule are decided before the asset server is reached:

- Both files name the requesting host, and follow a different host with no
  redeploy.
- `robots.txt` does not `Disallow` the noindexed pages.
- `*.workers.dev` responses carry `X-Robots-Tag: noindex`; a real domain does
  not, and neither does a domain that merely contains the string.

## Out of scope

Separate keyword landing pages (`/tesla-link-sharing`, a how-to guide). One
page with real content outranks several thin ones for a term this narrow, and
each extra page is a maintenance surface. Revisit only if the home page ranks
and the term proves to have volume worth splitting.
