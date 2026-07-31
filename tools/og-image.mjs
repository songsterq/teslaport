/*
 * Regenerates public/og.png, the 1200x630 social card.
 *
 *   node tools/og-image.mjs public/og.png
 *
 * Run by hand, not by `npm run build` — the output is committed, so a build on
 * a machine without sharp still produces a complete site. sharp is not in
 * package.json either; it arrives transitively under wrangler. If that ever
 * stops being true, `npm i -D sharp`, regenerate, and drop it again.
 *
 * Text is rendered by librsvg, which resolves font-family against the host's
 * installed fonts. Check the PNG after changing any text — a missing family
 * degrades silently to a default rather than failing.
 */
import sharp from "sharp";

const FONT = "system-ui, -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";

// The brand mark, verbatim from index.html's viewBox="0 0 64 64".
const mark = (x, y, s, w) => `
  <g transform="translate(${x} ${y}) scale(${s})">
    <path d="M53.61 24.13 A23 23 0 0 0 10.39 24.13" stroke="#3ddad7" stroke-width="${w}" stroke-linecap="round" fill="none"/>
    <path d="M10.39 39.87 A23 23 0 0 0 53.61 39.87" stroke="#3ddad7" stroke-width="${w}" stroke-linecap="round" fill="none"/>
    <path d="M22 20 L40 32 L22 44" stroke="#f5f8fa" stroke-width="${w + 1}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0b0d10"/>

  <!-- Accent haze behind the oversized mark on the right. -->
  <circle cx="965" cy="315" r="240" fill="#3ddad7" opacity="0.05"/>
  <circle cx="965" cy="315" r="168" fill="none" stroke="#3ddad7" stroke-width="1" opacity="0.20"/>
  <circle cx="965" cy="315" r="212" fill="none" stroke="#3ddad7" stroke-width="1" opacity="0.12"/>
  ${mark(825, 175, 4.4, 5)}

  <!-- Wordmark -->
  ${mark(84, 74, 0.72, 5.5)}
  <text x="136" y="112" font-family="${FONT}" font-size="30" font-weight="800"
        letter-spacing="-0.6" fill="#f5f8fa">TeslaPort</text>

  <!-- Headline -->
  <text x="84" y="286" font-family="${FONT}" font-size="76" font-weight="800"
        letter-spacing="-2.6" fill="#3ddad7">Tesla link sharing</text>
  <text x="84" y="368" font-family="${FONT}" font-size="76" font-weight="800"
        letter-spacing="-2.6" fill="#f5f8fa">from phone to car.</text>

  <!-- Sub -->
  <text x="84" y="430" font-family="${FONT}" font-size="27" font-weight="400"
        fill="#a8b3c1">Paste a URL on your phone. It opens in your Tesla's browser.</text>

  <!-- Trust line -->
  <g transform="translate(84 496)">
    <path d="M12 2.5 20 6v6c0 4.6-3.2 8.5-8 9.5-4.8-1-8-4.9-8-9.5V6l8-3.5Z"
          fill="none" stroke="#3ddad7" stroke-width="2" stroke-linejoin="round"
          transform="scale(1.05)"/>
    <text x="38" y="19" font-family="${FONT}" font-size="23" font-weight="500"
          fill="#6f7c8c">End-to-end encrypted · no app, no account</text>
  </g>
</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(process.argv[2]);
console.log("wrote", process.argv[2]);
