import { expect, test } from "@playwright/test";
import { openDemo, uploadInput, waitForHydration } from "./helpers/app";
import { installFundComparisonMocks, makeFundComparisonCasPdf } from "./helpers/fund-comparison-fixture";

test.describe("stable visual regions", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!["desktop-chromium", "mobile-chromium"].includes(testInfo.project.name), "Canonical goldens are maintained for desktop and mobile Chromium.");
    await page.addInitScript(() => {
      Date.now = () => new Date("2026-08-15T00:00:00Z").getTime();
    });
  });

  test("landing hero", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".hero")).toHaveScreenshot("landing-hero.png", {
      animations: "disabled",
    });
  });

  test("dashboard summary and metrics", async ({ page }) => {
    await openDemo(page);
    await expect(page.locator(".summary-card")).toHaveScreenshot("dashboard-summary.png", {
      animations: "disabled",
    });
    await expect(page.locator(".metric-grid")).toHaveScreenshot("dashboard-metrics.png", {
      animations: "disabled",
    });
  });

  test("portfolio chart and stacked chart visual surfaces contain rendered output", async ({ page }) => {
    await openDemo(page);
    await expect(page.locator(".chart-card").first()).toHaveScreenshot("portfolio-chart.png", {
      animations: "disabled",
    });
    await expect(page.locator(".fund-stack-card")).toHaveScreenshot("fund-stack-chart.png", {
      animations: "disabled",
    });
    await expect(page.locator(".insight-grid")).toHaveScreenshot("allocation-insights.png", {
      animations: "disabled",
      stylePath: "tests/e2e/helpers/visual-snapshot.css",
    });
    await page.locator(".concentration-donut .donut-slice").first().click();
    await expect(page.locator(".donut-tooltip")).toBeVisible();
    await expect(page.locator(".top-funds-card")).toHaveScreenshot("concentration-selected.png", {
      animations: "disabled",
      stylePath: "tests/e2e/helpers/visual-snapshot.css",
    });
  });

  test("normalized fund comparison card", async ({ page }) => {
    await installFundComparisonMocks(page);
    await page.goto("/");
    await waitForHydration(page);
    await uploadInput(page).setInputFiles({
      name: "visual-fund-comparison.pdf",
      mimeType: "application/pdf",
      buffer: makeFundComparisonCasPdf(),
    });
    await expect(page.getByRole("heading", { name: "Your funds" })).toBeVisible();
    const card = page.locator(".fund-comparison-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveAttribute("data-history-state", "ready");
    const comparisonCanvas = card.locator('canvas[role="img"]');
    await expect(comparisonCanvas).toHaveAttribute("data-earliest-history-date", "1990-01-01");
    await expect(comparisonCanvas).toHaveAttribute("data-visible-start", "1990-01-01");
    await expect(card.locator(".fund-comparison-summary")).toContainText("Full published plan history from 1 Jan 1990");
    await expect(page.locator(".history-progress-toast")).toHaveCount(0);
    await expect(card).toHaveScreenshot("fund-comparison-chart.png", {
      animations: "disabled",
    });

    const comparisonBox = await comparisonCanvas.boundingBox();
    expect(comparisonBox).not.toBeNull();
    const first = new Date("1990-01-01T00:00:00Z").getTime();
    const last = new Date("2026-08-14T00:00:00Z").getTime();
    const target = new Date("2024-08-01T00:00:00Z").getTime();
    const plotLeft = Number(await comparisonCanvas.getAttribute("data-plot-left"));
    const plotRight = Number(await comparisonCanvas.getAttribute("data-plot-right"));
    const x = plotLeft + (target - first) / (last - first) * (plotRight - plotLeft);
    const plotTop = Number(await comparisonCanvas.getAttribute("data-plot-top"));
    const plotBottom = Number(await comparisonCanvas.getAttribute("data-plot-bottom"));
    const y = plotTop
      + (256.8 - 180) / (256.8 - 83.2) * ((comparisonBox?.height ?? 404) - plotTop - plotBottom);
    await page.mouse.move((comparisonBox?.x ?? 0) + x, (comparisonBox?.y ?? 0) + y);
    await expect(comparisonCanvas).toHaveAttribute("data-emphasized-fund", "scheme:100001");
    await expect(comparisonCanvas).toHaveAttribute("data-emphasis-mode", "hover");
    await expect(card.locator(".fund-comparison-shell")).toHaveScreenshot("fund-comparison-hover-emphasis.png", {
      animations: "disabled",
    });
    await page.mouse.move((comparisonBox?.x ?? 0) + 3, (comparisonBox?.y ?? 0) + 3);

    await card.getByRole("button", { name: "All 4 funds" }).click();
    const picker = card.getByRole("dialog", { name: "Choose funds to compare" });
    await expect(picker).toBeVisible();
    await expect(picker).toHaveScreenshot("fund-comparison-picker.png", {
      animations: "disabled",
    });
    await page.keyboard.press("Escape");

    const canvas = card.locator('canvas[role="img"]');
    await canvas.focus();
    await canvas.press("ArrowDown");
    const tooltip = card.locator(".fund-comparison-tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveScreenshot("fund-comparison-tooltip.png", {
      animations: "disabled",
    });
  });
});
