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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = WS_PATH.exec(url.pathname);
    if (match) {
      const id = env.ROOM.idFromName(match[1]!);
      return env.ROOM.get(id).fetch(request);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const response = new Response(assetResponse.body, assetResponse);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      response.headers.set(name, value);
    }
    response.headers.set("Content-Security-Policy", contentSecurityPolicy(url.host));
    return response;
  },
};

export { Room };
