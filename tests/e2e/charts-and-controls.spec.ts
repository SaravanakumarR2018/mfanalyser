import { expect, test, type Locator } from "@playwright/test";
import { expectCanvasHasInk, installFailureGuards, openDemo } from "./helpers/app";

async function setRange(locator: Locator, value: number) {
  await locator.evaluate((element: HTMLInputElement, next) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(element, String(next));
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

test.describe("portfolio and stacked chart controls", () => {
  test.beforeEach(async ({ page }) => {
    await openDemo(page);
  });

  test("renders the portfolio journey canvas and its baseline data contract", async ({ page }) => {
    const chart = page.locator('.chart-card canvas[role="img"]').first();
    await expect(chart).toHaveAttribute("data-total-points", "58");
    await expect(chart).toHaveAttribute("data-visible-points", "58");
    await expect(chart).toHaveAttribute("data-daily-points", "0");
    await expect(chart).toHaveAttribute("data-show-invested", "true");
    await expect(chart).toHaveAttribute("aria-label", /Portfolio value chart from Nov 2021 to Jul 2026/);
    await expectCanvasHasInk(chart);
  });

  test("changes portfolio periods, zoom, X range, and invested series", async ({ page }) => {
    const card = page.locator(".chart-card").first();
    const chart = card.locator('canvas[role="img"]');
    const total = Number(await chart.getAttribute("data-total-points"));

    await card.getByRole("button", { name: "1Y", exact: true }).click();
    const oneYear = Number(await chart.getAttribute("data-visible-points"));
    expect(oneYear).toBeGreaterThan(1);
    expect(oneYear).toBeLessThan(total);

    await card.getByRole("button", { name: "Zoom in" }).click();
    const zoomed = Number(await chart.getAttribute("data-visible-points"));
    expect(zoomed).toBeLessThan(oneYear);
    await card.getByRole("button", { name: "Zoom out" }).click();
    expect(Number(await chart.getAttribute("data-visible-points"))).toBeGreaterThanOrEqual(zoomed);

    const start = card.getByRole("slider", { name: "Chart start" });
    await setRange(start, Math.max(1, Number(await start.getAttribute("min")) + 3));
    await expect(chart).not.toHaveAttribute("data-visible-points", String(total));

    const toggle = card.getByRole("button", { name: "Hide net invested line" });
    await toggle.click();
    await expect(card.getByRole("button", { name: "Show net invested line" })).toHaveAttribute("aria-pressed", "false");
    await expect(chart).toHaveAttribute("data-show-invested", "false");
    await expect(card.getByRole("button", { name: "Show net invested line" })).toBeVisible();

    await card.getByRole("button", { name: "All", exact: true }).click();
    await expect(chart).toHaveAttribute("data-visible-points", String(total));
  });

  test("supports pointer tooltips and keyboard movement of a selected X window", async ({ page }) => {
    const card = page.locator(".chart-card").first();
    const chart = card.locator('canvas[role="img"]');
    const box = await chart.boundingBox();
    expect(box).not.toBeNull();
    await chart.hover({ position: { x: (box?.width ?? 100) * 0.55, y: Math.min(120, (box?.height ?? 200) * 0.6) } });
    await expect(card.locator(".chart-tooltip")).toBeVisible();
    await expect(card.locator(".chart-tooltip")).toContainText("₹");

    await card.getByRole("button", { name: "1Y", exact: true }).click();
    const windowSlider = card.getByRole("slider", { name: "Move visible chart window" });
    await windowSlider.focus();
    const before = Number(await windowSlider.getAttribute("aria-valuenow"));
    await windowSlider.press("ArrowLeft");
    await expect(windowSlider).toHaveAttribute("aria-valuenow", String(Math.max(0, before - 1)));
    await expect(windowSlider).toHaveAttribute("aria-valuetext", /to/);

    await windowSlider.scrollIntoViewIfNeeded();
    const dragBox = await windowSlider.boundingBox();
    expect(dragBox).not.toBeNull();
    const beforeDrag = Number(await windowSlider.getAttribute("aria-valuenow"));
    await page.mouse.move((dragBox?.x ?? 0) + (dragBox?.width ?? 0) / 2, (dragBox?.y ?? 0) + (dragBox?.height ?? 0) / 2);
    await page.mouse.down();
    await page.mouse.move((dragBox?.x ?? 0) + Math.max(2, (dragBox?.width ?? 0) / 2 - 100), (dragBox?.y ?? 0) + (dragBox?.height ?? 0) / 2, { steps: 8 });
    await page.mouse.up();
    expect(Number(await windowSlider.getAttribute("aria-valuenow"))).not.toBe(beforeDrag);
  });

  test("combines all four stack modes on one reconciled shared Y axis", async ({ page }) => {
    const stack = page.locator(".fund-stack-card");
    expect(Math.abs(Number(await stack.getAttribute("data-reconciliation-difference")))).toBeLessThan(0.000001);
    await expect(stack.locator(".fund-stack-panel")).toHaveCount(1);

    for (const mode of ["Invested", "Contribution", "Period change"]) {
      await stack.getByRole("button", { name: mode, exact: true }).click();
      await expect(stack.getByRole("button", { name: mode, exact: true })).toHaveAttribute("aria-pressed", "true");
    }
    await expect(stack.locator(".fund-stack-panel")).toHaveCount(4);
    await expect(stack.locator(".stack-chart-meta")).toContainText("4 views selected · shared Y-axis");
    await expect(stack.locator(".stack-chart-meta")).toContainText("Period change and net cash flow start at ₹0");
    await expect(stack.locator('[data-panel-mode="periodChange"]')).toContainText("Net cash flow");

    const scales = await stack.locator(".fund-stack-panel canvas.stack-base-canvas").evaluateAll((canvases) =>
      canvases.map((canvas) => ({
        min: canvas.getAttribute("data-axis-min"),
        max: canvas.getAttribute("data-axis-max"),
        step: canvas.getAttribute("data-axis-step"),
      })),
    );
    expect(scales).toHaveLength(4);
    expect(new Set(scales.map((scale) => JSON.stringify(scale))).size).toBe(1);
    for (const canvas of await stack.locator(".fund-stack-panel canvas.stack-base-canvas").all()) {
      await expectCanvasHasInk(canvas);
    }

    // A selected view cannot be removed when it is the sole remaining panel.
    for (const mode of ["Period change", "Contribution", "Invested"]) {
      await stack.getByRole("button", { name: mode, exact: true }).click();
    }
    await expect(stack.locator(".fund-stack-panel")).toHaveCount(1);
    await stack.getByRole("button", { name: "Value", exact: true }).click();
    await expect(stack.getByRole("button", { name: "Value", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(stack.locator(".fund-stack-panel")).toHaveCount(1);
  });

  test("updates synchronized lens magnification, size, and panel metadata", async ({ page }) => {
    const stack = page.locator(".fund-stack-card");
    const lens = stack.getByRole("button", { name: "Lens", exact: true });
    const magnification = stack.getByRole("slider", { name: "Lens magnification" });
    const size = stack.getByRole("slider", { name: "Lens size" });
    await expect(magnification).toBeDisabled();
    await expect(size).toBeDisabled();

    await lens.click();
    await expect(lens).toHaveAttribute("aria-pressed", "true");
    await expect(magnification).toBeEnabled();
    await setRange(magnification, 4);
    await setRange(size, 200);
    await expect(stack.locator(".fund-stack-panel")).toHaveAttribute("data-lens-enabled", "true");
    await expect(stack.locator(".fund-stack-panel")).toHaveAttribute("data-lens-magnification", "4");
    await expect(stack.locator(".fund-stack-panel")).toHaveAttribute("data-lens-size", "200");
    await expect(stack.locator(".stack-lens-canvas")).toHaveCSS("display", "block");

    const panel = stack.locator(".fund-stack-panel");
    const lensCanvas = panel.locator("canvas.stack-lens-canvas");
    await lensCanvas.scrollIntoViewIfNeeded();
    const box = await lensCanvas.boundingBox();
    expect(box).not.toBeNull();
    const beforeX = await panel.getAttribute("data-lens-x");
    await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
    await page.mouse.down();
    await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2 + 100, (box?.y ?? 0) + (box?.height ?? 0) / 2 + 30, { steps: 6 });
    await page.mouse.up();
    await expect(panel).not.toHaveAttribute("data-lens-x", beforeX ?? "");
  });

  test("changes stacked X and Y axes with sliders and restores full Y", async ({ page }) => {
    const stack = page.locator(".fund-stack-card");
    const panel = stack.locator(".fund-stack-panel");
    const initialVisible = Number(await panel.locator("canvas.stack-base-canvas").getAttribute("data-visible-points"));

    await stack.getByRole("button", { name: "1Y", exact: true }).click();
    expect(Number(await panel.locator("canvas.stack-base-canvas").getAttribute("data-visible-points"))).toBeLessThan(initialVisible);

    const stackedWindow = stack.getByRole("slider", { name: "Move visible stacked chart window" });
    await stackedWindow.focus();
    const beforeX = Number(await stackedWindow.getAttribute("aria-valuenow"));
    await stackedWindow.press("ArrowLeft");
    await expect(stackedWindow).toHaveAttribute("aria-valuenow", String(Math.max(0, beforeX - 1)));

    const yMin = stack.getByRole("slider", { name: "Shared vertical minimum" });
    await setRange(yMin, 250);
    await expect(stack.locator(".stack-y-track")).toHaveAttribute("data-lower", "250");
    await expect(stack.getByRole("button", { name: "Reset shared vertical value range" })).toBeEnabled();
    await stack.getByRole("button", { name: "Reset shared vertical value range" }).click();
    await expect(stack.locator(".stack-y-track")).toHaveAttribute("data-lower", "0");
    await expect(stack.locator(".stack-y-track")).toHaveAttribute("data-upper", "1000");
  });

  test("selects a stacked date by keyboard and renders the complete ranking", async ({ page }) => {
    const stack = page.locator(".fund-stack-card");
    const canvas = stack.locator(".fund-stack-panel canvas.stack-base-canvas");
    await canvas.focus();
    await canvas.press("Enter");

    const ranking = stack.getByRole("region", { name: /Fund ranking on/ });
    await expect(ranking).toBeVisible();
    await expect(ranking.locator(".stack-ranking-row")).toHaveCount(7);
    await expect(ranking).toContainText("Showing all 7 funds");
    await ranking.getByRole("button", { name: "Close fund ranking" }).click();
    await expect(ranking).toHaveCount(0);
  });

  test("drawer NAV chart supports periods, range controls, and hover details", async ({ page }) => {
    const assertNoErrors = await installFailureGuards(page);
    await page.locator(".fund-group .fund-row").first().click();
    const dialog = page.getByRole("dialog", { name: "Aurora Small Cap Direct Growth" });
    const navCard = dialog.locator(".nav-activity-card");
    const navCanvas = navCard.locator('canvas[role="img"]');
    await expect(navCanvas).toHaveAttribute("data-total-points", "1");
    await expectCanvasHasInk(navCanvas);
    await expect(navCard.getByRole("button", { name: "All", exact: true })).toHaveClass(/active/);
    await navCard.getByRole("button", { name: "1Y", exact: true }).click();
    await expect(navCard.getByRole("button", { name: "1Y", exact: true })).toHaveClass(/active/);
    assertNoErrors();
  });
});
