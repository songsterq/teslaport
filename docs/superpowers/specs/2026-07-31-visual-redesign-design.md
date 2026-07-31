# TeslaPort visual redesign

Date: 2026-07-31

Redesign `/`, `/r` and `/s` around a coherent visual identity, and turn `/`
into a compact landing page whose two role buttons are reachable without
scrolling.

`https://rowalong.endlessrainstudio.com/` is the aesthetic reference: a
near-black canvas, one saturated accent, heavy tight display type against
light body type, uppercase letterspaced eyebrows, numbered feature cards, and
a sticky header carrying a mark and wordmark on the left with a single action
on the right.

## Constraints

These come from the codebase, not from taste, and every decision below bends
to them.

**The Content Security Policy forbids third-party assets.**
`contentSecurityPolicy` in `src/worker/index.ts` emits `default-src 'none'`
with `style-src 'self'`, `img-src 'self' data:`, and no `font-src` directive at
all. Google Fonts and hotlinked images are therefore unreachable. The redesign
adds no external request and leaves the policy untouched.

**The car runs Chromium of unknown vintage.** The reference expresses its
palette in `oklch()`, which reached Chrome only in version 111. This redesign
uses hex and `rgba()` throughout. For the same reason it avoids `:has()`,
container queries, and nesting.

**The end-to-end tests pin the DOM.** `tests/e2e/pairing.spec.ts` and
`tests/e2e/storage-blocked.spec.ts` assert element ids, exact status strings,
and two accessible link names. The redesign is markup and CSS only; no
TypeScript changes. The contract preserved is:

- ids on `/r`: `qr`, `code`, `dot`, `status`, `hint`, `bookmark`, `links`,
  `empty`, `burn`, `clear`
- ids on `/s`: `paired`, `unpaired`, `dot`, `status`, `url`, `send`, `msg`,
  `manual`, `pair`, `pairmsg`
- `ul#links` keeps its tag-plus-id shape, and its anchors' text content stays
  *exactly* the URL — `toHaveText` compares the whole string, so no label,
  domain, or timestamp may live inside the anchor
- `/` keeps a link whose accessible name matches `/car/i` and another
  matching `/phone/i`
- `/debug` keeps `dt`/`dd` pairs and `#log`

## Design system

Rewritten in `src/client/app.css`, which all four pages already share.

### Tokens

```
--bg          #0b0d10        page canvas
--bg-2        #14171d        panels
--bg-3        #1b1f27        raised surfaces: inputs, link cards
--fg          #f5f8fa
--fg-mut      #a8b3c1        body copy
--fg-dim      #6f7c8c        eyebrows, meta
--line        rgba(255,255,255,.09)
--line-2      rgba(255,255,255,.16)
--accent      #3ddad7
--accent-soft rgba(61,218,215,.12)
--on-accent   #04211f
--ok          #3ddc84
--warn        #ffb020
--bad         #ff5d5d
--maxw        1100px
--pad         clamp(20px, 5vw, 56px)
--ease        cubic-bezier(.16, 1, .3, 1)
```

The accent is cyan rather than the reference's orange: it reads as energy and
transit rather than warmth, it separates TeslaPort from another studio's
identity, and it holds contrast on a large dark display at night. `--ok`,
`--warn` and `--bad` carry over unchanged from the current stylesheet, so the
connection dot keeps its established meanings.

### Type

No web fonts, so the scale does the work the reference gets from Saira.

- **Display** — `system-ui` stack, weight 800, `letter-spacing: -.03em`,
  `line-height: .98`, `clamp(38px, 7vw, 68px)`. Heavy and tight is what
  carries the reference's character without its typeface.
- **Section heading** — weight 700, `-.02em`, `clamp(24px, 3.4vw, 36px)`.
- **Eyebrow** — 12px, weight 600, uppercase, `letter-spacing: .18em`,
  `--fg-dim`. Renders identically in any font, so it transfers intact.
- **Body** — 17px/1.6, `--fg-mut`.
- **Mono** — `ui-monospace, SFMono-Regular, Menlo, monospace` for the pairing
  code, received URLs, and step numerals.

### The mark

A ring broken at left and right with a chevron passing through it: a gate
standing open, something moving across. On a 64-unit viewBox, centre (32,32),
radius 23, with gaps spanning 40° centred on the horizontal axis. The arcs are
written as explicit paths rather than a dashed circle so the gaps land exactly
on the axis instead of depending on circumference arithmetic:

```svg
<svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
  <path d="M53.61 24.13 A23 23 0 0 0 10.39 24.13"
        stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
  <path d="M10.39 39.87 A23 23 0 0 0 53.61 39.87"
        stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
  <path d="M22 20 L40 32 L22 44" stroke-width="6"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

The arcs take `--accent`, the chevron takes `--fg`. The same geometry appears
three times at three scales — 20px in the header, blown up as the hero portal
on `/`, and as the ring framing the QR card on `/r` — which is what makes it
read as an identity rather than decoration.

The favicon is this mark as an inline `data:` URI in each page's `<head>`,
which `img-src 'self' data:` already permits.

### Shared chrome

`.site-header` carries the mark plus the wordmark on the left and at most one
action on the right; `.site-footer` carries the wordmark and a muted line of
meta. Both are inline static markup, duplicated across the four HTML files
rather than injected by script. The duplication is deliberate: on the car
screen a header that disappears when a module fails to load is worse than a
few repeated lines, and these pages have no templating layer.

## `/` — landing page

### Above the fold

A hero of `min-height: 100svh` minus the header, vertically centred, two
columns on desktop and stacked on mobile.

Left column, in order: eyebrow `ENCRYPTED LINK RELAY · TESLA BROWSER`;
display headline "Teleport a link **from your phone to your car.**" with the
second clause in `--accent`, mirroring the reference's two-tone headline; one
sentence of body copy; the two role buttons; and a small trust line reading
`End-to-end encrypted · the relay can't read your links`.

