import { Room } from "./room";

export interface Env {
  ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

const WS_PATH = /^\/ws\/([A-Za-z0-9_-]{22})$/;

const SECURITY_HEADERS: Record<string, string> = {
  /**
   * One year. Not just transport hardening: `crypto.subtle` only exists in a
   * secure context, so a car that ever loads this over http gets a page that
   * cannot encrypt at all. Pinning https removes that failure mode.
   *
   * `includeSubDomains` is deliberately absent — it binds every sibling
   * hostname on the deployment domain, which is the domain owner's call to
   * make, not this app's.
   */
  "Strict-Transport-Security": "max-age=31536000",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/**
 * Built per request so `connect-src` can name this origin's websocket host.
 *
 * `'self'` alone is what CSP3 requires browsers to match ws:/wss: against, but
 * older Chromium did not — and the car runs Chromium of unknown vintage — so
 * the host is spelled out as well. What must never come back are the bare
 * `wss:`/`ws:` scheme-sources: those match *any* host, which hands an injected
 * or supply-chain-compromised script a channel to ship decrypted links
 * anywhere, in an app whose entire premise is that no server can read them.
 */
function contentSecurityPolicy(host: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    `connect-src 'self' wss://${host} ws://${host}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Every hostname the Worker answers on is a complete, working copy of the
 * site, and `workers.dev` hands you one for free on the first deploy. Since
 * the canonical URL is now derived from the request host, that copy
 * self-canonicalises instead of pointing at the real domain — which is exactly
 * the duplicate-content split a canonical tag exists to prevent. Nothing here
 * knows which domain is the real one, so rather than guess, the deployment
 * hostname Cloudflare assigns is the one told not to be indexed.
 */
const PREVIEW_HOST = /(^|\.)workers\.dev$/;

/**
 * Rewrites a root-relative URL in one attribute to an absolute one on the
 * serving origin. Anything already absolute is left alone, so a tag that needs
 * to name a specific host still can.
 */
class Absolutise {
  constructor(
    private readonly attribute: string,
    private readonly origin: string,
  ) {}

  element(element: Element): void {
    const value = element.getAttribute(this.attribute);
    if (value?.startsWith("/")) element.setAttribute(this.attribute, this.origin + value);
  }
}

/**
 * Appended as the last child of <head>.
 *
 * The tag is injected rather than rewritten in place because vite's HTML
 * plugin resolves every <link href> as a build asset: an authored
 * `href="/s"` is read as a path to a file, finds the `s/` directory, and
 * fails the build with EISDIR. <meta> is not treated that way, which is why
 * the Open Graph URLs below can stay in the markup and merely be absolutised.
 */
class InjectCanonical {
  constructor(private readonly href: string) {}

  element(element: Element): void {
    element.append(`<link rel="canonical" href="${this.href}" />`, { html: true });
  }
}

/**
 * Fills the serving origin into the canonical and Open Graph URLs. Open Graph
 * requires absolute URLs — a scraper has no document base to resolve against —
 * so this cannot be left to the markup without naming a domain in it.
 *
 * `pathname` rather than the full URL: a query string does not make a
 * different page, and `/?choose` must not present itself as a separate URL
 * from `/`. Trailing slashes are already normalised away by the asset server's
 * drop-trailing-slash handling before anything reaches here.
 */
function absolutiseUrls(response: Response, url: URL): Response {
  const origin = url.origin;
  const rewritten = new HTMLRewriter()
    .on("head", new InjectCanonical(origin + url.pathname))
    .on('meta[property="og:url"]', new Absolutise("content", origin))
    .on('meta[property="og:image"]', new Absolutise("content", origin))
    .transform(response);

  /*
   * The body is now a different length than the upstream asset response
   * claimed. A stale Content-Length truncates the document at the browser,
   * and the JSON-LD this SEO work added sits in the last few lines of it.
   */
  rewritten.headers.delete("Content-Length");
  return rewritten;
}

function robotsTxt(origin: string): string {
  return `# /r, /s and /debug are intentionally crawlable. They carry
# <meta name="robots" content="noindex,nofollow"> instead. Disallowing them
# here would stop the crawler fetching them, so it would never read that tag,
# and the URLs would stay eligible to appear as bare untitled results.
User-agent: *
Allow: /

Sitemap: ${origin}/sitemap.xml
`;
}

/** Only the home page: the rest of the site is noindex. */
function sitemapXml(origin: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${origin}/</loc>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
}

async function serve(request: Request, env: Env, url: URL): Promise<Response> {
  // Generated rather than served from public/, because both files have to
  // name the origin absolutely and the origin is not known until a request
  // arrives.
  if (url.pathname === "/robots.txt") {
    return new Response(robotsTxt(url.origin), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (url.pathname === "/sitemap.xml") {
    return new Response(sitemapXml(url.origin), {
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
  }

  const assetResponse = await env.ASSETS.fetch(request);
  const response = new Response(assetResponse.body, assetResponse);
  return response.headers.get("Content-Type")?.includes("text/html")
    ? absolutiseUrls(response, url)
    : response;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = WS_PATH.exec(url.pathname);
    if (match) {
      const id = env.ROOM.idFromName(match[1]!);
      return env.ROOM.get(id).fetch(request);
    }

    const response = await serve(request, env, url);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      response.headers.set(name, value);
    }
    response.headers.set("Content-Security-Policy", contentSecurityPolicy(url.host));
    if (PREVIEW_HOST.test(url.hostname)) response.headers.set("X-Robots-Tag", "noindex");
    return response;
  },
};

export { Room };
