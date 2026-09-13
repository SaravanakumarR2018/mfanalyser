import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, openDemo, uploadCas } from "./helpers/app";
import { installFundComparisonMocks, makeFundComparisonCasPdf } from "./helpers/fund-comparison-fixture";
import { makeTwoFundCasPdf, PARTIAL_FIRST_ISIN, PARTIAL_SECOND_ISIN } from "./helpers/verifier-fixtures";
import { mockLatestNav } from "./helpers/cas-fixture";

async function pinch(page: Page, chart: Locator, native: boolean, reverse = false) {
  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.boundingBox())!;
  const center = { x: box.x + box.width * 0.6, y: box.y + Math.min(box.height * 0.45, 180) };
  const steps = Array.from({ length: 7 }, (_, index) => {
    const gap = box.width * (reverse ? 0.27 - index * 0.032 : 0.075 + index * 0.032);
    return [{ x: center.x - gap, y: center.y, id: 1 }, { x: center.x + gap, y: center.y, id: 2 }];
  });
  if (native) {
    const client = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: steps[0] });
    for (const points of steps.slice(1)) await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await client.detach();
  } else {
    // Cross-engine wiring check; native browser arbitration is tested with CDP.
    await chart.evaluate((element, frames) => {
      for (const [index, points] of frames.entries()) {
        const event = new Event(index ? "touchmove" : "touchstart", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "touches", { value: points.map((point) => ({ identifier: point.id, clientX: point.x, clientY: point.y })) });
        element.dispatchEvent(event);
      }
      element.dispatchEvent(new Event("touchend", { bubbles: true }));
    }, steps);
  }
}

test("browser Back and repeated closes retain the parsed statement and filtered funds", async ({ page }) => {
  await installFundComparisonMocks(page);
  await page.goto("/");
  await uploadCas(page, makeFundComparisonCasPdf());
  const search = page.getByRole("textbox", { name: "Search funds" });
  await search.fill("Alpha");
  const originalUrl = page.url();
  for (let repeat = 0; repeat < 3; repeat += 1) {
    await page.locator(".fund-name").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const history = await page.evaluate(() => JSON.stringify(window.history.state));
    expect(history).toContain('"folioVistaDetails":true');
    expect(history).not.toMatch(/Alpha|11111111|INF111|transactions|currentValue/);
    if (repeat === 1) await page.getByRole("button", { name: "Close fund details" }).click();
    else await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(search).toHaveValue("Alpha");
    await expect(page.locator(".fund-group")).toHaveCount(1);
    expect(page.url()).toBe(originalUrl);
  }
  await page.reload();
  await expect(page.getByRole("button", { name: /explore with demo data/i })).toBeVisible();
});

test("mobile navigation stays visible at the end of details and returns to the same portfolio", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDemo(page);
  await page.locator(".fund-name").first().click();
  const dialog = page.getByRole("dialog");
  await dialog.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const back = dialog.getByRole("button", { name: "Back to funds" });
  const box = (await back.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThan(844);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await back.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".fund-group")).toHaveCount(6);
  await expectNoHorizontalOverflow(page);
});

test("transaction rows distinguish inflows and sales and identify their masked folio", async ({ page }) => {
  await installFundComparisonMocks(page);
  await page.goto("/");
  await uploadCas(page, makeFundComparisonCasPdf());
  await page.getByRole("textbox", { name: "Search funds" }).fill("Alpha");
  await page.locator(".fund-name").first().click();
  const rows = page.getByRole("dialog").locator(".transaction-list > div");
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: "Redemption / sale" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Purchase / inflow" })).toHaveCount(2);
  for (const row of await rows.all()) {
    await expect(row.locator(".transaction-folio")).toHaveText("Folio ••••1/11");
    await expect(row).not.toContainText("11111111/11");
  }
});

