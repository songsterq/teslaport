import { expect, test, type Browser, type Page } from "@playwright/test";

async function openCar(
  browser: Browser,
): Promise<{ page: Page; code: string; roomId: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/r");
  await expect(page.locator("#qr svg")).toBeVisible();
  await expect(page.locator("#dot")).toHaveAttribute("data-state", "open");
  const code = new URL(page.url()).hash.replace(/^#/, "");
  expect(code).toHaveLength(24);

  const debugPage = await context.newPage();
  await debugPage.goto("/debug");
  const roomId = await debugPage
    .locator("dt:text-is('Room ID') + dd")
    .innerText();
  await debugPage.close();

  return { page, code, roomId };
}

test("pairs, sends a link, renders it, and acks", async ({ browser }) => {
  const car = await openCar(browser);
  const phone = await (await browser.newContext()).newPage();
  await phone.goto(`/s#${car.code}`);

  await expect(phone.locator("#status")).toHaveText("Car connected");
  await expect(phone.locator("#dot")).toHaveAttribute("data-state", "open");
  await phone.locator("#url").fill("https://example.com/hello");
  await phone.locator("#send").click();

  await expect(phone.locator("#msg")).toHaveText("Sent ✓");
  await expect(phone.locator("#url")).toHaveValue("");
  await expect(car.page.locator("ul#links a")).toHaveText(
    "https://example.com/hello",
  );
  await expect(car.page.locator("ul#links a")).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  // Same tab, deliberately — Tesla's browser mishandles target="_blank".
  await expect(car.page.locator("ul#links a")).not.toHaveAttribute(
    "target",
    /.*/,
  );
});

test("disables send when the car is absent", async ({ browser }) => {
  const car = await openCar(browser);
  const code = car.code;
  await car.page.context().close();

  const phone = await (await browser.newContext()).newPage();
  await phone.goto(`/s#${code}`);
  await expect(phone.locator("#status")).toHaveText("Car not connected");
  // Amber, not green: phone socket may be up, but the path is not ready.
  await expect(phone.locator("#dot")).toHaveAttribute("data-state", "connecting");
  await expect(phone.locator("#send")).toBeDisabled();
});

test("reconnects the car after the network drops", async ({ browser }) => {
  const car = await openCar(browser);
  const context = car.page.context();

  // Playwright's setOffline flips navigator.onLine but does not fire the
  // window offline/online events or close localhost WebSockets. Real browsers
  // fire those events on network loss; dispatch them so the socket client
  // path under test matches production.
  await context.setOffline(true);
  await car.page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(car.page.locator("#dot")).toHaveAttribute(
    "data-state",
    "closed",
  );

  await context.setOffline(false);
  await car.page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(car.page.locator("#dot")).toHaveAttribute("data-state", "open", {
    timeout: 20000,
  });
});

test("an unkeyed receiver neither displaces the car nor acks", async ({
  browser,
}) => {
  const car = await openCar(browser);

  // A third party that learned only the roomId connects as a receiver.
  const intruderPage = await (await browser.newContext()).newPage();
  await intruderPage.goto("/");
  const received = intruderPage.evaluate((roomId) => {
    return new Promise<number>((resolve) => {
      const ws = new WebSocket(
        `${location.origin.replace(/^http/, "ws")}/ws/${roomId}?role=receiver`,
      );
      ws.binaryType = "arraybuffer";
      ws.addEventListener("message", (event) =>
        resolve((event.data as ArrayBuffer).byteLength),
      );
    });
  }, car.roomId);

  const phone = await (await browser.newContext()).newPage();
  await phone.goto(`/s#${car.code}`);
  await expect(phone.locator("#status")).toHaveText("Car connected");
  await phone.locator("#url").fill("https://example.com/secret");
  await phone.locator("#send").click();

  // The car still receives, renders, and acks.
  await expect(car.page.locator("ul#links a")).toHaveText(
    "https://example.com/secret",
  );
  await expect(phone.locator("#msg")).toHaveText("Sent ✓");
  // The intruder received only opaque bytes.
  expect(await received).toBeGreaterThan(12);
});

// The home page is the one nav path with no other coverage, and the car cannot
// be debugged if a control silently does nothing when tapped.
test("the home page routes to both roles", async ({ browser }) => {
  // Separate contexts: a phone that had already been the car would find a seed
  // in its own storage and come up paired, which would not test the link.
  const car = await (await browser.newContext()).newPage();
  await car.goto("/");
  await car.getByRole("link", { name: /car/i }).click();
  await expect(car).toHaveURL(/\/r#[0-9A-Z]{24}$/);
  await expect(car.locator("#qr svg")).toBeVisible();

  const phone = await (await browser.newContext()).newPage();
  await phone.goto("/");
  await phone.getByRole("link", { name: /phone/i }).click();
  await expect(phone).toHaveURL(/\/s$/);
  await expect(phone.locator("#unpaired")).toBeVisible();
});

// The probe only reports ok once the server answers the byte it sent, so this
// covers the outbound frame path too — not just the upgrade.
test("/debug round-trip probes all pass against the real worker", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/debug");

  const row = (label: string) => page.locator(`dt:text-is('${label}') + dd`);
  await expect(row("WebSocket round-trip")).toContainText(/^ok \(\d+ ms\)$/, { timeout: 15000 });
  await expect(row("localStorage round-trip")).toHaveText("ok");
  await expect(row("Crypto round-trip")).toHaveText("ok");
  await expect(page.locator("#log")).toHaveText("none");
});

test("a car with a skewed clock reports the skew on /debug", async ({ browser }) => {
  const SKEW_MS = 47 * 60 * 1000;
  const context = await browser.newContext();
  // Every page in this context believes it is 47 minutes ahead — exactly how a
  // car with a wrong clock behaves. Every link then fails the freshness check.
  await context.addInitScript({
    content: `{ const realNow = Date.now.bind(Date); Date.now = () => realNow() + ${SKEW_MS}; }`,
  });

  const car = await context.newPage();
  await car.goto("/r");
  await expect(car.locator("#dot")).toHaveAttribute("data-state", "open");
  const code = new URL(car.url()).hash.replace(/^#/, "");

  const phone = await (await browser.newContext()).newPage();
  await phone.goto(`/s#${code}`);
  await expect(phone.locator("#status")).toHaveText("Car connected");
  await phone.locator("#url").fill("https://example.com/stale");
  await phone.locator("#send").click();

  // The car drops the link and never acks it.
  await expect(phone.locator("#msg")).toContainText("No confirmation from the car");
  await expect(car.locator("ul#links a")).toHaveCount(0);

  // /debug must name the cause rather than reporting nothing received.
  const debugPage = await context.newPage();
  await debugPage.goto("/debug");
  await expect(
    debugPage.locator("dt:text-is('Rejected messages') + dd"),
  ).toContainText("stale 1");
  await expect(
    debugPage.locator("dt:text-is('Clock delta vs last sender (ms)') + dd"),
  ).toContainText("OVER THE 5 MINUTE WINDOW");
});

test("burning the code strands the old phone", async ({ browser }) => {
  const car = await openCar(browser);
  const oldCode = car.code;

  car.page.on("dialog", (dialog) => void dialog.accept());
  await car.page.locator("#burn").click();
  await expect(car.page).toHaveURL(new RegExp(`/r#(?!${oldCode})`));

  const phone = await (await browser.newContext()).newPage();
  await phone.goto(`/s#${oldCode}`);
  await expect(phone.locator("#status")).toHaveText("Car not connected");
  await expect(phone.locator("#send")).toBeDisabled();
});
