import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, openDemo } from "./helpers/app";

const inflationRows = Array.from({ length: 30 }, (_, index) => {
  const year = 1996 + index;
  const value = year === 2010 ? 11.99 : year === 2025 ? 4.95 : 3.2 + (index % 7) * 0.61;
  return {
    countryiso3code: "IND",
    date: String(year),
    value,
    indicator: { id: "FP.CPI.TOTL.ZG", value: "Inflation, consumer prices (annual %)" },
  };
}).reverse();

test.describe("India inflation context", () => {
  test("loads 30 years directly in the browser and supports keyboard inspection", async ({ page }) => {
    const requests: Array<{ method: string; url: string; postData: string | null }> = [];
    page.on("request", (request) => {
      if (request.url().startsWith("https://api.worldbank.org/")) {
        requests.push({ method: request.method(), url: request.url(), postData: request.postData() });
      }
    });
    await page.route("https://api.worldbank.org/v2/country/IND/indicator/**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify([{ total: 30 }, inflationRows]),
    }));

    await openDemo(page);
    const card = page.locator(".inflation-card");
    await expect(card).toHaveAttribute("data-load-state", "waiting");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveAttribute("data-load-state", "ready");
    await expect(card).toHaveAttribute("data-observations", "30");
    await expect(card.getByRole("heading", { name: "India inflation, year by year" })).toBeVisible();
    await expect(card.getByLabel("Inflation highlights")).toContainText("Latest · 2025");
    await expect(card.getByLabel("Inflation highlights")).toContainText("4.95%");
    await expect(card.getByLabel("Inflation highlights")).toContainText("Highest · 2010");

    const chart = card.getByRole("img", { name: /India inflation, year by year/i });
    await expect(chart).toHaveAttribute("data-start-year", "1996");
    await expect(chart).toHaveAttribute("data-end-year", "2025");
    await chart.focus();
    await chart.press("Home");
    await expect(card.locator(".fund-comparison-live")).toContainText("1996:");
    await chart.press("End");
    await expect(card.locator(".fund-comparison-live")).toContainText("2025: 4.95%");

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("GET");
    expect(requests[0].postData).toBeNull();
    const url = new URL(requests[0].url);
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("date")).toMatch(/^1990:\d{4}$/);
    expect(requests[0].url).not.toMatch(/folio|portfolio|INF\d/i);
    await expectNoHorizontalOverflow(page);
  });

  test("keeps portfolio state intact when the public data source fails and retries", async ({ page }) => {
    let attempts = 0;
    await page.route("https://api.worldbank.org/v2/country/IND/indicator/**", (route) => {
      attempts += 1;
      if (attempts === 1) return route.fulfill({ status: 503, body: "unavailable" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ total: 30 }, inflationRows]) });
    });

    await openDemo(page);
    const card = page.locator(".inflation-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveAttribute("data-load-state", "error");
    await expect(card).toContainText("Your portfolio data is unaffected");
    await card.getByRole("button", { name: "Retry" }).click();
    await expect(card).toHaveAttribute("data-load-state", "ready");
    await expect(page.locator(".summary-main h1")).toHaveText("₹30.70 L");
    expect(attempts).toBe(2);
  });
});