test("transactions retain distinct folios when one fund combines multiple accounts", async ({ page }) => {
  await mockLatestNav(page, { status: 503 });
  await page.goto("/");
  // Same-length synthetic ISIN substitution preserves the fixture's PDF offsets.
  const pdf = Buffer.from(makeTwoFundCasPdf().toString("latin1").replaceAll(PARTIAL_SECOND_ISIN, PARTIAL_FIRST_ISIN), "latin1");
  await uploadCas(page, pdf);
  await expect(page.locator(".fund-group")).toHaveCount(1);
  await page.locator(".fund-name").click();
  const rows = page.getByRole("dialog").locator(".transaction-list > div");
  await expect(rows.filter({ hasText: "10,000" }).locator(".transaction-folio")).toHaveText("Folio ••••8/90");
  await expect(rows.filter({ hasText: "7,000" }).locator(".transaction-folio")).toHaveText("Folio ••••1/09");
  await page.goBack();
  await page.locator(".row-expand").click();
  const folio = page.locator(".folio-row").first();
  await folio.click();
  await expect(page.getByRole("dialog").locator(".transaction-folio")).toHaveText("Folio ••••8/90");
  await page.goBack();
  await expect(folio).toBeVisible();
});

test("a native horizontal content swipe closes details while vertical scrolling keeps them open", async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== "chromium" || !isMobile, "Native touch dispatch requires mobile Chromium; browser Back is covered across engines.");
  await page.setViewportSize({ width: 390, height: 844 });
  await openDemo(page);
  await page.locator(".fund-name").first().click();
  const dialog = page.getByRole("dialog");
  const value = dialog.locator(".drawer-value");
  const box = (await value.boundingBox())!;
  const client = await page.context().newCDPSession(page);
  const x = box.x + box.width * 0.8, y = box.y + box.height * 0.5;
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 5; step += 1) await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - step * 28, y }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(dialog).toHaveCount(0);
  await page.locator(".fund-name").first().click();
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 200, y: 600 }] });
  for (let step = 1; step <= 5; step += 1) await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 200, y: 600 - step * 45 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await client.detach();
});

test("all chart families support anchored pinch zoom with synchronized controls", async ({ page, browserName, isMobile }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFundComparisonMocks(page);
  await page.route("https://api.worldbank.org/**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([{ total: 30 }, Array.from({ length: 30 }, (_, index) => ({ countryiso3code: "IND", date: String(1996 + index), value: 3 + index % 5, indicator: { id: "FP.CPI.TOTL.ZG" } }))]) }));
  await page.goto("/");
  await uploadCas(page, makeFundComparisonCasPdf());
  await expect(page.locator(".history-progress-toast")).toHaveCount(0);
  const native = browserName === "chromium" && isMobile;
  const journey = page.locator(".chart-card canvas").first();
  const initial = Number(await journey.getAttribute("data-visible-points"));
  await pinch(page, journey, native);
  await expect.poll(async () => Number(await journey.getAttribute("data-visible-points"))).toBeLessThan(initial);
  await pinch(page, journey, native, true);
  await expect.poll(async () => Number(await journey.getAttribute("data-visible-points"))).toBeGreaterThan(2);
  const stack = page.locator(".stack-base-canvas").first();
  const stackCount = Number(await stack.getAttribute("data-visible-points"));
  await pinch(page, stack, native);
  await expect.poll(async () => Number(await stack.getAttribute("data-visible-points"))).toBeLessThan(stackCount);
  const comparison = page.locator(".fund-comparison-shell canvas");
  await expect(comparison).toHaveAttribute("data-visible-start", /\d{4}-/);
  const start = await comparison.getAttribute("data-visible-start");
  await pinch(page, comparison, native);
  await expect(comparison).not.toHaveAttribute("data-visible-start", start!);
  const inflation = page.locator(".inflation-chart-shell svg");
  await page.locator(".inflation-card").scrollIntoViewIfNeeded();
  await expect(inflation).toBeVisible();
  await pinch(page, inflation, native);
  await expect(inflation).not.toHaveAttribute("data-start-year", "1996");
  await page.getByRole("button", { name: "Show all years" }).click();
  await expect(inflation).toHaveAttribute("data-start-year", "1996");
  const donut = page.locator(".hero-donut svg");
  await pinch(page, donut, native);
  await expect(donut).not.toHaveAttribute("viewBox", "0 0 180 180");
  await page.locator(".hero-donut").getByRole("button", { name: "Reset zoom" }).click();
  await expect(donut).toHaveAttribute("viewBox", "0 0 180 180");
  await page.getByRole("textbox", { name: "Search funds" }).fill("Alpha");
  await page.locator(".fund-name").first().click();
  const nav = page.getByRole("dialog").locator(".nav-activity-shell canvas");
  const navCount = Number(await nav.getAttribute("data-visible-points"));
  await pinch(page, nav, native);
  await expect.poll(async () => Number(await nav.getAttribute("data-visible-points"))).toBeLessThan(navCount);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
