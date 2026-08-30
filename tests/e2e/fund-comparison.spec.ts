import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

import {
  expectCanvasHasInk,
  installFailureGuards,
  uploadInput,
  waitForHydration,
} from "./helpers/app";
import {
  COMPARISON_SCHEMES,
  comparisonHistoryPayload,
  fulfillComparisonHistory,
  installFundComparisonMocks,
  makeFundComparisonCasPdf,
  type ComparisonSchemeKey,
} from "./helpers/fund-comparison-fixture";

const cardFor = (page: Page) => page.locator(".fund-comparison-card");

async function expectTooltipTracksPointWithoutCoveringIt(canvas: Locator, tooltip: Locator) {
  await expect(tooltip).toHaveAttribute("data-placement", /^(near-|rail-)/);
  const [canvasBox, tooltipBox, plotTopText, plotBottomText, anchorXText, anchorYText, placement] = await Promise.all([
    canvas.boundingBox(),
    tooltip.boundingBox(),
    canvas.getAttribute("data-plot-top"),
    canvas.getAttribute("data-plot-bottom"),
    tooltip.getAttribute("data-anchor-x"),
    tooltip.getAttribute("data-anchor-y"),
    tooltip.getAttribute("data-placement"),
  ]);
  expect(canvasBox).not.toBeNull();
  expect(tooltipBox).not.toBeNull();
  const plotTop = Number(plotTopText);
  const plotBottom = Number(plotBottomText);
  const anchorX = Number(anchorXText);
  const anchorY = Number(anchorYText);
  expect(Number.isFinite(plotTop)).toBe(true);
  expect(Number.isFinite(plotBottom)).toBe(true);
  expect(Number.isFinite(anchorX)).toBe(true);
  expect(Number.isFinite(anchorY)).toBe(true);
  const localLeft = (tooltipBox?.x ?? 0) - (canvasBox?.x ?? 0);
  const localTop = (tooltipBox?.y ?? 0) - (canvasBox?.y ?? 0);
  const localRight = localLeft + (tooltipBox?.width ?? 0);
  const localBottom = localTop + (tooltipBox?.height ?? 0);
  expect(localLeft).toBeGreaterThanOrEqual(0);
  expect(localTop).toBeGreaterThanOrEqual(0);
  expect(localRight).toBeLessThanOrEqual((canvasBox?.width ?? 0) + 1);
  expect(localBottom).toBeLessThanOrEqual((canvasBox?.height ?? 0) + 1);
  expect(anchorX >= localLeft - 5 && anchorX <= localRight + 5
    && anchorY >= localTop - 5 && anchorY <= localBottom + 5).toBe(false);
  if (placement?.startsWith("near-")) {
    const dx = anchorX < localLeft ? localLeft - anchorX : anchorX > localRight ? anchorX - localRight : 0;
    const dy = anchorY < localTop ? localTop - anchorY : anchorY > localBottom ? anchorY - localBottom : 0;
    expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(150);
  } else if (placement === "rail-top") {
    expect(localBottom).toBeLessThanOrEqual(plotTop - 4);
  } else {
    expect(localTop).toBeGreaterThanOrEqual((canvasBox?.height ?? 0) - plotBottom + 4);
  }
}

async function openComparisonDashboard(
  page: Page,
  onHistory?: (route: Route, key: ComparisonSchemeKey, isFullHistory: boolean) => Promise<void>,
) {
  await installFundComparisonMocks(page, onHistory);
  await page.goto("/");
  await waitForHydration(page);
  await uploadInput(page).setInputFiles({
    name: "fund-comparison-cas.pdf",
    mimeType: "application/pdf",
    buffer: makeFundComparisonCasPdf(),
  });
  await expect(page.getByRole("heading", { name: "Your funds" })).toBeVisible();
  return cardFor(page);
}

async function waitForPreloadedComparison(card: ReturnType<typeof cardFor>) {
  await expect(card).toHaveAttribute("data-history-state", "ready");
  await card.scrollIntoViewIfNeeded();
  return card.locator('canvas[role="img"]');
}

