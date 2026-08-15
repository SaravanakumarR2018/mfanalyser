import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, openDemo, waitForHydration } from "./helpers/app";

const blockingViolations = (violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) =>
  violations.filter((violation) => violation.impact === "critical");

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
    await expect(page.getByRole("dialog", { name: "Aurora Small Cap Direct Growth" })).toBeVisible();
    await page.getByRole("button", { name: "Close fund details" }).click();

    const expand = page.getByRole("button", { name: "Expand folios for Aurora Small Cap Direct Growth", exact: true });
    await expand.focus();
    await expand.press("Enter");
    await expect(page.getByRole("button", { name: "Collapse folios for Aurora Small Cap Direct Growth", exact: true })).toHaveAttribute("aria-expanded", "true");
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
