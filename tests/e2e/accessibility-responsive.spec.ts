import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { expectNoHorizontalOverflow, openDemo, uploadInput, waitForHydration } from "./helpers/app";
import { installFundComparisonMocks, makeFundComparisonCasPdf } from "./helpers/fund-comparison-fixture";

const blockingViolations = (violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) =>
  violations.filter((violation) => violation.impact === "critical");

const violationSummary = (violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) =>
  violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(" ")),
  }));

async function openFundComparison(page: Parameters<typeof installFundComparisonMocks>[0]) {
  await installFundComparisonMocks(page);
  await page.goto("/");
  await waitForHydration(page);
  await uploadInput(page).setInputFiles({
    name: "accessible-fund-comparison.pdf",
    mimeType: "application/pdf",
    buffer: makeFundComparisonCasPdf(),
  });
  await expect(page.getByRole("heading", { name: "Your funds" })).toBeVisible();
  const card = page.locator(".fund-comparison-card");
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveAttribute("data-history-state", "ready");
  return card;
}

async function expectEveryTooltipOutsideDonut(
  page: Page,
  donut: Locator,
  viewport: { width: number; height: number },
) {
  await donut.scrollIntoViewIfNeeded();
  const slices = await donut.getByRole("button").all();
  for (const slice of slices) {
    // Focus keeps every slice stable while the sweep scrolls and resizes; representative
    // pointer-hover behavior for all three donuts is covered by dashboard.spec.ts.
    await slice.focus();
    await expect(slice).toHaveAttribute("aria-describedby", /.+/);
    const tooltipId = await slice.getAttribute("aria-describedby");
    expect(tooltipId).not.toBeNull();
    const tooltip = page.locator(`[id="${tooltipId}"]`);
    await expect(tooltip).toBeVisible();
    await expect(tooltip).not.toHaveAttribute("data-placement", "pending");
    await expect.poll(async () => {
      const [donutBox, tooltipBox] = await Promise.all([donut.boundingBox(), tooltip.boundingBox()]);
      if (!donutBox || !tooltipBox) return "missing geometry";
      const overlapWidth = Math.max(0,
        Math.min(donutBox.x + donutBox.width, tooltipBox.x + tooltipBox.width)
        - Math.max(donutBox.x, tooltipBox.x));
      const overlapHeight = Math.max(0,
        Math.min(donutBox.y + donutBox.height, tooltipBox.y + tooltipBox.height)
        - Math.max(donutBox.y, tooltipBox.y));
      const overlap = overlapWidth * overlapHeight;
      const insideViewport = tooltipBox.x >= 0
        && tooltipBox.y >= 0
        && tooltipBox.x + tooltipBox.width <= viewport.width
        && tooltipBox.y + tooltipBox.height <= viewport.height;
      return overlap === 0 && insideViewport
        ? "ok"
        : JSON.stringify({ donutBox, tooltipBox, overlap, viewport });
    }, { message: `${viewport.width}px tooltip must stay outside its donut and inside the viewport` }).toBe("ok");
  }
}