The buttons keep their current labels — "I'm the car — show my code" and "I'm
the phone — send a link" — so the pinned `/car/i` and `/phone/i` role queries
still match. The car button is primary.

Right column: an inline SVG scene of a phone, the mark enlarged into a portal
ring, and a car screen, with a link arcing through the ring. It is tinted
entirely from the accent token and pulses slowly.

**The no-scroll guarantee needs a defensive rule.** Under
`@media (max-height: 640px)` the art is removed and the hero collapses to a
single column, so a short laptop window or a landscape phone cannot push the
buttons below the fold. Without it, "no scrolling" holds only on tall
viewports.

`@media (prefers-reduced-motion: reduce)` stops the pulse.

### Below the fold

Three numbered feature cards in the reference's `01 / 02 / 03` idiom —
encrypted end to end, no app and no account, nothing stored — then a
three-step "how it works" strip, then the footer. This is marketing content;
it exists to be found after the decision, never before it.

## `/r` — the car screen

The two-panel layout and the information on it are unchanged. Restyling only:
the in-car checklist in `docs/in-car-checklist.md` stays valid, and a screen
with no developer tools is the wrong place to relocate controls.

- The QR sits on its white card inside an accent ring drawn from the mark's
  arc geometry.
- `#code` renders in mono at a large size with accent tint and generous
  tracking, legible from the driver's seat.
- `#dot` and `#status` become a **status pill**: the dot inside a rounded
  container whose border and background tint follow `data-state`. The dot
  keeps its id, its `data-state` attribute, and its three colours.
- Received links become full-width cards with an accent left edge, a large
  monospace URL, and a tap target no smaller than today's. The anchor's text
  content remains the bare URL.
- `#bookmark` becomes a bordered callout with a single treatment. Styling it
  differently for the volatile-storage case would need a class that
  `receiver.ts` does not set, and nothing else in the DOM distinguishes the
  two states — the difference lives only in the sentence itself. Rather than
  reach into TypeScript for a colour, the callout is given one visually
  insistent treatment for both cases and the existing wording carries the
  distinction. If the amber variant is wanted later, the honest fix is a
  `data-volatile` attribute set where the text is set.
- `#burn` and `#clear` demote to ghost buttons in a panel footer, separated
  from the primary content by a rule.

## `/s` — the phone

Mobile-first single column, `max-width: 480px`, centred.

- Compact header; status pill directly beneath it.
- `#url` is a large field, `#send` a full-width 56px primary button under it.
- `#msg` keeps its `data-tone` colouring and its reserved height, so the
  layout does not jump when a message appears.
- The unpaired panel leads with the mark, then the explanation, then `#manual`
  as a wide mono input, then `#pair`.

## `/debug`

Not part of the requested redesign, but it shares the stylesheet, so rewriting
`app.css` would otherwise degrade it. It gets the minimum needed to stay
coherent: header and footer chrome, and `dl`/`dt`/`dd` styled as a two-column
definition list. Its markup keeps the `dt`/`dd` structure and `#log` that the
tests assert.

## Files

| File | Change |
| --- | --- |
| `src/client/app.css` | Rewritten around the token system above |
| `index.html` | Rewritten as the landing page |
| `r/index.html` | Restructured markup, identical ids |
| `s/index.html` | Restructured markup, identical ids |
| `debug/index.html` | Header and footer chrome added |

No file under `src/client/*.ts`, `src/shared/`, `src/worker/`, or `tests/`
changes.

## Found during implementation

Five things the design above did not anticipate.

**One "Start over" per page, and it lives in the header.** `home-role.spec.ts`
clicks `a[href="/?choose"]` in Playwright's strict mode, so the new header link
plus the existing in-panel one made the selector ambiguous and the test failed.
The header copy is the consistent chrome, so the in-panel link was removed from
`/r`. `/debug` lost its duplicate back-link for the same reason of hygiene,
though nothing asserts it.

**The pairing code must not break mid-group.** `word-break: break-all` carried
over from the old stylesheet split it as `…Z12RB / N-DBZCP4`. That string is
read aloud and typed by hand, so it now wraps only at the hyphens between
groups. `.pair` widened from 340px to 380px to go with it.

**`#manual` is monospace.** The code is transcribed character by character off
the car screen; setting the input in the same face it is displayed in makes
the comparison possible.

**`.layout` stretches rather than aligning to the start**, so the pairing and
feed panels are the same height on the car's wide display instead of leaving
the feed as a short box beside a tall one.

**`.hero .wrap` needs an explicit `width: 100%`.** `margin: 0 auto` on a grid
item suppresses the default stretch and sizes it to fit-content, which centred
the hero and moved its left edge off the one every other section uses; the
layout visibly jumped when the window crossed the short-viewport breakpoint.

## Verification

- `npm run check` passes unchanged — typecheck, unit, worker, and e2e. The e2e
  suite is the guard on this redesign: if a selector or status string moved,
  it fails.
- `/` at 1280×800, 1280×620, and 390×844 shows both role buttons without
  scrolling.
- `/r` at 1920×1200, approximating the car display.
- `/s` at 390×844.
