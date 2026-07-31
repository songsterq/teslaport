import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

const BASE = "https://teslaport.test";

async function csp(path = "/"): Promise<string> {
  const res = await SELF.fetch(`${BASE}${path}`);
  const header = res.headers.get("Content-Security-Policy");
  expect(header).not.toBeNull();
  return header!;
}

function directive(policy: string, name: string): string {
  const found = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  expect(found, `missing ${name} directive in: ${policy}`).toBeDefined();
  return found!;
}

describe("security headers", () => {
  it("locks the default down to nothing", async () => {
    expect(directive(await csp(), "default-src")).toBe("default-src 'none'");
  });

  /**
   * A bare `wss:` or `ws:` scheme-source matches *any* host. For an app whose
   * premise is that no server can read the link, that is an open exfiltration
   * channel for any injected or supply-chain-compromised script.
   */
  it("confines connect-src to this origin, with no wildcard scheme source", async () => {
    const connect = directive(await csp(), "connect-src");
    expect(connect).not.toMatch(/(^|\s)wss:(\s|$)/);
    expect(connect).not.toMatch(/(^|\s)ws:(\s|$)/);
    expect(connect).not.toContain("*");
    expect(connect).toContain("wss://teslaport.test");
  });

  it("still allows the app's own websocket host", async () => {
    const connect = directive(await csp(), "connect-src");
    expect(connect).toContain("'self'");
    expect(connect).toContain("ws://teslaport.test");
  });

  it("blocks framing, base tags and form posts", async () => {
    const policy = await csp();
    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(policy, "base-uri")).toBe("base-uri 'none'");
    expect(directive(policy, "form-action")).toBe("form-action 'none'");
  });

  it("sets the non-CSP hardening headers", async () => {
    const res = await SELF.fetch(`${BASE}/`);
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
  });
});
