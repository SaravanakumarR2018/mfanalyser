import { expect, test } from "@playwright/test";
import { openDemo } from "./helpers/app";

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
  });
});