test.describe("accessibility and responsive behavior", () => {
  test("landing has no critical WCAG A/AA violations", async ({ page }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(blockingViolations(results.violations)).toEqual([]);
  });

  test("dashboard has no critical WCAG A/AA violations", async ({ page }) => {
    await openDemo(page);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const critical = blockingViolations(results.violations);
    const unexpected = critical.filter((violation) => violation.id !== "aria-required-children");
    expect(unexpected).toEqual([]);
    // Known working-version-11 defect: role=table contains role=button rows rather than role=row.
    expect(critical.map((violation) => violation.id)).toContain("aria-required-children");
  });

  test("all interactive controls and canvas images have accessible names", async ({ page }) => {
    await openDemo(page);
    const unnamed = await page.locator("button, input, [role=button], canvas[role=img]").evaluateAll((elements) =>
      elements.flatMap((element) => {
        const labelledBy = element.getAttribute("aria-labelledby");
        const label = element.getAttribute("aria-label")
          || (labelledBy ? document.getElementById(labelledBy)?.textContent : "")
          || (element instanceof HTMLInputElement ? element.labels?.[0]?.textContent : "")
          || element.textContent;
        return label?.trim() ? [] : [`${element.tagName.toLowerCase()}.${element.className}`];
      }),
    );
    expect(unnamed).toEqual([]);
  });

  test("primary landing actions are usable with keyboard focus", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile-chromium", "Mobile browsers do not expose desktop Tab traversal semantics.");
    await page.goto("/");
    await page.waitForFunction(() => {
      const input = document.querySelector('input[type="file"]');
      return input && Object.keys(input).some((key) => key.startsWith("__reactProps$"));
    });
    const howItWorks = page.getByRole("link", { name: "How it works" });
    const privacy = page.getByRole("link", { name: "Privacy" });
    const analyse = page.getByRole("button", { name: "Analyse statement" });
    if (testInfo.project.name === "desktop-webkit") {
      // Headless WebKit follows macOS's setting that omits links from initial Tab traversal.
      await howItWorks.focus();
      await expect(howItWorks).toBeFocused();
      await privacy.focus();
      await expect(privacy).toBeFocused();
      await analyse.focus();
      await expect(analyse).toBeFocused();
    } else {
      await page.keyboard.press("Tab");
      await expect(howItWorks).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(privacy).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(analyse).toBeFocused();
    }

    await page.getByRole("button", { name: /explore with demo data/i }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Your funds" })).toBeVisible();
  });

  test("fund rows and their nested folio control are independently keyboard operable", async ({ page }) => {
    await openDemo(page);
    const row = page.locator(".fund-group .fund-row").first();
    await row.focus();
    await row.press(" ");
    const dialog = page.getByRole("dialog", { name: "Aurora Small Cap Direct Growth" });
    await expect(dialog).toBeVisible();
    const fullHistoryToggle = dialog.getByRole("button", { name: "Show full fund history" });
    await expect(fullHistoryToggle).toHaveAttribute("aria-pressed", "false");
    await expect(fullHistoryToggle).toBeDisabled();
    const drawerResults = await new AxeBuilder({ page })
      .include(".fund-drawer")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(blockingViolations(drawerResults.violations)).toEqual([]);
    await page.getByRole("button", { name: "Close fund details" }).click();

    const expand = page.getByRole("button", { name: "Expand folios for Aurora Small Cap Direct Growth", exact: true });
    await expand.focus();
    await expand.press("Enter");
    await expect(page.getByRole("button", { name: "Collapse folios for Aurora Small Cap Direct Growth", exact: true })).toHaveAttribute("aria-expanded", "true");
  });

  test("comparison and its open native-checkbox picker pass axe and restore keyboard focus on Escape", async ({ page }) => {
    const card = await openFundComparison(page);
    const closedResults = await new AxeBuilder({ page })
      .include(".fund-comparison-card")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const trigger = card.getByRole("button", { name: "All 4 funds" });
    await trigger.focus();
    await trigger.press("Enter");
    const picker = card.getByRole("dialog", { name: "Choose funds to compare" });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("searchbox", { name: "Search funds to compare" })).toBeFocused();
    await expect(picker.getByRole("checkbox")).toHaveCount(6);
    await expect(picker.getByRole("checkbox", { name: "All CAS funds" })).toBeChecked();
    await picker.getByRole("button", { name: "All India funds" }).click();
    await expect(picker.getByText("Zenith India Large Cap Direct Growth")).toBeVisible();
    await picker.getByRole("combobox", { name: "Filter by plan" }).selectOption("Regular");
    await expect(picker.getByText("Zenith India Large Cap Direct Growth")).toHaveCount(0);
    await picker.getByRole("combobox", { name: "Filter by plan" }).selectOption("Direct");
    await expect(picker.getByText("Zenith India Large Cap Direct Growth")).toBeVisible();
    const openResults = await new AxeBuilder({ page })
      .include(".fund-comparison-card")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect({
      pickerClosed: violationSummary(closedResults.violations),
      pickerOpen: violationSummary(openResults.violations),
    }).toEqual({ pickerClosed: [], pickerOpen: [] });
  });

  test("comparison chart, picker, and tooltip stay contained at 320, 390, 768, and 1440 pixels", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const card = await openFundComparison(page);

    for (const viewport of [
      { width: 320, height: 720 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await card.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      const canvas = card.locator('canvas[role="img"]');
      await expect(canvas).toBeVisible();
      const stage = card.locator(".fund-comparison-stage");
      await expect(stage).toBeVisible();
      await expect(card.getByRole("slider", { name: "Shared vertical minimum" })).toBeVisible();
      await expect(card.getByRole("slider", { name: "Shared vertical maximum" })).toBeVisible();
      const stageBox = await stage.boundingBox();
      expect(stageBox?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((stageBox?.x ?? Infinity) + (stageBox?.width ?? Infinity)).toBeLessThanOrEqual(viewport.width + 1);
      const canvasBox = await canvas.boundingBox();
      expect(canvasBox?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((canvasBox?.x ?? Infinity) + (canvasBox?.width ?? Infinity)).toBeLessThanOrEqual(viewport.width + 1);
      await expect(canvas).toHaveAttribute("data-y-axis-sides", "left,right");
      await expect(canvas).toHaveAttribute("data-y-axis-ticks", /₹256\.8 \+156\.8%.*₹83\.2 −16\.8%/);
      const plotLeft = Number(await canvas.getAttribute("data-plot-left"));
      const plotRight = Number(await canvas.getAttribute("data-plot-right"));
      expect(plotLeft).toBeGreaterThanOrEqual(40);
      expect(Math.abs(plotLeft - ((canvasBox?.width ?? 0) - plotRight))).toBeLessThanOrEqual(1);

      await canvas.focus();
      await canvas.press("End");
      const tooltip = card.locator(".fund-comparison-tooltip");
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toHaveAttribute("data-placement", /^(near-|rail-)/);
      const tooltipBox = await tooltip.boundingBox();
      const plotTop = Number(await canvas.getAttribute("data-plot-top"));
      const plotBottom = Number(await canvas.getAttribute("data-plot-bottom"));
      const anchorX = Number(await tooltip.getAttribute("data-anchor-x"));
      const anchorY = Number(await tooltip.getAttribute("data-anchor-y"));
      const placement = await tooltip.getAttribute("data-placement");
      expect(tooltipBox?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((tooltipBox?.x ?? Infinity) + (tooltipBox?.width ?? Infinity)).toBeLessThanOrEqual(viewport.width + 1);
      expect(tooltipBox?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect((tooltipBox?.y ?? Infinity) + (tooltipBox?.height ?? Infinity)).toBeLessThanOrEqual(viewport.height + 1);
      const localLeft = (tooltipBox?.x ?? 0) - (canvasBox?.x ?? 0);
      const localTop = (tooltipBox?.y ?? 0) - (canvasBox?.y ?? 0);
      const localRight = localLeft + (tooltipBox?.width ?? 0);
      const localBottom = localTop + (tooltipBox?.height ?? 0);
      expect(anchorX >= localLeft - 5 && anchorX <= localRight + 5
        && anchorY >= localTop - 5 && anchorY <= localBottom + 5).toBe(false);
      if (placement === "rail-top") expect(localBottom).toBeLessThanOrEqual(plotTop - 4);
      if (placement === "rail-bottom") {
        expect(localTop).toBeGreaterThanOrEqual((canvasBox?.height ?? 0) - plotBottom + 4);
      }
      await canvas.press("Escape");

      const trigger = card.locator(".fund-comparison-picker-trigger");
      await trigger.click();
      const picker = card.getByRole("dialog", { name: "Choose funds to compare" });
      await expect(picker).toBeVisible();
      const allFundsBox = await picker.getByRole("checkbox", { name: "All CAS funds" }).boundingBox();
      const firstFundBox = await picker.getByRole("checkbox", { name: /Alpha Flexi Cap/ }).boundingBox();
      expect(Math.abs((allFundsBox?.x ?? 0) - (firstFundBox?.x ?? Infinity))).toBeLessThanOrEqual(1);
      const pickerBox = await picker.boundingBox();
      expect(pickerBox?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((pickerBox?.x ?? Infinity) + (pickerBox?.width ?? Infinity)).toBeLessThanOrEqual(viewport.width + 1);
      expect(pickerBox?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect((pickerBox?.y ?? Infinity) + (pickerBox?.height ?? Infinity)).toBeLessThanOrEqual(viewport.height + 1);
      await page.keyboard.press("Escape");
    }
  });

  test("allocation donuts, tooltips, and the concentration scroller stay contained at every target width", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openDemo(page);
    const insightGrid = page.locator(".insight-grid");
    await page.locator(".hero-donut").getByRole("button", { name: /Small cap allocation/ }).hover();
    await expect(page.getByRole("tooltip")).toBeVisible();
    const summaryTooltipAccessibility = await new AxeBuilder({ page })
      .include(".donut-tooltip")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(violationSummary(summaryTooltipAccessibility.violations)).toEqual([]);
    const accessibility = await new AxeBuilder({ page })
      .include(".insight-grid")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(violationSummary(accessibility.violations)).toEqual([]);
    await page.locator(".concentration-donut").getByRole("button", { name: /Aurora Small Cap/ }).hover();
    await expect(page.getByRole("tooltip")).toBeVisible();
    const openTooltipAccessibility = await new AxeBuilder({ page })
      .include(".donut-tooltip")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(violationSummary(openTooltipAccessibility.violations)).toEqual([]);

    for (const viewport of [
      { width: 320, height: 720 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await insightGrid.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      for (const selector of [".hero-donut", ".allocation-donut", ".concentration-donut", ".top-list"]) {
        const element = page.locator(selector);
        await expect(element).toBeVisible();
        const box = await element.boundingBox();
        expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? Infinity) + (box?.width ?? Infinity)).toBeLessThanOrEqual(viewport.width + 1);
      }

      for (const selector of [".hero-donut", ".allocation-donut", ".concentration-donut"]) {
        await expectEveryTooltipOutsideDonut(page, page.locator(selector), viewport);
      }
    }
  });

  for (const viewport of [
    { name: "small phone", width: 320, height: 720 },
    { name: "phone", width: 390, height: 844 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 1000 },
  ]) {
    test(`${viewport.name} landing and dashboard avoid viewport overflow`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");
      await waitForHydration(page);
      await expectNoHorizontalOverflow(page);
      await expect(page.getByRole("heading", { name: /Your mutual funds/i })).toBeVisible();

      await page.getByRole("button", { name: /explore with demo data/i }).click();
      await expect(page.getByRole("heading", { name: "Your funds" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      const shell = await page.locator(".dashboard-shell").boundingBox();
      expect(shell?.width ?? Infinity).toBeLessThanOrEqual(viewport.width);
    });
  }

  test("modal content remains scrollable and closeable on a small phone", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openDemo(page);
    await page.locator(".fund-group .fund-row").first().click();
    const dialog = page.getByRole("dialog", { name: "Aurora Small Cap Direct Growth" });
    await expect(dialog).toBeVisible();
    const dimensions = await dialog.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
    }));
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
    expect(["auto", "scroll"]).toContain(dimensions.overflowY);
    await expect(dialog.getByRole("button", { name: "Close fund details" })).toBeInViewport();
  });
});
