import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Simulates a browser configured to block site data: reading
 * `window.localStorage` throws, which is what Chrome does when cookies and
 * site data are disabled for the origin.
 */
async function blockedStoragePage(browser: Browser): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext();
  await context.addInitScript({
    content: `Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new DOMException("The operation is insecure.", "SecurityError"); },
    });`,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return { page, errors };
}

test("the car page still renders with storage blocked", async ({ browser }) => {
  const { page, errors } = await blockedStoragePage(browser);
  await page.goto("/r");

  // The whole point: a QR code instead of a blank screen.
  await expect(page.locator("#qr svg")).toBeVisible();
  await expect(page.locator("#code")).toHaveText(/^[0-9A-Z]{6}-[0-9A-Z]{6}-[0-9A-Z]{6}-[0-9A-Z]{6}$/);
  await expect(page).toHaveURL(/\/r#[0-9A-Z]{24}$/);
  expect(errors).toEqual([]);
});

test("the car page warns that the code will not survive a reload", async ({ browser }) => {
  const { page } = await blockedStoragePage(browser);
  await page.goto("/r");
  await expect(page.locator("#bookmark")).toContainText("blocking site storage");
  await expect(page.locator("#bookmark")).toContainText("Bookmark this page now");
});

test("the car page still reaches the room with storage blocked", async ({ browser }) => {
  const { page } = await blockedStoragePage(browser);
  await page.goto("/r");
  // Pairing is derived from the seed in the URL, not from storage, so the
  // socket must still come up.
  await expect(page.locator("#dot")).toHaveAttribute("data-state", "open");
});

test("the phone page still renders with storage blocked", async ({ browser }) => {
  const { page, errors } = await blockedStoragePage(browser);
  await page.goto("/s");
  await expect(page.locator("#unpaired")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a link still gets through with storage blocked on both ends", async ({ browser }) => {
  const car = await blockedStoragePage(browser);
  await car.page.goto("/r");
  await expect(car.page.locator("#dot")).toHaveAttribute("data-state", "open");
  const code = new URL(car.page.url()).hash.replace(/^#/, "");

  const phone = await blockedStoragePage(browser);
  await phone.page.goto(`/s#${code}`);
  await expect(phone.page.locator("#status")).toHaveText("Car connected");
  await phone.page.locator("#url").fill("https://example.com/blocked");
  await phone.page.locator("#send").click();

  await expect(phone.page.locator("#msg")).toHaveText("Sent ✓");
  await expect(car.page.locator("ul#links a")).toHaveText("https://example.com/blocked");
  expect(car.errors).toEqual([]);
  expect(phone.errors).toEqual([]);
});

// /debug is the only diagnostic channel in the car, so it has to survive the
// very condition it exists to report.
test("/debug renders and names the degraded storage mode", async ({ browser }) => {
  const { page, errors } = await blockedStoragePage(browser);
  await page.goto("/debug");

  const row = (label: string) => page.locator(`dt:text-is('${label}') + dd`);
  await expect(row("Storage mode")).toContainText("IN-MEMORY FALLBACK");
  await expect(row("localStorage round-trip")).toContainText("FAILED");
  // The rest of the report must still be produced.
  await expect(row("Crypto round-trip")).toHaveText("ok");
  await expect(row("WebSocket round-trip")).toContainText(/^ok \(\d+ ms\)$/, { timeout: 15000 });
  expect(errors).toEqual([]);
});

test("/debug reports normal storage when it works", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/debug");
  await expect(page.locator("dt:text-is('Storage mode') + dd")).toHaveText("localStorage");
});
