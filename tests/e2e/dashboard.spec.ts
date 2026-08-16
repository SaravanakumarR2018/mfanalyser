import { expect, test } from "@playwright/test";
import { installFailureGuards, openDemo } from "./helpers/app";

test.describe("dashboard information architecture", () => {
  test.beforeEach(async ({ page }) => {
    await openDemo(page);
  });

  test("locks the working-version-11 summary and reconciliation contract", async ({ page }) => {
    await expect(page.locator(".dashboard-header")).toContainText("Portfolio overview");
    await expect(page.locator(".dashboard-header")).toContainText("Valued as of 31 Jul 2026");
    await expect(page.locator(".reconcile-bar")).toContainText("Statement reconciled");
    await expect(page.locator(".reconcile-bar")).toContainText("6/6 funds updated");
    await expect(page.locator(".reconcile-bar")).toContainText("7 active folios");
    await expect(page.locator(".valuation-notice.fallback")).toContainText("Showing statement valuation · 31 Jul 2026");

    await expect(page.locator(".summary-main h1")).toHaveText("₹30.70 L");
    await expect(page.locator(".summary-exact-value")).toHaveText("₹30,70,000.00");
    await expect(page.locator(".gain-line")).toContainText("₹7,58,420");
    await expect(page.locator(".gain-line")).toContainText("32.55%");
    await expect(page.locator(".hero-donut")).toContainText("6funds");
    await expect(page.locator(".summary-allocation")).toContainText("Small cap");
    await expect(page.locator(".summary-allocation")).toContainText("26.9% of portfolio");

    const metrics = page.getByRole("region", { name: "Portfolio summary metrics" });
    await expect(metrics).toContainText("Exact · ₹23,30,000.00");
    await expect(metrics).toContainText("Exact · ₹7,58,420.00");
    await expect(metrics).toContainText("32.55%");
    await expect(metrics).toContainText("₹18,420");
    await expect(metrics).toContainText("From 1 closed fund");
  });

  test("exposes metric explanations to pointer and keyboard users", async ({ page }) => {
    const absoluteButton = page.getByRole("button", { name: "About absolute return" });
    await absoluteButton.focus();
    await expect(page.getByRole("tooltip", { name: /Wealth created divided by amount invested/i })).toBeVisible();

    const annualizedButton = page.getByRole("button", { name: "About return per annum" });
    await annualizedButton.hover();
    await expect(page.getByRole("tooltip", { name: /Money-weighted XIRR from exact dated CAS cash flows/i })).toBeVisible();
  });

  test("filters funds, reports empty results, and restores all holdings", async ({ page }) => {
    const search = page.getByRole("textbox", { name: "Search funds" });
    await search.fill("gold");
    await expect(page.locator(".fund-group")).toHaveCount(1);
    await expect(page.locator(".fund-group")).toContainText("Foundry Gold ETF Fund of Fund");

    await search.fill("not-a-real-fund");
    await expect(page.getByText("No funds match “not-a-real-fund”.")).toBeVisible();
    await expect(page.locator(".fund-group")).toHaveCount(0);

    await search.clear();
    await expect(page.locator(".fund-group")).toHaveCount(6);
  });

  test("sorts each financial column and keeps accessible sort state accurate", async ({ page }) => {
    const firstName = () => page.locator(".fund-group .fund-name strong").first();
    await expect(firstName()).toHaveText("Aurora Small Cap Direct Growth");

    const currentValue = page.getByRole("button", { name: /Current value: sorted descending/i });
    await currentValue.click();
    await expect(page.getByRole("button", { name: /Current value: sorted ascending/i })).toBeVisible();
    await expect(firstName()).toHaveText("Cedar Mid Cap Direct Growth");

    const invested = page.getByRole("button", { name: /Invested amount: not sorted/i });
    await invested.click();
    await expect(page.getByRole("button", { name: /Invested amount: sorted descending/i })).toBeVisible();
    await expect(firstName()).toHaveText("Aurora Small Cap Direct Growth");
    await page.getByRole("button", { name: /Invested amount: sorted descending/i }).click();
    await expect(firstName()).toHaveText("Cedar Mid Cap Direct Growth");

    for (const label of ["Gain / loss", "Return", "Return p.a."]) {
      const button = page.getByRole("button", { name: new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: not sorted`, "i") });
      await button.click();
      const descending = page.getByRole("button", { name: new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: sorted descending`, "i") });
      await expect(descending).toBeVisible();
      await descending.click();
      await expect(page.getByRole("button", { name: new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: sorted ascending`, "i") })).toBeVisible();
    }
  });

  test("opens fund details from click and keyboard and closes without losing table state", async ({ page }) => {
    const assertNoErrors = await installFailureGuards(page);
    const row = page.locator(".fund-group .fund-row").first();
    await row.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Aurora Small Cap Direct Growth" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Small cap · 2 folios");
    await expect(dialog.locator(".drawer-value")).toContainText("₹8,24,600");
    await expect(dialog.locator(".drawer-grid")).toContainText("₹5,40,000");
    await expect(dialog.getByRole("heading", { name: "Invested vs value" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "NAV & investments" })).toBeVisible();
    const fullHistoryToggle = dialog.getByRole("button", { name: "Show full fund history" });
    await expect(fullHistoryToggle).toHaveAttribute("aria-pressed", "false");
    await expect(fullHistoryToggle).toBeDisabled();
    await expect(dialog.getByText("Transaction rows were not available for this holding.")).toBeVisible();

    await dialog.getByRole("button", { name: "Close fund details" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".fund-group")).toHaveCount(6);
    assertNoErrors();
  });

  test("expands folios without opening the parent and opens a folio-specific journey", async ({ page }) => {
    const expand = page.getByRole("button", { name: "Expand folios for Aurora Small Cap Direct Growth", exact: true });
    await expand.click();
    await expect(page.getByRole("button", { name: "Collapse folios for Aurora Small Cap Direct Growth", exact: true })).toHaveAttribute("aria-expanded", "true");

    const folios = page.getByRole("group", { name: "Folios for Aurora Small Cap Direct Growth" });
    await expect(folios).toContainText("2 folios");
    await expect(folios.getByRole("button")).toHaveCount(2);
    await folios.getByRole("button").first().click();

    const dialog = page.getByRole("dialog", { name: "Folio ••••4821" });
    await expect(dialog).toContainText("Masked folio number · visible only in this browser tab");
    await expect(dialog.getByRole("heading", { name: "Invested vs value" })).toBeVisible();
    await dialog.getByRole("button", { name: "Close fund details" }).click();

    await page.getByRole("button", { name: "Collapse folios for Aurora Small Cap Direct Growth", exact: true }).click();
    await expect(folios).toHaveCount(0);
  });

  test("renders closed-fund, allocation, and concentration sections consistently", async ({ page }) => {
    const closed = page.getByRole("region", { name: "Closed funds" });
    await expect(closed).toContainText("Harbour Tax Saver Direct Growth");
    await expect(closed).toContainText(/18 Sep(?:t)? 2025/);
    await expect(closed).toContainText("₹60,000");
    await expect(closed).toContainText("₹78,420");
    await expect(closed).toContainText("+₹18,420");

    await expect(page.getByRole("heading", { name: "Allocation" })).toBeVisible();
    await expect(page.locator(".allocation-list p")).toHaveCount(6);
    await expect(page.getByRole("heading", { name: "Top holdings" })).toBeVisible();
    await expect(page.locator(".top-list .drag-scroll-content > div")).toHaveCount(6);
    await expect(page.locator(".top-list .drag-scroll-content > div").first()).toContainText("Aurora Small Cap Direct Growth");
  });

  test("allocation slices show immediate tooltips and settle into a reversible selected state", async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const summaryDonut = page.locator(".hero-donut");
    const smallCap = summaryDonut.getByRole("button", { name: /Small cap allocation: 26\.9% of portfolio/ });
    const flexiCap = summaryDonut.getByRole("button", { name: /Flexi cap allocation: 21\.3% of portfolio/ });
    const revealSlice = async (slice: typeof smallCap) => {
      if (testInfo.project.name === "mobile-chromium") await slice.focus();
      else await slice.hover();
    };

    await revealSlice(smallCap);
    await expect(summaryDonut).toHaveAttribute("data-active-slice", "category:Small cap");
    await expect(page.getByRole("tooltip")).toContainText("Small cap allocation26.9% of portfolio");
    const animatedStyle = await smallCap.evaluate((element) => {
      const style = getComputedStyle(element);
      return { animationName: style.animationName, animationDuration: style.animationDuration };
    });
    if (testInfo.project.name !== "mobile-chromium") {
      expect(animatedStyle.animationName).toContain("donut-slice-hover");
      expect(animatedStyle.animationDuration).not.toBe("0s");
    }
    await smallCap.click();
    await expect(smallCap).toHaveAttribute("aria-pressed", "true");
    await expect(summaryDonut).toHaveAttribute("data-selected-slice", "category:Small cap");
    if (testInfo.project.name !== "mobile-chromium") {
      expect(await smallCap.evaluate((element) => getComputedStyle(element).animationName)).toContain("donut-slice-pop");
    }
    await expect.poll(() => flexiCap.evaluate((element) => Number(getComputedStyle(element).opacity))).toBeLessThan(0.5);
    await revealSlice(flexiCap);
    await expect(summaryDonut).toHaveAttribute("data-active-slice", "category:Flexi cap");
    await expect(page.getByRole("tooltip")).toContainText("Flexi cap allocation21.3% of portfolio");
    if (testInfo.project.name === "mobile-chromium") await flexiCap.blur();
    else await page.locator(".summary-main h1").hover();
    await expect(summaryDonut).toHaveAttribute("data-active-slice", "category:Small cap");
    await expect(page.getByRole("tooltip")).toContainText("Selected");

    await flexiCap.focus();
    await flexiCap.press("Enter");
    await expect(flexiCap).toHaveAttribute("aria-pressed", "true");
    await expect(smallCap).toHaveAttribute("aria-pressed", "false");
    await flexiCap.press("Escape");
    await expect(summaryDonut).toHaveAttribute("data-selected-slice", "");
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    const allocationDonut = page.locator(".allocation-donut");
    await revealSlice(allocationDonut.getByRole("button", { name: /Mid cap allocation: 9\.4% of portfolio/ }));
    await expect(page.getByRole("tooltip")).toContainText("Mid cap allocation9.4% of portfolio");

    const concentrationDonut = page.locator(".concentration-donut");
    await concentrationDonut.getByRole("button", { name: /Aurora Small Cap Direct Growth: 26\.9% of portfolio/ }).click();
    await expect(concentrationDonut).toHaveAttribute("data-selected-slice", "INF000A00001");
    await expect(page.getByRole("tooltip")).toContainText("Aurora Small Cap Direct Growth26.9% of portfolioSelected");
  });

  test("all fund rankings remain present in a pointer- and keyboard-scrollable window", async ({ page }) => {
    const list = page.getByRole("region", { name: "All fund concentration rankings" });
    await list.scrollIntoViewIfNeeded();
    await expect(list.getByRole("listitem")).toHaveCount(6);
    await expect(list.getByRole("listitem").last()).toContainText("Cedar Mid Cap Direct Growth");
    const dimensions = await list.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    }));
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
    expect(dimensions.scrollTop).toBe(0);

    const box = await list.boundingBox();
    expect(box).not.toBeNull();
    const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const startY = (box?.y ?? 0) + (box?.height ?? 0) - 18;
    await page.mouse.move(x, startY);
    await page.mouse.down();
    await expect(list).toHaveAttribute("data-dragging", "true");
    await page.mouse.move(x, startY - 95, { steps: 5 });
    await page.mouse.up();
    await expect(list).toHaveAttribute("data-dragging", "false");
    expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(40);

    await list.evaluate((element) => { element.scrollTop = 0; });
    await list.focus();
    await list.press("ArrowDown");
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const percentages = await list.locator("em").allTextContents();
    const total = percentages.reduce((sum, value) => sum + Number.parseFloat(value), 0);
    expect(total).toBeCloseTo(100, 0);
  });
});
