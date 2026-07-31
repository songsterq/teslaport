import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

/**
 * robots.txt, sitemap.xml and the preview-host rule are all decided inside the
 * fetch handler before it ever reaches the asset server, so unlike the
 * canonical/Open Graph rewriting — which needs a real asset response and is
 * covered in tests/e2e/seo.spec.ts — they can be driven directly here, against
 * whatever host the request names.
 */

const LIVE = "https://teslaport.example";

describe("robots.txt", () => {
  it("names the sitemap on the host that asked", async () => {
    const res = await SELF.fetch(`${LIVE}/robots.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(await res.text()).toContain(`Sitemap: ${LIVE}/sitemap.xml`);
  });

  it("follows a different host without any redeploy", async () => {
    const res = await SELF.fetch("https://elsewhere.test/robots.txt");
    expect(await res.text()).toContain("Sitemap: https://elsewhere.test/sitemap.xml");
  });

  /**
   * The pairing pages are kept out of the index by meta-robots and are
   * deliberately left crawlable: a Disallow here would stop the crawler
   * fetching them, so it would never read the noindex, and the bare URLs would
   * stay eligible to appear as results. Adding those lines looks like tidying
   * up, which is why this guards against it.
   */
  it("does not disallow the noindexed app pages", async () => {
    const body = await (await SELF.fetch(`${LIVE}/robots.txt`)).text();
    for (const path of ["/r", "/s", "/debug"]) {
      expect(body, `must not Disallow ${path}`).not.toMatch(
        new RegExp(`^\\s*Disallow:\\s*${path}`, "im"),
      );
    }
  });
});

describe("sitemap.xml", () => {
  it("lists the home page on the host that asked", async () => {
    const res = await SELF.fetch(`${LIVE}/sitemap.xml`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("xml");
    expect(await res.text()).toContain(`<loc>${LIVE}/</loc>`);
  });

  it("lists nothing that is noindexed", async () => {
    const body = await (await SELF.fetch(`${LIVE}/sitemap.xml`)).text();
    for (const path of ["/r", "/s", "/debug"]) {
      expect(body).not.toContain(`<loc>${LIVE}${path}</loc>`);
    }
  });

  it("is served with the security headers like every other response", async () => {
    const res = await SELF.fetch(`${LIVE}/sitemap.xml`);
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

/**
 * Deriving the canonical URL from the request host means every hostname that
 * reaches the Worker claims to be the canonical one — including the
 * workers.dev hostname assigned on the first deploy, which would otherwise be
 * a fully indexable duplicate of the real site.
 */
describe("the deployment hostname", () => {
  it("is told not to be indexed", async () => {
    const res = await SELF.fetch("https://teslaport.songsterq.workers.dev/");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("is told so on its generated robots.txt and sitemap too", async () => {
    for (const path of ["/robots.txt", "/sitemap.xml"]) {
      const res = await SELF.fetch(`https://teslaport.songsterq.workers.dev${path}`);
      expect(res.headers.get("X-Robots-Tag"), path).toBe("noindex");
    }
  });

  it("leaves a real domain indexable", async () => {
    const res = await SELF.fetch(`${LIVE}/`);
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
  });

  /** Substring matching would catch a legitimate `workers.dev.example.com`. */
  it("does not match a domain that merely contains the string", async () => {
    const res = await SELF.fetch("https://workers.dev.example.com/");
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
  });
});
