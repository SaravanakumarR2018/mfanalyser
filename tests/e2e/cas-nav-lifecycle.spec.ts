import { expect, test } from "@playwright/test";
import { installFailureGuards, openDemo, uploadCas } from "./helpers/app";
import {
  dailyHistoryPayload,
  fullDailyHistoryPayload,
  latestNavText,
  makeCasPdf,
  mockDailyHistory,
  mockLatestNav,
  TEST_ISIN,
  TEST_SCHEME_CODE,
} from "./helpers/cas-fixture";

test.describe("real CAS parser and NAV lifecycle", () => {
  test("keeps the historical NAV adapter distinct from the latest-NAV development proxy", async ({ page }) => {
    await page.goto("/");
    const response = await page.evaluate(async () => {
      const result = await fetch("/api/nav-history?schemeCode=unsafe&startDate=2026-01-01&endDate=2026-01-02");
      return { status: result.status, body: await result.json() };
    });

    expect(response).toEqual({
      status: 400,
      body: { error: "Invalid published NAV history request." },
    });
  });

  test("parses, reconciles, applies latest NAV, then enriches with daily history", async ({ page }) => {
    let dailyHistoryUrl = "";
    let comparisonHistoryUrl = "";
    let releaseHistory!: () => void;
    const historyGate = new Promise<void>((resolve) => { releaseHistory = resolve; });
    await mockLatestNav(page);
    await page.route("**/api/nav-history**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("startDate") === "1900-01-01") {
        comparisonHistoryUrl = url.toString();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(fullDailyHistoryPayload()),
        });
        return;
      }
      dailyHistoryUrl = url.toString();
      await historyGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(dailyHistoryPayload()),
      });
    });
    await page.goto("/");
    await uploadCas(page);

    await expect(page.getByRole("heading", { name: "Your funds" })).toBeVisible();
    await expect(page.locator(".reconcile-bar")).toContainText("Latest NAV applied");
    await expect(page.locator(".reconcile-bar")).toContainText("1/1 funds updated");
    await expect(page.locator(".reconcile-bar")).toContainText("daily history loading");
    await expect(page.locator(".valuation-notice.live")).toContainText("Latest available official NAVs");
    await expect(page.locator(".summary-main h1")).toHaveText("₹15,000");
    await expect(page.locator(".summary-exact-value")).toHaveText("₹15,000.00");
    await expect(page.getByText("Exact · ₹10,000.00")).toBeVisible();
    await expect(page.locator(".gain-line")).toContainText("₹5,000");
    await expect(page.locator(".gain-line")).toContainText("50.00%");

    const progress = page.getByRole("status", { name: /Daily NAV history \d+% loaded/ });
    await expect(progress).toBeVisible();
    await expect(progress).toContainText("Loading daily NAVs");
    releaseHistory();
    await expect(page.locator(".reconcile-bar")).toContainText("1/1 daily histories");
    await expect(page.locator('.chart-card canvas[role="img"]').first()).toHaveAttribute("data-daily-points", "6");
    const enrichedStack = page.locator(".fund-stack-card canvas.stack-base-canvas").first();
    await expect(enrichedStack).toHaveAttribute("data-fund-count", "1");
    await expect(enrichedStack).toHaveAttribute("data-visible-points", "6");
    await expect(page.locator(".fund-stack-empty")).toHaveCount(0);
    await expect(page.locator(".fund-comparison-card")).toHaveAttribute("data-history-state", "ready");

    const request = new URL(dailyHistoryUrl);
    expect(request.searchParams.get("schemeCode")).toBe(TEST_SCHEME_CODE);
    expect(request.searchParams.get("startDate")).toBe("2025-01-01");
    expect(request.searchParams.get("endDate")).toBe("2026-08-14");
    expect(new URL(comparisonHistoryUrl).searchParams.get("startDate")).toBe("1900-01-01");
  });

  test("floating history bar expands while the pointer crosses it and collapses after leaving", async ({ page }) => {
    await mockLatestNav(page);
    await mockDailyHistory(page, { delayMs: 3_000 });
    await page.goto("/");
    await uploadCas(page);

    const progress = page.getByRole("status", { name: /Daily NAV history \d+% loaded/ });
    const details = progress.locator(".history-progress-details");
    await expect(progress).toBeVisible();
    await expect(progress).toContainText("Loading daily NAVs");
    await expect.poll(() => details.evaluate((element) => getComputedStyle(element).opacity)).toBe("0");

    const bounds = await progress.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) return;

    await page.mouse.move(bounds.x - 24, bounds.y + bounds.height / 2);
    await page.mouse.move(bounds.x + 8, bounds.y + bounds.height / 2, { steps: 5 });
    await expect.poll(() => details.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
    await expect(details).toContainText("Current portfolio values are ready");

    await page.mouse.move(bounds.x + bounds.width - 8, bounds.y + bounds.height / 2, { steps: 12 });
    await expect.poll(() => details.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");

    await page.mouse.move(1, 1, { steps: 8 });
    await expect.poll(() => details.evaluate((element) => getComputedStyle(element).opacity)).toBe("0");
    await expect.poll(() => details.evaluate((element) => getComputedStyle(element).maxHeight)).toBe("0px");
  });

  test("switches smoothly between the invested period and full fund NAV history", async ({ page }) => {
    const assertNoErrors = await installFailureGuards(page);
    let fullHistoryRequests = 0;
    await mockLatestNav(page);
    await page.route("**/api/nav-history**", async (route) => {
      const request = new URL(route.request().url());
      const fullHistory = request.searchParams.get("startDate") === "1900-01-01";
      if (fullHistory) {
        fullHistoryRequests += 1;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fullHistory ? fullDailyHistoryPayload() : dailyHistoryPayload()),
      });
    });
    await page.goto("/");
    await uploadCas(page);
    await expect(page.locator(".reconcile-bar")).toContainText("1/1 daily histories");
    await expect(page.locator(".fund-comparison-card")).toHaveAttribute("data-history-state", "ready");
    expect(fullHistoryRequests).toBe(1);
    await page.locator(".fund-group .fund-row").first().click();

    const dialog = page.getByRole("dialog", { name: "Testhouse Flexi Cap Direct Growth" });
    const navCard = dialog.locator(".nav-activity-card");
    const canvas = navCard.locator('canvas[role="img"]');
    const scopeStatus = navCard.getByRole("status");
    const fullHistoryToggle = navCard.getByRole("button", { name: "Show full fund history" });
    await expect(fullHistoryToggle).toHaveAttribute("aria-pressed", "false");
    await expect(canvas).toHaveAttribute("data-history-scope", "journey");
    await expect(canvas).toHaveAttribute("data-series-start", "2025-01-01");
    await expect(canvas).toHaveAttribute("data-total-points", "6");
    await expect(canvas).toHaveAttribute("data-investment-points", "3");
    await expect(scopeStatus).toHaveCount(0);
    const beforeBounds = await canvas.boundingBox();

    await fullHistoryToggle.click();
    await expect(navCard.getByRole("button", { name: "Hide full fund history" })).toHaveAttribute("aria-pressed", "true");
    await expect(canvas).toHaveAttribute("data-requested-history-scope", "full");
    await expect(scopeStatus).toContainText("Full history · earliest published NAV 15 May 2004 · 12 observations");
    await expect(canvas).toHaveAttribute("data-history-scope", "full");
    await expect(canvas).toHaveAttribute("data-series-start", "2004-05-15");
    await expect(canvas).toHaveAttribute("data-total-points", "12");
    await expect(canvas).toHaveAttribute("data-investment-points", "3");
    await expect(canvas).toHaveAttribute("aria-label", /15 May 2004 to 14 Aug 2026/);
    const afterBounds = await canvas.boundingBox();
    const requestsAfterFirstFullHistory = fullHistoryRequests;
    expect(requestsAfterFirstFullHistory).toBeGreaterThanOrEqual(1);
    expect(requestsAfterFirstFullHistory).toBeLessThanOrEqual(2);
    expect(afterBounds?.width).toBeCloseTo(beforeBounds?.width ?? 0, 0);
    expect(afterBounds?.height).toBeCloseTo(beforeBounds?.height ?? 0, 0);

    await navCard.getByRole("button", { name: "3Y", exact: true }).click();
    expect(Number(await canvas.getAttribute("data-visible-points"))).toBeLessThan(12);
    await navCard.getByRole("button", { name: "All", exact: true }).click();
    await expect(canvas).toHaveAttribute("data-visible-points", "12");
    await canvas.hover({ position: { x: Math.max(1, (afterBounds?.width ?? 100) * 0.86), y: 150 } });
    await expect(navCard.locator(".nav-activity-tooltip")).toContainText("NAV");

    await navCard.getByRole("button", { name: "Hide full fund history" }).click();
    await expect(canvas).toHaveAttribute("data-history-scope", "journey");
    await expect(canvas).toHaveAttribute("data-total-points", "6");
    await expect(navCard.getByRole("button", { name: "Show full fund history" })).toHaveAttribute("aria-pressed", "false");
    await navCard.getByRole("button", { name: "Show full fund history" }).click();
    await expect(canvas).toHaveAttribute("data-history-scope", "full");
    expect(fullHistoryRequests).toBe(requestsAfterFirstFullHistory);
    expect(await navCard.evaluate((element) => {
      const card = element.getBoundingClientRect();
      return [...element.querySelectorAll(".nav-activity-legend, .nav-activity-shell, .nav-range-control")]
        .reduce((overflow, child) => {
          const bounds = child.getBoundingClientRect();
          return Math.max(overflow, bounds.right - card.right, card.left - bounds.left);
        }, 0);
    })).toBeLessThanOrEqual(1);
    assertNoErrors();
  });

  test("keeps the current NAV chart visible when full history fails and supports retry", async ({ page }) => {
    let releaseComparisonHistory!: () => void;
    const comparisonHistoryGate = new Promise<void>((resolve) => { releaseComparisonHistory = resolve; });
    let fullHistoryRequests = 0;
    let fullHistoryAttempts = 0;
    await mockLatestNav(page);
    await page.route("**/api/nav-history**", async (route) => {
      const request = new URL(route.request().url());
      if (request.searchParams.get("startDate") !== "1900-01-01") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dailyHistoryPayload()) });
        return;
      }
      fullHistoryRequests += 1;
      if (fullHistoryRequests === 1) {
        await comparisonHistoryGate;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fullDailyHistoryPayload()) });
        return;
      }
      fullHistoryAttempts += 1;
      await route.fulfill(fullHistoryAttempts <= 3
        ? { status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }
        : { status: 200, contentType: "application/json", body: JSON.stringify(fullDailyHistoryPayload()) });
    });
    await page.goto("/");
    await uploadCas(page);
    await expect(page.locator(".reconcile-bar")).toContainText("1/1 daily histories");
    await expect(page.locator(".fund-comparison-card")).toHaveAttribute("data-history-state", "loading");
    await page.locator(".fund-group .fund-row").first().click();

    const navCard = page.getByRole("dialog", { name: "Testhouse Flexi Cap Direct Growth" }).locator(".nav-activity-card");
    const canvas = navCard.locator('canvas[role="img"]');
    await navCard.getByRole("button", { name: "Show full fund history" }).click();
    await expect(navCard.getByRole("status")).toContainText("Your current view is unchanged");
    await expect(canvas).toHaveAttribute("data-history-scope", "journey");
    await expect(canvas).toHaveAttribute("data-total-points", "6");
    expect(fullHistoryAttempts).toBe(3);

    await navCard.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(canvas).toHaveAttribute("data-history-scope", "full");
    await expect(canvas).toHaveAttribute("data-series-start", "2004-05-15");
    expect(fullHistoryAttempts).toBe(4);
    releaseComparisonHistory();
    await expect(page.locator(".fund-comparison-card")).toHaveAttribute("data-history-state", "ready");
  });

  test("keeps statement values when the latest NAV endpoint fails", async ({ page }) => {
    let historyRequests = 0;
    await mockLatestNav(page, { status: 503, body: "temporarily unavailable" });
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/nav-history") historyRequests += 1;
    });
    await page.goto("/");
    await uploadCas(page);

    await expect(page.getByRole("heading", { name: "Your funds" })).toBeVisible();
    await expect(page.locator(".reconcile-bar")).toContainText("Statement reconciled");
    await expect(page.locator(".reconcile-bar")).toContainText("0/1 funds updated");
    await expect(page.locator(".reconcile-bar")).toContainText("0/1 daily histories");
    await expect(page.locator(".valuation-notice.fallback")).toContainText("Showing statement valuation");
    await expect(page.locator(".valuation-notice.fallback")).toContainText("Official AMFI NAVs are temporarily unavailable");
    await expect(page.locator(".summary-exact-value")).toHaveText("₹12,000.00");
    await expect(page.locator(".gain-line")).toContainText("₹2,000");
    expect(historyRequests).toBe(0);
  });

  test("falls back safely when no AMFI scheme matches the statement ISIN", async ({ page }) => {
    await mockLatestNav(page, {
      body: latestNavText().replace(TEST_ISIN, "INF000A00998"),
    });
    await page.goto("/");
    await uploadCas(page);

    await expect(page.locator(".valuation-notice.fallback")).toContainText("None of the statement schemes matched");
    await expect(page.locator(".summary-exact-value")).toHaveText("₹12,000.00");
  });

  test("reports incomplete history and never estimates missing observations", async ({ page }) => {
    let dailyHistoryAttempts = 0;
    let comparisonHistoryAttempts = 0;
    await mockLatestNav(page);
    await page.route("**/api/nav-history**", async (route) => {
      const request = new URL(route.request().url());
      if (request.searchParams.get("startDate") === "1900-01-01") {
        comparisonHistoryAttempts += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(fullDailyHistoryPayload()),
        });
        return;
      }
      dailyHistoryAttempts += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...dailyHistoryPayload(),
          meta: { scheme_code: "different-scheme" },
        }),
      });
    });
    await page.goto("/");
    await uploadCas(page);

    await expect(page.locator(".valuation-notice.live")).toContainText("Official daily NAV history was incomplete for 1 scheme");
    await expect(page.locator(".reconcile-bar")).toContainText("0/1 daily histories");
    await expect(page.locator('.chart-card canvas[role="img"]').first()).toHaveAttribute("data-daily-points", "0");
    await expect(page.locator(".fund-comparison-card")).toHaveAttribute("data-history-state", "ready");
    expect(dailyHistoryAttempts).toBe(3);
    expect(comparisonHistoryAttempts).toBe(1);
  });

  test("rejects totals that do not reconcile to holding rows", async ({ page }) => {
    let navRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/nav") navRequests += 1;
    });
    await page.goto("/");
    await uploadCas(page, makeCasPdf({ statementValue: 13_000 }));

    await expect(page.getByRole("alert")).toContainText("The statement did not reconcile");
    await expect(page.getByRole("alert")).toContainText("₹1000.00");
    expect(navRequests).toBe(0);
  });

  test("import another CAS resets all dashboard state and supports a clean rerun", async ({ page }) => {
    await mockLatestNav(page);
    await mockDailyHistory(page);
    await page.goto("/");
    await uploadCas(page);
    await expect(page.getByRole("heading", { name: "Your funds" })).toBeVisible();

    await page.getByRole("button", { name: "Import another CAS" }).click();
    await expect(page.getByRole("heading", { name: "Drop your CAS here" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your funds" })).toHaveCount(0);

    await page.getByRole("button", { name: /explore with demo data/i }).click();
    await expect(page.getByRole("heading", { name: "Your funds" })).toBeVisible();
    await expect(page.locator(".reconcile-bar")).toContainText("Demo data");
    await expect(page.getByRole("status", { name: /Daily NAV history/ })).toHaveCount(0);
  });

  test("aborts a stale background history request when a new portfolio is imported", async ({ page }) => {
    await mockLatestNav(page);
    await mockDailyHistory(page, { delayMs: 2_000 });
    await page.goto("/");
    await uploadCas(page);
    await expect(page.getByRole("status", { name: /Daily NAV history/ })).toBeVisible();

    await page.getByRole("button", { name: "Import another CAS" }).click();
    await openDemo(page);
    await expect(page.locator(".summary-exact-value")).toHaveText("₹30,70,000.00");
    await expect(page.getByRole("status", { name: /Daily NAV history/ })).toHaveCount(0);
    await page.waitForTimeout(2_100);
    await expect(page.locator(".summary-exact-value")).toHaveText("₹30,70,000.00");
  });

  test("preserves active controls while background daily history enriches the portfolio", async ({ page }) => {
    await mockLatestNav(page);
    await mockDailyHistory(page, { delayMs: 1_200 });
    await page.goto("/");
    await uploadCas(page);
    await expect(page.getByRole("status", { name: /Daily NAV history/ })).toBeVisible();

    const search = page.getByRole("textbox", { name: "Search funds" });
    await search.fill("Testhouse");
    await page.getByRole("button", { name: /Invested amount: not sorted/i }).click();
    await page.locator(".fund-group .fund-row").first().click();
    const dialog = page.getByRole("dialog", { name: "Testhouse Flexi Cap Direct Growth" });
    await expect(dialog).toBeVisible();

    await expect(page.locator(".reconcile-bar")).toContainText("1/1 daily histories");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close fund details" }).click();
    await expect(search).toHaveValue("Testhouse");
    await expect(page.getByRole("button", { name: /Invested amount: sorted descending/i })).toBeVisible();
  });

  test("never transmits PDF bytes or issues a mutation request during local analysis", async ({ page }) => {
    const requests: Array<{ method: string; url: string; postData: string | null }> = [];
    page.on("request", (request) => requests.push({
      method: request.method(),
      url: request.url(),
      postData: request.postData(),
    }));
    await mockLatestNav(page);
    await mockDailyHistory(page);
    await page.goto("/");
    await uploadCas(page);
    await expect(page.getByRole("heading", { name: "Your funds" })).toBeVisible();

    expect(requests.filter((request) => !["GET", "HEAD"].includes(request.method))).toEqual([]);
    expect(requests.filter((request) => request.postData?.includes("Consolidated Account Statement"))).toEqual([]);
    expect(requests.filter((request) => /regression-cas\.pdf/i.test(request.url))).toEqual([]);
  });

  test("does not persist a portfolio across a full page reload", async ({ page }) => {
    await openDemo(page);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Drop your CAS here" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your funds" })).toHaveCount(0);
  });

  test("paginates and completes a long statement transaction history", async ({ page }) => {
    await mockLatestNav(page, { status: 503 });
    await page.goto("/");
    await uploadCas(page, makeCasPdf({ transactionCount: 25 }));
    await page.locator(".fund-group .fund-row").first().click();

    const dialog = page.getByRole("dialog", { name: "Testhouse Flexi Cap Direct Growth" });
    await expect(dialog.locator(".transaction-head")).toContainText("20 of 25");
    await dialog.getByRole("button", { name: "Load 20 more" }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(dialog.locator(".transaction-head")).toContainText("25 of 25");
    await expect(dialog.locator(".transaction-list > div")).toHaveCount(25);
    await expect(dialog.locator(".transaction-history-complete")).toContainText("Complete history · earliest transaction 1 Jan 2024");
  });
});
