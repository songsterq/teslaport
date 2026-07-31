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
