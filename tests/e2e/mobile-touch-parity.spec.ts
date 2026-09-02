import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, openDemo } from "./helpers/app";

async function tapCenter(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  await locator.tap({ position: { x: (box?.width ?? 0) / 2, y: (box?.height ?? 0) / 2 } });
}

async function swipe(page: Page, locator: Locator, deltaY: number) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const startY = (box?.y ?? 0) + (box?.height ?? 0) * 0.72;
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: startY }] });
  for (let step = 1; step <= 5; step += 1) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: startY + deltaY * step / 5 }],
    });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await client.detach();
}

test.describe("mobile touch parity verifier", () => {
  test.skip(({ browserName, isMobile }) => browserName !== "chromium" || !isMobile, "Requires an emulated touch screen and Chromium touch-event dispatch.");

  test("finger taps preserve dashboard actions and expose comfortable primary targets", async ({ page }) => {
    await openDemo(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const portfolio = page.locator(".chart-card").first();
    const chart = portfolio.locator('canvas[role="img"]');
    const totalPoints = await chart.getAttribute("data-visible-points");
    const oneYear = portfolio.getByRole("button", { name: "1Y", exact: true });
    await tapCenter(oneYear);
    await expect(chart).not.toHaveAttribute("data-visible-points", totalPoints ?? "");

    for (const control of [
      oneYear,
      portfolio.getByRole("button", { name: "Zoom in" }),
      page.getByRole("button", { name: "Replace CAS" }),
    ]) {
      const box = await control.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    const slice = page.locator(".hero-donut").getByRole("button", { name: /Small cap allocation/ });
    await tapCenter(slice);
    await expect(page.locator(".hero-donut")).toHaveAttribute("data-selected-slice", /.+/);
    await expect(page.getByRole("tooltip")).toBeVisible();

    const firstFund = page.locator(".fund-group .fund-row").first();
    await tapCenter(firstFund);
    const drawer = page.getByRole("dialog", { name: "Aurora Small Cap Direct Growth" });
    await expect(drawer).toBeVisible();
    const close = drawer.getByRole("button", { name: "Close fund details" });
    const closeBox = await close.boundingBox();
    expect(closeBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(closeBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await tapCenter(close);
    await expect(drawer).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("finger inspection and swiping work without desktop hover or mouse APIs", async ({ page }) => {
    await openDemo(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const chart = page.locator('.chart-card canvas[role="img"]').first();
    await tapCenter(chart);
    const tooltip = page.locator(".chart-card .chart-tooltip").first();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("₹");

    const ranking = page.getByRole("region", { name: "All fund concentration rankings" });
    await ranking.scrollIntoViewIfNeeded();
    expect(await ranking.evaluate((element) => element.scrollTop)).toBe(0);
    await swipe(page, ranking, -120);
    await expect.poll(() => ranking.evaluate((element) => element.scrollTop)).toBeGreaterThan(30);
    await expect(ranking).toHaveAttribute("data-dragging", "false");
    await expectNoHorizontalOverflow(page);
  });
});
