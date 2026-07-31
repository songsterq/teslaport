import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const ROLE_KEY = "teslaport:role";

const storedRole = (page: Page): Promise<string | null> =>
  page.evaluate((key) => localStorage.getItem(key), ROLE_KEY);

/** A browser that has never opened either role page. */
async function freshPage(context: BrowserContext): Promise<Page> {
  return context.newPage();
}

test("a browser with no stored role sees the chooser", async ({ browser }) => {
  const page = await freshPage(await browser.newContext());
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('a[href="/r"]')).toBeVisible();
  await expect(page.locator('a[href="/s"]')).toBeVisible();
  expect(await storedRole(page)).toBeNull();
});

test("/ resumes the car after /r has been opened", async ({ browser }) => {
  const page = await freshPage(await browser.newContext());
  await page.goto("/r");
  await expect(page.locator("#qr svg")).toBeVisible();
  expect(await storedRole(page)).toBe("receiver");

  await page.goto("/");
  // receiver.ts restores the seed-carrying URL, so the fragment comes back too.
  await expect(page).toHaveURL(/\/r#[0-9A-Z]{24}$/);
  await expect(page.locator("#qr svg")).toBeVisible();
});

test("/ resumes the phone after /s has been opened", async ({ browser }) => {
  const page = await freshPage(await browser.newContext());
  await page.goto("/s");
  await expect(page.locator("#unpaired")).toBeVisible();
  expect(await storedRole(page)).toBe("sender");

  await page.goto("/");
  await expect(page).toHaveURL(/\/s$/);
  await expect(page.locator("#unpaired")).toBeVisible();
});

/**
 * The escape hatch. Without it, a browser that has opened either page once can
 * never reach the chooser again — the only way back would be clearing site
 * data, which on the car also destroys the pairing seed.
 */
test("/?choose shows the chooser despite a stored role, and does not change it", async ({
  browser,
}) => {
  const page = await freshPage(await browser.newContext());
  await page.goto("/r");
  await expect(page.locator("#qr svg")).toBeVisible();

  await page.goto("/?choose");
  await expect(page).toHaveURL(/\/\?choose$/);
  await expect(page.locator('a[href="/s"]')).toBeVisible();
  // Merely looking at the chooser must not repoint the device.
  expect(await storedRole(page)).toBe("receiver");
});

test("Start over on the car routes to the chooser and can switch role", async ({ browser }) => {
  const page = await freshPage(await browser.newContext());
  await page.goto("/r");
  await expect(page.locator("#qr svg")).toBeVisible();

  await page.locator('a[href="/?choose"]').click();
  await expect(page.locator('a[href="/s"]')).toBeVisible();
  await page.locator('a[href="/s"]').click();
  await expect(page).toHaveURL(/\/s$/);
  expect(await storedRole(page)).toBe("sender");

  await page.goto("/");
  await expect(page).toHaveURL(/\/s$/);
});

test("Start over is reachable on the phone too", async ({ browser }) => {
  const page = await freshPage(await browser.newContext());
  await page.goto("/s");
  await page.locator('a[href="/?choose"]').click();
  await expect(page.locator('a[href="/r"]')).toBeVisible();
});

test("neither role page offers a direct cross-link to the other", async ({ browser }) => {
  const context = await browser.newContext();
  const car = await context.newPage();
  await car.goto("/r");
  await expect(car.locator('a[href="/s"]')).toHaveCount(0);

  const phone = await context.newPage();
  await phone.goto("/s");
  await expect(phone.locator('a[href="/r"]')).toHaveCount(0);
});

// Spec edge case: localStorage unavailable must degrade to the chooser rather
// than leaving a blank page on a screen with no developer tools.
test("the chooser still renders when localStorage is blocked", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript({
    content: `Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });`,
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator('a[href="/r"]')).toBeVisible();
  await expect(page.locator('a[href="/s"]')).toBeVisible();
  expect(pageErrors).toEqual([]);
});