async function setRangeInputValue(
  input: ReturnType<Page["locator"]>,
  value: number,
) {
  await input.evaluate((element, nextValue) => {
    const rangeInput = element as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(rangeInput, String(nextValue));
    rangeInput.dispatchEvent(new Event("input", { bubbles: true }));
    rangeInput.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

test.describe("full-history normalized fund comparison", () => {
  test("queues full histories behind daily enrichment, then preloads offscreen from each fund inception", async ({ page }) => {
    const assertNoErrors = await installFailureGuards(page);
    let releaseDaily!: () => void;
    let releaseComparison!: () => void;
    const dailyGate = new Promise<void>((resolve) => { releaseDaily = resolve; });
    const comparisonGate = new Promise<void>((resolve) => { releaseComparison = resolve; });
    const lifecycle: string[] = [];
    const fullHistoryUrls: string[] = [];
    const requests: Array<{ method: string; url: string; postData: string | null }> = [];
    page.on("request", (request) => requests.push({
      method: request.method(),
      url: request.url(),
      postData: request.postData(),
    }));
    const card = await openComparisonDashboard(page, async (route, key, isFullHistory) => {
      if (isFullHistory) {
        lifecycle.push(`comparison:${key}`);
        fullHistoryUrls.push(route.request().url());
        await comparisonGate;
      } else {
        lifecycle.push(`daily-start:${key}`);
        await dailyGate;
      }
      await fulfillComparisonHistory(route, key);
      if (!isFullHistory) lifecycle.push(`daily-complete:${key}`);
    });

    await expect(card).toHaveAttribute("data-total-funds", "5");
    await expect(card).toHaveAttribute("data-available-funds", "4");
    await expect(card).toHaveAttribute("data-selected-funds", "4");
    await expect(card).toHaveAttribute("data-history-state", "queued");
    await expect(card).toContainText("Comparison preload queued");
    await expect(page.locator(".history-progress-toast")).toBeVisible();
    await expect.poll(() => lifecycle.filter((event) => event.startsWith("daily-start:")).length).toBe(4);
    expect(await card.evaluate((element) => element.getBoundingClientRect().top > window.innerHeight)).toBe(true);
    expect(fullHistoryUrls).toEqual([]);

    releaseDaily();
    await expect(card).toHaveAttribute("data-history-state", "loading");
    await expect(card.locator(".fund-comparison-summary")).toContainText("Loading full NAV histories");
    await expect(page.locator(".history-progress-toast")).toHaveAttribute(
      "aria-label",
      "Daily NAV history 100% loaded",
    );
    await expect(page.locator(".history-progress-toast")).not.toContainText("full NAV histories");
    expect(await card.evaluate((element) => element.getBoundingClientRect().top > window.innerHeight)).toBe(true);
    const firstComparison = lifecycle.findIndex((event) => event.startsWith("comparison:"));
    const lastDailyCompletion = lifecycle.reduce((last, event, index) => (
      event.startsWith("daily-complete:") ? index : last
    ), -1);
    expect(lastDailyCompletion).toBeGreaterThanOrEqual(0);
    expect(firstComparison).toBeGreaterThan(lastDailyCompletion);

    releaseComparison();
    await expect(card).toHaveAttribute("data-history-state", "ready");
    await card.scrollIntoViewIfNeeded();
    const canvas = card.locator('canvas[role="img"]');
    await expect(card).toHaveAttribute("data-loaded-funds", "4");
    await expect(card).toHaveAttribute("data-failed-funds", "0");
    await expect(card.locator(".fund-comparison-summary")).toContainText("Full published plan history from 1 Jan 1990");
    await expect(canvas).toHaveAttribute("data-baseline", "100");
    await expect(canvas).toHaveAttribute("data-earliest-history-date", "1990-01-01");
    await expect(canvas).toHaveAttribute("data-series-start-dates", "2020-01-02,2021-01-04,2022-01-03,1990-01-01");
    await expect(canvas).toHaveAttribute("data-series-baselines", "100,100,100,100");
    await expect(canvas).toHaveAttribute("data-visible-start", "1990-01-01");
    await expect(canvas).toHaveAttribute("data-visible-funds", "4");
    await expect(canvas).toHaveAttribute("data-y-axis-sides", "left,right");
    await expect(canvas).toHaveAttribute(
      "data-y-axis-ticks",
      "₹256.8 +156.8%|₹213.4 +113.4%|₹170 +70%|₹126.6 +26.6%|₹83.2 −16.8%",
    );
    await expect(canvas).toHaveAttribute("aria-label", /Both Y axes show the same indexed rupee values and signed percentage change from ₹100/);
    await expect(card.locator(".fund-comparison-note")).toContainText("Direct-plan records commonly begin in January 2013");
    await expect(canvas).not.toHaveAttribute("data-investment-points", /.+/);
    await expect(card.locator(".fund-comparison-legend")).toHaveCount(0);
    await expectCanvasHasInk(canvas);

    await card.getByRole("button", { name: "All 4 funds" }).click();
    const picker = card.getByRole("dialog", { name: "Choose funds to compare" });
    await expect(picker.getByRole("checkbox")).toHaveCount(6);
    await expect(picker.getByRole("button", { name: "Select all", exact: true })).toHaveCount(0);
    await expect(picker.getByRole("button", { name: "Clear all", exact: true })).toHaveCount(0);
    await expect(picker.getByRole("checkbox", { name: /Unmatched Equity/ })).toBeDisabled();
    await expect(picker.getByText("Published history unavailable", { exact: true })).toBeVisible();

    expect(fullHistoryUrls).toHaveLength(4);
    for (const requestUrl of fullHistoryUrls) {
      const url = new URL(requestUrl);
      expect(url.pathname).toBe("/api/nav-history");
      expect(url.searchParams.get("startDate")).toBe("1900-01-01");
      expect(url.searchParams.get("endDate")).toBe("2026-08-14");
      expect(Object.values(COMPARISON_SCHEMES).some((scheme) => requestUrl.includes(scheme.name))).toBe(false);
      expect(requestUrl).not.toContain("INF");
    }
    expect(requests.filter((request) => !["GET", "HEAD"].includes(request.method))).toEqual([]);
    expect(requests.some((request) => request.postData?.includes("Consolidated Account Statement"))).toBe(false);
    assertNoErrors();
  });

  test("left-aligned picker search preserves selection and its all-funds checkbox controls every fund", async ({ page }) => {
    const card = await openComparisonDashboard(page);
    const canvas = await waitForPreloadedComparison(card);
    const trigger = card.getByRole("button", { name: "All 4 funds" });
    const cardBox = await card.boundingBox();
    const summaryBox = await card.locator(".fund-comparison-summary").boundingBox();
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox?.x ?? Infinity).toBeLessThan((cardBox?.x ?? 0) + 70);
    expect(triggerBox?.y ?? 0).toBeGreaterThanOrEqual((summaryBox?.y ?? 0) + (summaryBox?.height ?? 0));
    await trigger.click();
    const picker = card.getByRole("dialog", { name: "Choose funds to compare" });
    const search = picker.getByRole("searchbox", { name: "Search funds to compare" });
    const allFunds = picker.getByRole("checkbox", { name: "All funds" });
    const firstFundCheckbox = picker.getByRole("checkbox", { name: /Alpha Flexi Cap/ });

    await expect(allFunds).toBeChecked();
    const allFundsBox = await allFunds.boundingBox();
    const firstFundBox = await firstFundCheckbox.boundingBox();
    expect(Math.abs((allFundsBox?.x ?? 0) - (firstFundBox?.x ?? Infinity))).toBeLessThanOrEqual(1);
    await expect(picker.getByRole("checkbox", { checked: true })).toHaveCount(5);
    await search.fill("gamma");
    await expect(picker.getByText("1 fund shown", { exact: true })).toBeVisible();
    await expect(card).toHaveAttribute("data-selected-funds", "4");
    await search.fill("does-not-exist");
    await expect(picker).toContainText("Your existing selections are unchanged");
    await expect(card).toHaveAttribute("data-selected-funds", "4");

    await search.fill("");
    await allFunds.uncheck();
    await expect(card).toHaveAttribute("data-selected-funds", "0");
    await expect(card.getByText("No funds selected", { exact: true })).toBeVisible();
    await allFunds.check();
    await expect(card).toHaveAttribute("data-selected-funds", "4");
    await expect(canvas).toHaveAttribute("data-earliest-history-date", "1990-01-01");

    await allFunds.uncheck();
    await picker.getByRole("checkbox", { name: /Alpha Flexi Cap/ }).check();
    await expect(card).toHaveAttribute("data-selected-funds", "1");
    await expect(canvas).toHaveAttribute("data-visible-funds", "1");
    await expect(canvas).toHaveAttribute("data-earliest-history-date", "2020-01-02");
    await expect(allFunds).toHaveJSProperty("indeterminate", true);

    await picker.getByRole("checkbox", { name: /Alpha Flexi Cap/ }).uncheck();
    await picker.getByRole("checkbox", { name: /Gamma Small Cap/ }).check();
    await expect(canvas).toHaveAttribute("data-earliest-history-date", "2022-01-03");
    await search.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(card.getByRole("button", { name: "1 of 4 funds" })).toBeFocused();
  });

  test("pointer hover uses nearby lines while a selected fund tracks freely across its timeline", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const card = await openComparisonDashboard(page);
    const canvas = await waitForPreloadedComparison(card);
    await expect(canvas).toHaveAttribute("data-resting-line-width", "1.15");
    await expect(canvas).toHaveAttribute("data-emphasized-line-width", "3.2");
    await expect(canvas).toHaveAttribute("data-dimmed-line-width", "0.85");
    await expect(canvas).toHaveAttribute("data-active-line-width", "1.15");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const plotTop = Number(await canvas.getAttribute("data-plot-top"));
    const plotBottom = Number(await canvas.getAttribute("data-plot-bottom"));
    const plotLeft = Number(await canvas.getAttribute("data-plot-left"));
    const plotRight = Number(await canvas.getAttribute("data-plot-right"));
    expect(Number.isFinite(plotTop)).toBe(true);
    expect(Number.isFinite(plotBottom)).toBe(true);
    expect(Number.isFinite(plotLeft)).toBe(true);
    expect(Number.isFinite(plotRight)).toBe(true);
    expect(plotLeft).toBeGreaterThanOrEqual(40);
    expect(Math.abs(plotLeft - ((box?.width ?? 0) - plotRight))).toBeLessThanOrEqual(1);
    const first = new Date("1990-01-01T00:00:00Z").getTime();
    const last = new Date("2026-08-14T00:00:00Z").getTime();
    const target = new Date("2024-08-01T00:00:00Z").getTime();
    const betweenTargets = new Date("2024-10-01T00:00:00Z").getTime();
    const laterTarget = new Date("2025-08-14T00:00:00Z").getTime();
    const beforeGammaInception = new Date("2020-01-02T00:00:00Z").getTime();
    const x = plotLeft + (target - first) / (last - first) * (plotRight - plotLeft);
    const betweenX = plotLeft + (betweenTargets - first) / (last - first) * (plotRight - plotLeft);
    const laterX = plotLeft + (laterTarget - first) / (last - first) * (plotRight - plotLeft);
    const beforeGammaX = plotLeft + (beforeGammaInception - first) / (last - first) * (plotRight - plotLeft);
    const low = 83.2;
    const high = 256.8;
    const yFor = (value: number) => plotTop
      + (high - value) / (high - low) * ((box?.height ?? 404) - plotTop - plotBottom);

    await page.mouse.move((box?.x ?? 0) + x, (box?.y ?? 0) + yFor(180));
    await expect(canvas).toHaveAttribute("data-hover-fund", "scheme:100001");
    await expect(canvas).toHaveAttribute("data-emphasized-fund", "scheme:100001");
    await expect(canvas).toHaveAttribute("data-emphasis-mode", "hover");
    await expect(canvas).toHaveAttribute("data-dimmed-funds", "3");
    await expect(canvas).toHaveAttribute("data-active-line-width", "3.2");
    await expect(canvas).toHaveAttribute("data-hover-date", "2024-08-01");
    await expect(canvas).toHaveAttribute("data-tooltip-fund-count", "1");
    await expect(canvas).toHaveAttribute("data-guide-date", "2024-08-01");
    await expect(canvas).toHaveAttribute("data-guide-visible", "true");
    await expect(canvas).toHaveAttribute("data-pointer-track-mode", "line-hover");
    const tooltip = card.locator(".fund-comparison-tooltip");
    await expect(tooltip).toContainText("Alpha Flexi Cap");
    await expect(tooltip).toContainText("NAV₹18.0000");
    await expect(tooltip).toContainText("₹100 value₹180.00");
    await expect(tooltip).not.toContainText("Beta Mid Cap");
    await expect.poll(() => tooltip.evaluate((element) => {
      const style = getComputedStyle(element);
      return `${style.transitionProperty}:${style.transitionDuration}`;
    })).toBe("transform:0.07s");
    expect((await tooltip.boundingBox())?.width ?? Infinity).toBeLessThanOrEqual(324);
    await expectTooltipTracksPointWithoutCoveringIt(canvas, tooltip);
    const alphaLayout = await tooltip.evaluate((element) => ({
      anchorY: Number(element.getAttribute("data-anchor-y")),
      left: element.getAttribute("data-layout-left"),
      placement: element.getAttribute("data-placement"),
      top: element.getAttribute("data-layout-top"),
    }));

    await page.mouse.move((box?.x ?? 0) + x, (box?.y ?? 0) + yFor(160));
    await expect(canvas).toHaveAttribute("data-hover-fund", "scheme:100003");
    await expect(canvas).toHaveAttribute("data-emphasized-fund", "scheme:100003");
    await expect(canvas).toHaveAttribute("data-emphasis-mode", "hover");
    await expect(tooltip).toContainText("Gamma Small Cap");
    await expect(tooltip).toContainText("NAV₹8.0000");
    await expect(tooltip).toContainText("₹100 value₹160.00");
    await expect(tooltip).not.toContainText("Alpha Flexi Cap");
    await expectTooltipTracksPointWithoutCoveringIt(canvas, tooltip);
    const gammaLayout = await tooltip.evaluate((element) => ({
      anchorY: Number(element.getAttribute("data-anchor-y")),
      left: element.getAttribute("data-layout-left"),
      placement: element.getAttribute("data-placement"),
      top: element.getAttribute("data-layout-top"),
    }));
    expect(Math.abs(gammaLayout.anchorY - alphaLayout.anchorY)).toBeGreaterThan(10);
    expect(gammaLayout.left !== alphaLayout.left
      || gammaLayout.top !== alphaLayout.top
      || gammaLayout.placement !== alphaLayout.placement).toBe(true);

    await page.mouse.move((box?.x ?? 0) + 3, (box?.y ?? 0) + 3);
    await expect(canvas).toHaveAttribute("data-hover-fund", "");
    await expect(canvas).toHaveAttribute("data-emphasized-fund", "");
    await expect(canvas).toHaveAttribute("data-emphasis-mode", "none");
    await expect(canvas).toHaveAttribute("data-dimmed-funds", "0");
    await expect(canvas).toHaveAttribute("data-active-line-width", "1.15");
    await expect(canvas).toHaveAttribute("data-guide-visible", "false");
    await expect(canvas).toHaveAttribute("data-pointer-track-mode", "none");
    await page.mouse.move((box?.x ?? 0) + x, (box?.y ?? 0) + yFor(160));
    await expect(canvas).toHaveAttribute("data-hover-fund", "scheme:100003");

    await canvas.click({ position: { x, y: yFor(160) } });
    await expect(canvas).toHaveAttribute("data-focused-fund", "scheme:100003");
    await expect(canvas).toHaveAttribute("data-emphasized-fund", "scheme:100003");
    await expect(canvas).toHaveAttribute("data-emphasis-mode", "focus");
    await expect(canvas).toHaveAttribute("data-active-line-width", "3.2");
    await page.mouse.move((box?.x ?? 0) + x, (box?.y ?? 0) + yFor(180));
    await expect(canvas).toHaveAttribute("data-hover-fund", "scheme:100003");
    await expect(canvas).toHaveAttribute("data-hover-date", "2024-08-01");
    await expect(canvas).toHaveAttribute("data-tooltip-fund-count", "1");
    await expect(canvas).toHaveAttribute("data-guide-date", "2024-08-01");
    await expect(canvas).toHaveAttribute("data-guide-visible", "true");
    await expect(canvas).toHaveAttribute("data-pointer-track-mode", "focused-timeline");
    await expect(tooltip).toContainText("Gamma Small Cap");
    await expect(tooltip).toContainText("NAV₹8.0000");
    const focusedAnchorX = Number(await tooltip.getAttribute("data-anchor-x"));
    await page.mouse.move((box?.x ?? 0) + x, (box?.y ?? 0) + plotTop + 5);
    await expect(canvas).toHaveAttribute("data-hover-fund", "scheme:100003");
    await expect(canvas).toHaveAttribute("data-tooltip-fund-count", "1");
    await expect(canvas).toHaveAttribute("data-pointer-track-mode", "focused-timeline");
    await page.mouse.move((box?.x ?? 0) + betweenX, (box?.y ?? 0) + plotTop + 5);
    await expect(canvas).toHaveAttribute("data-hover-fund", "scheme:100003");
    await expect(canvas).toHaveAttribute("data-hover-date", "2024-08-01");
    await expect(canvas).toHaveAttribute("data-guide-date", "2024-08-01");
    await expect(tooltip).toContainText("NAV₹8.0000");
    await page.mouse.move((box?.x ?? 0) + laterX, (box?.y ?? 0) + plotTop + 5);
    await expect(canvas).toHaveAttribute("data-hover-fund", "scheme:100003");
    await expect(canvas).toHaveAttribute("data-hover-date", "2025-08-14");
    await expect(canvas).toHaveAttribute("data-guide-date", "2025-08-14");
    await expect(tooltip).toContainText("Gamma Small Cap");
    await expect(tooltip).toContainText("NAV₹10.0000");
    await expect(tooltip).toContainText("₹100 value₹200.00");
    await expectTooltipTracksPointWithoutCoveringIt(canvas, tooltip);
    expect(Math.abs(Number(await tooltip.getAttribute("data-anchor-x")) - focusedAnchorX)).toBeGreaterThan(5);
    const focusedRelativeOffset = await tooltip.evaluate((element) => ({
      x: Number(element.getAttribute("data-layout-left")) - Number(element.getAttribute("data-anchor-x")),
      y: Number(element.getAttribute("data-layout-top")) - Number(element.getAttribute("data-anchor-y")),
    }));
    await page.mouse.move((box?.x ?? 0) + x, (box?.y ?? 0) + plotTop + 5);
    await expect(canvas).toHaveAttribute("data-hover-date", "2024-08-01");
    const returnedRelativeOffset = await tooltip.evaluate((element) => ({
      x: Number(element.getAttribute("data-layout-left")) - Number(element.getAttribute("data-anchor-x")),
      y: Number(element.getAttribute("data-layout-top")) - Number(element.getAttribute("data-anchor-y")),
    }));
    expect(returnedRelativeOffset.x).toBeCloseTo(focusedRelativeOffset.x, 6);
    expect(returnedRelativeOffset.y).toBeCloseTo(focusedRelativeOffset.y, 6);
    await expect(canvas).toHaveAttribute("data-focused-fund", "scheme:100003");
    await expect(canvas).toHaveAttribute("data-emphasized-fund", "scheme:100003");

    await page.mouse.move((box?.x ?? 0) + beforeGammaX, (box?.y ?? 0) + plotTop + 5);
    await expect(canvas).toHaveAttribute("data-hover-fund", "");
    await expect(canvas).toHaveAttribute("data-guide-visible", "false");
    await expect(canvas).toHaveAttribute("data-pointer-track-mode", "none");
    await expect(canvas).toHaveAttribute("data-focused-fund", "scheme:100003");
    await expect(canvas).toHaveAttribute("data-emphasized-fund", "scheme:100003");
    await expect(canvas).toHaveAttribute("data-emphasis-mode", "focus");
    await page.mouse.move((box?.x ?? 0) + laterX, (box?.y ?? 0) + 3);
    await expect(canvas).toHaveAttribute("data-hover-fund", "");
    await expect(canvas).toHaveAttribute("data-guide-visible", "false");
    await expect(canvas).toHaveAttribute("data-focused-fund", "scheme:100003");

    await canvas.click({ position: { x, y: yFor(180) } });
    await expect(canvas).toHaveAttribute("data-focused-fund", "scheme:100001");
    await canvas.click({ position: { x: 3, y: 3 } });
    await expect(canvas).toHaveAttribute("data-focused-fund", "");
    await expect(canvas).toHaveAttribute("data-hover-fund", "");
    await expect(canvas).toHaveAttribute("data-emphasized-fund", "");
    await expect(canvas).toHaveAttribute("data-emphasis-mode", "none");

    await canvas.focus();
    await canvas.press("ArrowDown");
    await expect(canvas).toHaveAttribute("data-focused-fund", "scheme:100001");
    await canvas.press("ArrowDown");
    await expect(canvas).toHaveAttribute("data-focused-fund", "scheme:100002");
    await canvas.press("End");
    await expect(canvas).toHaveAttribute("data-tooltip-fund-count", "1");
    await expect(tooltip).toContainText("Beta Mid Cap");
    await canvas.press("Escape");
    await expect(canvas).toHaveAttribute("data-focused-fund", "");
    await expect(canvas).toHaveAttribute("data-hover-date", "");
    await expect(card.locator(".fund-comparison-live")).toHaveText("All selected fund lines are active.");
  });

  test("partial failure retains cached successes and Retry requests only the failed history", async ({ page }) => {
    let betaShouldFail = true;
    const fullRequestCounts = new Map<ComparisonSchemeKey, number>();
    const card = await openComparisonDashboard(page, async (route, key, isFullHistory) => {
      if (isFullHistory) fullRequestCounts.set(key, (fullRequestCounts.get(key) ?? 0) + 1);
      if (isFullHistory && key === "beta" && betaShouldFail) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "SUCCESS", meta: { scheme_code: COMPARISON_SCHEMES.beta.code }, data: [] }),
        });
        return;
      }
      await fulfillComparisonHistory(route, key);
    });

    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveAttribute("data-history-state", "partial");
    await expect(card).toHaveAttribute("data-loaded-funds", "3");
    await expect(card).toHaveAttribute("data-failed-funds", "1");
    await expect(card.locator(".fund-comparison-summary")).toContainText("3 histories ready");
    await expect(card.locator('canvas[role="img"]')).toHaveAttribute("data-visible-funds", "3");

    await card.getByRole("button", { name: /3 of 4 funds|All 4 funds/ }).click();
    await expect(card.locator(".fund-comparison-option").filter({ hasText: "Beta Mid Cap" })).toContainText("Retry needed");
    await card.getByRole("button", { name: "Close fund selector" }).click();
    betaShouldFail = false;
    await card.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(card).toHaveAttribute("data-history-state", "ready");
    await expect(card).toHaveAttribute("data-loaded-funds", "4");
    await expect(card).toHaveAttribute("data-failed-funds", "0");
    await expect(card.locator('canvas[role="img"]')).toHaveAttribute("data-visible-funds", "4");
    expect(fullRequestCounts.get("alpha")).toBe(1);
    expect(fullRequestCounts.get("gamma")).toBe(1);
    expect(fullRequestCounts.get("delta")).toBe(1);
    expect(fullRequestCounts.get("beta")).toBe(2);
  });

  test("a one-publication mirror lag still loads every eligible comparison history", async ({ page }) => {
    const card = await openComparisonDashboard(page, async (route, key, isFullHistory) => {
      if (!isFullHistory) {
        await fulfillComparisonHistory(route, key);
        return;
      }
      const payload = comparisonHistoryPayload(key);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...payload,
          data: payload.data.filter((point) => point.date !== "14-08-2026"),
        }),
      });
    });

    await expect(card).toHaveAttribute("data-history-state", "ready");
    await expect(card).toHaveAttribute("data-loaded-funds", "4");
    await expect(card).toHaveAttribute("data-failed-funds", "0");
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('canvas[role="img"]')).toHaveAttribute("data-visible-end", "2026-08-14");
  });

  test("1Y, 3Y, 5Y, 8Y, 10Y, All, and every range control update exact endpoints", async ({ page }) => {
    const card = await openComparisonDashboard(page);
    const canvas = await waitForPreloadedComparison(card);

    for (const [period, start] of [
      ["1Y", "2025-08-14"],
      ["3Y", "2024-08-01"],
      ["5Y", "2022-01-03"],
      ["8Y", "2019-01-01"],
      ["10Y", "2019-01-01"],
      ["All", "1990-01-01"],
    ] as const) {
      await card.getByRole("button", { name: period, exact: true }).click();
      await expect(card.getByRole("button", { name: period, exact: true })).toHaveClass(/active/);
      await expect(canvas).toHaveAttribute("data-visible-start", start);
      await expect(canvas).toHaveAttribute("data-visible-end", "2026-08-14");
      await expect(canvas).toHaveAttribute("data-series-baselines", "100,100,100,100");
    }

    await card.getByRole("button", { name: "3Y", exact: true }).click();
    await expect(card.getByRole("button", { name: "3Y", exact: true })).toHaveClass(/active/);
    await expect(canvas).toHaveAttribute("data-visible-start", "2024-08-01");
    await expect(canvas).toHaveAttribute("data-visible-end", "2026-08-14");
    await expect(canvas).toHaveAttribute("data-visible-series-start-dates", "2024-08-01,2024-08-01,2024-08-01,2024-08-01");
    await canvas.focus();
    await canvas.press("ArrowDown");
    await canvas.press("Home");
    await expect(card.locator(".fund-comparison-tooltip")).toContainText("₹100 value₹100.00");
    await expect(card.locator(".fund-comparison-tooltip")).toContainText("+0.00% within the selected range");
    await canvas.press("Escape");

    const window = card.getByRole("slider", { name: "Move visible fund comparison window" });
    await window.focus();
    await window.press("ArrowLeft");
    await expect(canvas).toHaveAttribute("data-visible-start", "2023-06-15");
    await expect(canvas).toHaveAttribute("data-visible-end", "2025-08-14");
    await expect(canvas).toHaveAttribute("data-visible-series-start-dates", "2023-06-15,2024-08-01,2023-06-15,2023-06-15");
    await expect(canvas).toHaveAttribute("data-series-baselines", "100,100,100,100");
    await expect(window).toHaveAttribute("aria-valuetext", /15 Jun 2023 to 14 Aug 2025/);

    const windowBox = await window.boundingBox();
    const trackBox = await card.locator(".fund-comparison-range .range-track").boundingBox();
    expect(windowBox).not.toBeNull();
    expect(trackBox).not.toBeNull();
    const windowCenterX = (windowBox?.x ?? 0) + (windowBox?.width ?? 0) / 2;
    const windowCenterY = (windowBox?.y ?? 0) + (windowBox?.height ?? 0) / 2;
    const oneDateStep = (trackBox?.width ?? 0) / 8;
    await page.mouse.move(windowCenterX, windowCenterY);
    await page.mouse.down();
    await page.mouse.move(windowCenterX - oneDateStep * 1.05, windowCenterY, { steps: 4 });
    await page.mouse.up();
    await expect(canvas).toHaveAttribute("data-visible-start", "2022-01-03");
    await expect(canvas).toHaveAttribute("data-visible-end", "2024-08-01");
    await expect(canvas).toHaveAttribute("data-visible-series-start-dates", "2022-01-03,2022-01-03,2022-01-03,2022-01-03");
    await expect(canvas).toHaveAttribute("data-series-baselines", "100,100,100,100");

    await card.getByRole("button", { name: "All", exact: true }).click();
    await expect(canvas).toHaveAttribute("data-visible-start", "1990-01-01");
    await expect(canvas).toHaveAttribute("data-visible-end", "2026-08-14");
    const start = card.getByRole("slider", { name: "Fund comparison start" });
    await start.focus();
    await start.press("ArrowRight");
    await expect(canvas).toHaveAttribute("data-visible-start", "2019-01-01");
    await expect(canvas).toHaveAttribute("data-visible-series-start-dates", "2020-01-02,2021-01-04,2022-01-03,2019-01-01");
    await expect(canvas).toHaveAttribute("data-series-baselines", "100,100,100,100");
    const end = card.getByRole("slider", { name: "Fund comparison end" });
    await end.focus();
    await end.press("ArrowLeft");
    await expect(canvas).toHaveAttribute("data-visible-end", "2025-08-14");
    await expect(canvas).toHaveAttribute("data-series-baselines", "100,100,100,100");

    await card.getByRole("button", { name: "All", exact: true }).click();
    await canvas.focus();
    await canvas.press("ArrowDown");
    await canvas.press("ArrowDown");
    await canvas.press("ArrowDown");
    await expect(canvas).toHaveAttribute("data-focused-fund", "scheme:100003");
    await expect(canvas).toHaveAttribute("data-locked-fund", "scheme:100003");
    await end.focus();
    await end.press("ArrowLeft");
    await expect(canvas).toHaveAttribute("data-visible-end", "2025-08-14");
    await expect(canvas).toHaveAttribute("data-focused-fund", "scheme:100003");
    await expect(canvas).toHaveAttribute("data-locked-fund", "scheme:100003");
    for (let step = 0; step < 4; step += 1) await end.press("ArrowLeft");
    await expect(canvas).toHaveAttribute("data-visible-end", "2021-01-04");
    await expect(canvas).toHaveAttribute("data-visible-funds", "3");
    await expect(canvas).toHaveAttribute("data-focused-fund", "");
    await expect(canvas).toHaveAttribute("data-locked-fund", "scheme:100003");
    await expect(canvas).toHaveAttribute("data-hover-fund", "");
    await expect(canvas).toHaveAttribute("data-series-baselines", "100,100,100");
    for (let step = 0; step < 5; step += 1) await end.press("ArrowRight");
    await expect(canvas).toHaveAttribute("data-visible-end", "2026-08-14");
    await expect(canvas).toHaveAttribute("data-focused-fund", "scheme:100003");
    await expect(canvas).toHaveAttribute("data-emphasis-mode", "focus");
  });

  test("a custom horizontal window and its locked fund survive range and selection changes", async ({ page }) => {
    const card = await openComparisonDashboard(page);
    const canvas = await waitForPreloadedComparison(card);
    await card.getByRole("button", { name: "3Y", exact: true }).click();
    await canvas.focus();
    await canvas.press("ArrowDown");
    await expect(canvas).toHaveAttribute("data-focused-fund", "scheme:100001");
    const window = card.getByRole("slider", { name: "Move visible fund comparison window" });
    await window.focus();
    await window.press("ArrowLeft");
    await expect(canvas).toHaveAttribute("data-visible-start", "2023-06-15");
    await expect(canvas).toHaveAttribute("data-visible-end", "2025-08-14");
    await expect(canvas).toHaveAttribute("data-focused-fund", "scheme:100001");
    await expect(canvas).toHaveAttribute("data-locked-fund", "scheme:100001");

    await card.getByRole("button", { name: "All 4 funds" }).click();
    const picker = card.getByRole("dialog", { name: "Choose funds to compare" });
    await picker.getByRole("checkbox", { name: /Beta Mid Cap/ }).uncheck();
    await picker.getByRole("checkbox", { name: /Delta Value/ }).uncheck();
    await expect(card).toHaveAttribute("data-selected-funds", "2");
    await expect(canvas).toHaveAttribute("data-visible-start", "2023-06-15");
    await expect(canvas).toHaveAttribute("data-visible-end", "2025-08-14");
    await expect(canvas).toHaveAttribute("data-visible-funds", "2");
    await expect(canvas).toHaveAttribute("data-series-baselines", "100,100");
    await expect(canvas).toHaveAttribute("data-focused-fund", "scheme:100001");
    await expect(card.getByRole("button", { name: "3Y", exact: true })).not.toHaveClass(/active/);
    await expect(card.getByRole("button", { name: "All", exact: true })).not.toHaveClass(/active/);

    await picker.getByRole("checkbox", { name: /Beta Mid Cap/ }).check();
    await expect(card).toHaveAttribute("data-selected-funds", "3");
    await expect(canvas).toHaveAttribute("data-visible-start", "2023-06-15");
    await expect(canvas).toHaveAttribute("data-visible-end", "2025-08-14");
    await expect(canvas).toHaveAttribute("data-visible-funds", "3");
    await expect(canvas).toHaveAttribute("data-series-baselines", "100,100,100");
    await expect(canvas).toHaveAttribute("data-focused-fund", "scheme:100001");
  });

  test("shared vertical slider supports min, max, keyboard, pointer drag, and Full Y reset", async ({ page }) => {
    const card = await openComparisonDashboard(page);
    const canvas = await waitForPreloadedComparison(card);
    const reset = card.getByRole("button", { name: "Reset shared vertical value range" });
    const minimum = card.getByRole("slider", { name: "Shared vertical minimum" });
    const maximum = card.getByRole("slider", { name: "Shared vertical maximum" });
    const window = card.getByRole("slider", { name: "Move shared vertical value window" });

    await expect(reset).toBeDisabled();
    await expect(canvas).toHaveAttribute("data-axis-min", "83.2");
    await expect(canvas).toHaveAttribute("data-axis-max", "256.8");
    await expect(canvas).toHaveAttribute("data-vertical-lower", "0");
    await expect(canvas).toHaveAttribute("data-vertical-upper", "1000");

    await setRangeInputValue(maximum, 750);
    await expect(reset).toBeEnabled();
    expect(Number(await canvas.getAttribute("data-axis-min"))).toBeCloseTo(83.2, 6);
    expect(Number(await canvas.getAttribute("data-axis-max"))).toBeCloseTo(213.4, 6);
    await setRangeInputValue(minimum, 250);
    expect(Number(await canvas.getAttribute("data-axis-min"))).toBeCloseTo(126.6, 6);
    expect(Number(await canvas.getAttribute("data-axis-max"))).toBeCloseTo(213.4, 6);
    await expect(window).toHaveAttribute("aria-valuetext", "₹127 to ₹213");

    await window.focus();
    await window.press("ArrowUp");
    await expect(canvas).toHaveAttribute("data-vertical-lower", "255");
    await expect(canvas).toHaveAttribute("data-vertical-upper", "755");
    const beforePointerLower = Number(await canvas.getAttribute("data-vertical-lower"));
    const windowBox = await window.boundingBox();
    expect(windowBox).not.toBeNull();
    const centerX = (windowBox?.x ?? 0) + (windowBox?.width ?? 0) / 2;
    const centerY = (windowBox?.y ?? 0) + (windowBox?.height ?? 0) / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX, centerY - 12, { steps: 4 });
    await page.mouse.up();
    expect(Number(await canvas.getAttribute("data-vertical-lower"))).toBeGreaterThan(beforePointerLower);
    expect(
      Number(await canvas.getAttribute("data-vertical-upper"))
      - Number(await canvas.getAttribute("data-vertical-lower")),
    ).toBe(500);

    await reset.click();
    await expect(reset).toBeDisabled();
    await expect(canvas).toHaveAttribute("data-vertical-lower", "0");
    await expect(canvas).toHaveAttribute("data-vertical-upper", "1000");
    await expect(canvas).toHaveAttribute("data-axis-min", "83.2");
    await expect(canvas).toHaveAttribute("data-axis-max", "256.8");
    await expectCanvasHasInk(canvas);
  });

  test("clearing selection during a delayed bulk load is final when stale responses complete", async ({ page }) => {
    let releaseBulk!: () => void;
    const bulkGate = new Promise<void>((resolve) => { releaseBulk = resolve; });
    const card = await openComparisonDashboard(page, async (route, key, isFullHistory) => {
      if (isFullHistory) await bulkGate;
      await fulfillComparisonHistory(route, key);
    });

    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveAttribute("data-history-state", "loading");
    await card.getByRole("button", { name: "All 4 funds" }).click();
    await card.getByRole("checkbox", { name: "All funds" }).uncheck();
    await expect(card).toHaveAttribute("data-selected-funds", "0");

    releaseBulk();
    await expect(card).toHaveAttribute("data-history-state", "ready");
    await expect(card).toHaveAttribute("data-loaded-funds", "4");
    await expect(card).toHaveAttribute("data-selected-funds", "0");
    await expect(card.getByText("No funds selected", { exact: true })).toBeVisible();
    await expect(card.locator('canvas[role="img"]')).toHaveCount(0);
  });

  test("a total history failure is retryable without changing portfolio values", async ({ page }) => {
    let shouldFail = true;
    const card = await openComparisonDashboard(page, async (route, key, isFullHistory) => {
      if (isFullHistory && shouldFail) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "SUCCESS", meta: { scheme_code: COMPARISON_SCHEMES[key].code }, data: [] }),
        });
        return;
      }
      await fulfillComparisonHistory(route, key);
    });
    const portfolioValueBefore = await page.locator(".summary-exact-value").textContent();

    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveAttribute("data-history-state", "error");
    await expect(card).toHaveAttribute("data-loaded-funds", "0");
    await expect(card).toHaveAttribute("data-failed-funds", "4");
    await expect(card).toContainText("Published histories could not be loaded");
    shouldFail = false;
    await card.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(card).toHaveAttribute("data-history-state", "ready");
    await expect(card.locator('canvas[role="img"]')).toHaveAttribute("data-visible-funds", "4");
    await expect(page.locator(".summary-exact-value")).toHaveText(portfolioValueBefore ?? "");
  });
});
