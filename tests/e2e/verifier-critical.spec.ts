import { expect, test } from "@playwright/test";

import { installFailureGuards, openDemo, uploadInput, waitForHydration } from "./helpers/app";
import { dailyHistoryPayload, latestNavText, makeCasPdf, mockDailyHistory, mockLatestNav } from "./helpers/cas-fixture";
import { makeEncryptedCasPdf } from "./helpers/encrypted-cas";
import { makeTwoFundCasPdf, PARTIAL_FIRST_ISIN } from "./helpers/verifier-fixtures";

test.describe("independent critical-path verification", () => {
  test("password-protected CAS prompts, rejects a wrong password safely, and unlocks locally", async ({ page }) => {
    const requests: Array<{ method: string; postData: string | null }> = [];
    page.on("request", (request) => requests.push({ method: request.method(), postData: request.postData() }));
    await mockLatestNav(page, { status: 503 });
    await page.goto("/");
    await waitForHydration(page);
    await uploadInput(page).setInputFiles({
      name: "protected-regression-cas.pdf",
      mimeType: "application/pdf",
      buffer: makeEncryptedCasPdf(),
    });

    const password = page.getByLabel("PDF password");
    await expect(page.getByRole("heading", { name: "Enter the PDF password" })).toBeVisible();
    await expect(password).toHaveAttribute("type", "password");
    await expect(page.getByRole("button", { name: "Unlock & analyse" })).toBeDisabled();

    await password.fill("wrong-password");
    await password.press("Enter");
    await expect(page.getByRole("heading", { name: "Enter the PDF password" })).toBeVisible();
    await expect(password).toHaveValue("wrong-password");

    await password.fill("folio123");
    await password.press("Enter");
    await expect(page.getByRole("heading", { name: "Your funds" })).toBeVisible();
    await expect(page.locator(".summary-exact-value")).toHaveText("₹12,000.00");
    expect(requests.filter((request) => !["GET", "HEAD"].includes(request.method))).toEqual([]);
    expect(requests.some((request) => request.postData?.includes("Consolidated Account Statement"))).toBe(false);
  });

  test("analysis leaves browser persistence stores empty", async ({ page }) => {
    await mockLatestNav(page);
    await mockDailyHistory(page);
    await page.goto("/");
    await waitForHydration(page);
    await uploadInput(page).setInputFiles({
      name: "privacy-regression-cas.pdf",
      mimeType: "application/pdf",
      buffer: makeCasPdf(),
    });
    await expect(page.getByRole("heading", { name: "Your funds" })).toBeVisible();

    const persistence = await page.evaluate(async () => ({
      localStorage: Object.keys(localStorage),
      sessionStorage: Object.keys(sessionStorage),
      indexedDatabases: typeof indexedDB.databases === "function"
        ? (await indexedDB.databases()).map((database) => database.name)
        : [],
      cacheStorage: "caches" in window ? await caches.keys() : [],
      serviceWorkers: "serviceWorker" in navigator
        ? (await navigator.serviceWorker.getRegistrations()).map((registration) => registration.scope)
        : [],
      cookies: document.cookie,
    }));
    expect(persistence).toEqual({
      localStorage: [], sessionStorage: [], indexedDatabases: [], cacheStorage: [], serviceWorkers: [], cookies: "",
    });
  });

  test("partial latest-NAV coverage keeps unmatched values and reports exact coverage", async ({ page }) => {
    await page.route("**/api/nav", (route) => route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: `100001;${PARTIAL_FIRST_ISIN};;Testhouse Flexi Cap Direct Growth;15.0000;14-Aug-2026\n`,
    }));
    await mockDailyHistory(page);
    await page.goto("/");
    await waitForHydration(page);
    await uploadInput(page).setInputFiles({ name: "partial.pdf", mimeType: "application/pdf", buffer: makeTwoFundCasPdf() });
    await expect(page.locator(".reconcile-bar")).toContainText("1/2 funds updated");
    await expect(page.locator(".valuation-notice.live")).toBeVisible();
    await expect(page.locator(".summary-exact-value")).toHaveText("₹23,000.00");
    await expect(page.locator(".fund-group")).toHaveCount(2);
  });

  test("partial latest-NAV coverage warns prominently about unmatched schemes", async ({ page }) => {
    test.fail(true, "working-version-11 stores liveUpdateError but the live valuation notice never renders it");
    await page.route("**/api/nav", (route) => route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: `100001;${PARTIAL_FIRST_ISIN};;Testhouse Flexi Cap Direct Growth;15.0000;14-Aug-2026\n`,
    }));
    await mockDailyHistory(page);
    await page.goto("/");
    await waitForHydration(page);
    await uploadInput(page).setInputFiles({ name: "partial-warning.pdf", mimeType: "application/pdf", buffer: makeTwoFundCasPdf() });
    await expect(page.locator(".valuation-notice.live")).toContainText("1 fund could not be updated from AMFI", { timeout: 500 });
  });

  test("dialog focus behavior is explicitly characterized for keyboard regression", async ({ page }) => {
    test.fail(true, "working-version-11 does not focus, trap, Escape-close, or restore focus for its modal drawer");
    await openDemo(page);
    const opener = page.locator(".fund-group .fund-row").first();
    await opener.focus();
    await opener.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Aurora Small Cap Direct Growth" });
    await expect(dialog).toBeVisible();

    await expect.soft(dialog.getByRole("button", { name: "Close fund details" })).toBeFocused({ timeout: 500 });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0, { timeout: 500 });
    await expect(opener).toBeFocused();
  });

  test("a second upload winning the race cannot be overwritten by stale history", async ({ page }) => {
    test.fail(true, "working-version-11 does not sequence or cancel concurrent Landing.processFile calls");
    let latestRequest = 0;
    await page.route("**/api/nav", async (route) => {
      latestRequest += 1;
      const requestOrdinal = latestRequest;
      await new Promise((resolve) => setTimeout(resolve, requestOrdinal === 1 ? 900 : 50));
      await route.fulfill({ status: 200, contentType: "text/plain", body: latestNavText({ nav: requestOrdinal === 1 ? 15 : 16 }) });
    });
    await page.route("**/api/nav-history?**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dailyHistoryPayload({ finalNav: 16 })) });
    });
    await page.goto("/");
    await waitForHydration(page);
    await uploadInput(page).setInputFiles({ name: "first.pdf", mimeType: "application/pdf", buffer: makeCasPdf() });
    await page.waitForTimeout(100);
    const secondPdf = makeCasPdf().toString("base64");
    await page.locator(".upload-card").evaluate((target, encodedPdf) => {
      const binary = atob(encodedPdf);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "second.pdf", { type: "application/pdf" }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, secondPdf);

    await expect(page.getByRole("heading", { name: "Your funds" })).toBeVisible();
    await expect(page.locator(".summary-exact-value")).toHaveText("₹16,000.00", { timeout: 2_000 });
    await page.waitForTimeout(1_700);
    await expect(page.locator(".summary-exact-value")).toHaveText("₹16,000.00", { timeout: 500 });
  });

  test("demo dashboard reaches interactive readiness within a generous MVP smoke budget", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile-chromium", "Desktop smoke budget is not comparable to device emulation.");
    const assertNoErrors = await installFailureGuards(page);
    const started = Date.now();
    await openDemo(page);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(8_000);
    await expect(page.locator('.chart-card canvas[role="img"]').first()).toHaveAttribute("data-visible-points", "58");
    assertNoErrors();
  });
});
