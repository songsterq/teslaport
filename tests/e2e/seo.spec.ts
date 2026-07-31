import { expect, test } from "@playwright/test";

/**
 * These run through the real wrangler dev server for the same reason
 * security-headers.spec.ts does: og.png is copied out of public/ by the build,
 * and the canonical, Open Graph, robots.txt and sitemap.xml URLs are all
 * absolutised by the Worker against the request host. A unit test driving the
 * fetch handler directly would not see whether the asset pipeline still runs
 * that rewrite.
 *
 * No production domain appears anywhere below. That is the point of the
 * change these cover: the origin is whatever host answered, so the assertions
 * derive it from the response rather than naming one.
 */

/** Pages that exist to be used, not found. */
const APP_PAGES = ["/r", "/s", "/debug"];

const originOf = (url: string): string => new URL(url).origin;

test("the home page is indexable and canonical to the serving origin", async ({ page }) => {
  await page.goto("/");
  const origin = originOf(page.url());

  await expect(page.locator("link[rel=canonical]")).toHaveAttribute("href", `${origin}/`);
  await expect(page.locator("meta[name=robots]")).toHaveAttribute(
    "content",
    /^index,follow/,
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", `${origin}/`);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    `${origin}/og.png`,
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );

  // Truncation thresholds, not ranking factors: a title much past ~60 or a
  // description much past ~160 gets cut off in the result.
  const title = await page.title();
  expect(title.length, `title is ${title.length} chars: ${title}`).toBeLessThanOrEqual(60);
  expect(title).toContain("Tesla Link Sharing");

  const description = await page.locator("meta[name=description]").getAttribute("content");
  expect(description!.length).toBeLessThanOrEqual(160);
});

for (const path of APP_PAGES) {
  test(`${path} is excluded from the index`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", "noindex,nofollow");
    await expect(page.locator("link[rel=canonical]")).toHaveAttribute(
      "href",
      `${originOf(page.url())}${path}`,
    );
  });
}

/**
 * The rewrite is what makes every other canonical assertion here meaningful,
 * so prove it actually follows the host rather than happening to match the one
 * host the suite uses. 127.0.0.1 is the same server as localhost, reached
 * under a different name.
 */
test("the canonical origin follows the host that served the page", async ({ page }) => {
  await page.goto("/");
  const viaLocalhost = await page.locator("link[rel=canonical]").getAttribute("href");

  await page.goto(page.url().replace("localhost", "127.0.0.1"));
  const viaLoopback = await page.locator("link[rel=canonical]").getAttribute("href");

  expect(viaLocalhost).toContain("localhost");
  expect(viaLoopback).toContain("127.0.0.1");
  expect(viaLoopback).not.toBe(viaLocalhost);
});

/**
 * Rewriting the document changes its length, and the upstream asset response
 * carried a Content-Length for the original. If the Worker forwards that
 * stale value the browser truncates the page — silently, and at the end,
 * which is exactly where the JSON-LD sits.
 */
test("the rewritten document is not truncated", async ({ request }) => {
  const res = await request.get("/");
  const body = await res.text();

  const length = res.headers()["content-length"];
  if (length !== undefined) expect(Number(length)).toBe(Buffer.byteLength(body));
  expect(body.trimEnd()).toMatch(/<\/html>$/);
});

/**
 * The pairing pages are kept out of the index by meta-robots and are
 * deliberately left crawlable. Disallowing them here would stop the crawler
 * fetching them, so it would never read the noindex, and the bare URLs would
 * stay eligible to appear as results -- the opposite of the intent. This test
 * exists because "tidying up" robots.txt by adding those Disallow lines looks
 * like an improvement.
 */
test("robots.txt allows the app pages to be crawled and names the sitemap", async ({ request }) => {
  const res = await request.get("/robots.txt");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/plain");

  const body = await res.text();
  expect(body).toContain(`Sitemap: ${originOf(res.url())}/sitemap.xml`);
  for (const path of APP_PAGES) {
    expect(body, `robots.txt must not Disallow ${path}`).not.toMatch(
      new RegExp(`^\\s*Disallow:\\s*${path}`, "im"),
    );
  }
});

test("sitemap.xml lists the home page and nothing noindexed", async ({ request }) => {
  const res = await request.get("/sitemap.xml");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("xml");

  const origin = originOf(res.url());
  const body = await res.text();
  expect(body).toContain(`<loc>${origin}/</loc>`);
  for (const path of APP_PAGES) {
    expect(body, `${path} is noindex and must not be in the sitemap`).not.toContain(
      `<loc>${origin}${path}</loc>`,
    );
  }
});

test("the social card is served and is the size the meta tags claim", async ({ request }) => {
  const res = await request.get("/og.png");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");

  // PNG IHDR: 8-byte signature, 4-byte length, "IHDR", then width and height
  // as big-endian uint32. Cheaper than pulling in an image decoder to prove
  // the file matches og:image:width / og:image:height.
  const body = await res.body();
  expect(body.subarray(12, 16).toString("ascii")).toBe("IHDR");
  expect(body.readUInt32BE(16)).toBe(1200);
  expect(body.readUInt32BE(20)).toBe(630);
});

/**
 * The FAQ answers exist twice: as markup a visitor reads, and inside the
 * FAQPage JSON-LD. Marking up an answer that is not on the page is a
 * structured-data violation, so drift between the two is a real defect and not
 * a style question. This compares them character for character.
 */
test("the FAQ structured data matches the FAQ on the page", async ({ page }) => {
  await page.goto("/");

  const { onPage, structured } = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('script[type="application/ld+json"]')];
    const faq = blocks
      .map((block) => JSON.parse(block.textContent!))
      .find((data) => data["@type"] === "FAQPage");

    return {
      onPage: [...document.querySelectorAll("#faq .card")].map((card) => ({
        question: card.querySelector("h3")!.textContent!.trim(),
        answer: card.querySelector("p")!.textContent!.trim(),
      })),
      structured: faq.mainEntity.map((entry: any) => ({
        question: entry.name.trim(),
        answer: entry.acceptedAnswer.text.trim(),
      })),
    };
  });

  expect(onPage.length).toBeGreaterThan(0);
  expect(structured).toEqual(onPage);
});

test("both structured-data blocks are valid schema.org JSON", async ({ page }) => {
  await page.goto("/");

  const types = await page.evaluate(() =>
    [...document.querySelectorAll('script[type="application/ld+json"]')].map((block) => {
      const data = JSON.parse(block.textContent!);
      return `${data["@context"]}|${data["@type"]}`;
    }),
  );

  expect(types).toContain("https://schema.org|SoftwareApplication");
  expect(types).toContain("https://schema.org|FAQPage");
});

/**
 * The CSP is `script-src 'self'` with no 'unsafe-inline'. Browsers treat
 * ld+json as a data block rather than script, so it is not covered -- but that
 * is a claim about browser behaviour, and a future tightening of the policy
 * could change it silently, since a blocked inline block still sits in the DOM
 * and still parses. Only the violation report distinguishes the two.
 */
test("the structured data does not trip the CSP", async ({ page }) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as any).__cspViolations ??= [];
      (window as any).__cspViolations.push(event.effectiveDirective + " " + event.blockedURI);
    });
  });

  await page.goto("/");
  violations.push(...(await page.evaluate(() => (window as any).__cspViolations ?? [])));

  expect(violations.filter((entry) => entry.startsWith("script-src"))).toEqual([]);
});
