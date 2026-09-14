import { expect, test, type Locator, type Page } from "@playwright/test";
import { openDemo, uploadCas, expectNoHorizontalOverflow } from "./helpers/app";
import { installFundComparisonMocks, makeFundComparisonCasPdf, makeTinyAllocationCasPdf } from "./helpers/fund-comparison-fixture";
import { mockLatestNav } from "./helpers/cas-fixture";

async function wheelZoom(page: Page, target: Locator, modifier: "Control" | "Alt" = "Control") {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .5);
  await page.keyboard.down(modifier);
  await page.mouse.wheel(0, -220);
  await page.keyboard.up(modifier);
}

test("mouse and trackpad wheel zoom work across every chart family", async ({ page }) => {
  await installFundComparisonMocks(page);
  await page.route("https://api.worldbank.org/**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([{ total: 30 }, Array.from({ length: 30 }, (_, index) => ({ countryiso3code: "IND", date: String(1996 + index), value: 3 + index % 5, indicator: { id: "FP.CPI.TOTL.ZG" } }))]) }));
  await page.goto("/"); await uploadCas(page, makeFundComparisonCasPdf());
  await expect(page.locator(".history-progress-toast")).toHaveCount(0);
  for (const selector of [".chart-card canvas", ".stack-base-canvas"]) {
    const canvas = page.locator(selector).first();
    const count = Number(await canvas.getAttribute("data-visible-points"));
    await wheelZoom(page, canvas);
    await expect.poll(async () => Number(await canvas.getAttribute("data-visible-points"))).toBeLessThan(count);
  }
  const comparison = page.locator(".fund-comparison-shell canvas");
  await expect(comparison).toHaveAttribute("data-visible-start", /\d{4}/);
  const initialSpan = Date.parse((await comparison.getAttribute("data-visible-end"))!) - Date.parse((await comparison.getAttribute("data-visible-start"))!);
  await wheelZoom(page, comparison, "Alt");
  await expect.poll(async () => Date.parse((await comparison.getAttribute("data-visible-end"))!) - Date.parse((await comparison.getAttribute("data-visible-start"))!)).toBeLessThan(initialSpan);
  await page.locator(".inflation-card").scrollIntoViewIfNeeded();
  const inflation = page.locator(".inflation-chart-shell svg");
  await expect(inflation).toBeVisible(); await wheelZoom(page, inflation);
  await expect(inflation).not.toHaveAttribute("data-start-year", "1996");
  for (const selector of [".hero-donut svg", ".allocation-donut svg", ".concentration-donut svg"]) {
    const donut = page.locator(selector); await wheelZoom(page, donut);
    await expect(donut).not.toHaveAttribute("viewBox", "0 0 180 180");
  }
  await page.getByRole("textbox", { name: "Search funds" }).fill("Alpha");
  await page.locator(".fund-name").first().click();
  const nav = page.getByRole("dialog").locator(".nav-activity-shell canvas");
  const count = Number(await nav.getAttribute("data-visible-points")); await wheelZoom(page, nav);
  await expect.poll(async () => Number(await nav.getAttribute("data-visible-points"))).toBeLessThan(count);
});

test("ordinary wheel scroll remains native and Safari gesture events zoom only the plot", async ({ page }) => {
  await openDemo(page);
  const chart = page.locator(".chart-card canvas").first();
  await chart.scrollIntoViewIfNeeded();
  const count = await chart.getAttribute("data-visible-points");
  const cancelled = await chart.evaluate((element) => {
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 });
    element.dispatchEvent(event); return event.defaultPrevented;
  });
  expect(cancelled).toBe(false); await expect(chart).toHaveAttribute("data-visible-points", count!);
  const outside = await page.locator(".dashboard-header").evaluate((element) => {
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true });
    element.dispatchEvent(event); return event.defaultPrevented;
  });
  expect(outside).toBe(false);
  await chart.evaluate((element) => {
    const box = element.getBoundingClientRect();
    for (const [type, scale] of [["gesturestart", 1], ["gesturechange", 3], ["gestureend", 3]] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { scale, clientX: box.x + box.width * .6, clientY: box.y + box.height * .5 });
      element.dispatchEvent(event);
    }
  });
  await expect(chart).not.toHaveAttribute("data-visible-points", count!);
  await page.locator(".chart-card").first().getByRole("button", { name: "All", exact: true }).click();
  await expect(chart).toHaveAttribute("data-visible-points", count!);
  await wheelZoom(page, chart);
  await expect(chart).not.toHaveAttribute("data-visible-points", count!);
  const donut = page.locator(".hero-donut svg");
  await wheelZoom(page, donut);
  await expect(donut).not.toHaveAttribute("viewBox", "0 0 180 180");
  await page.keyboard.down("Control"); await page.mouse.wheel(0, 240); await page.keyboard.up("Control");
  await expect(donut).toHaveAttribute("viewBox", "0 0 180 180");
});

for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 667, height: 375 }]) {
  test(`mobile explorer exposes every tiny allocation at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await mockLatestNav(page, { status: 503 }); await page.goto("/"); await uploadCas(page, makeTinyAllocationCasPdf());
    for (const parent of [".hero-donut", ".allocation-donut", ".concentration-donut"]) {
      await page.locator(parent).getByRole("button", { name: /^Explore / }).click();
      const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
      const rows = dialog.getByRole("group", { name: "All allocations" }).getByRole("button");
      await expect(rows).toHaveCount(2);
      const tiny = rows.filter({ hasText: "<0.01%" }); await tiny.scrollIntoViewIfNeeded();
      expect((await tiny.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await tiny.click();
      await expect(dialog.locator(".allocation-explorer-selection")).toContainText("₹0.01");
      await expect(dialog.locator(".allocation-explorer-selection")).toContainText("<0.01%");
      await dialog.getByRole("button", { name: "Zoom selected", exact: true }).click();
      await expect(dialog.locator("svg")).not.toHaveAttribute("viewBox", "0 0 180 180");
      await dialog.getByRole("button", { name: "Reset", exact: true }).click();
      await expect(dialog.locator("svg")).toHaveAttribute("viewBox", "0 0 180 180");
      await dialog.getByRole("searchbox").fill("no matching allocation");
      await expect(dialog.getByRole("status")).toHaveText("No allocations match your search.");
      await page.goBack(); await expect(dialog).toHaveCount(0);
      await expect(page.locator(".fund-group")).toHaveCount(2);
    }
    await expectNoHorizontalOverflow(page);
  });
}
