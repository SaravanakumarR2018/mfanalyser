import type { Page } from "@playwright/test";

export const inflationRows = Array.from({ length: 30 }, (_, index) => {
  const year = 1996 + index;
  const value = year === 2010 ? 11.99 : year === 2025 ? 4.95 : 3.2 + (index % 7) * 0.61;
  return {
    countryiso3code: "IND",
    date: String(year),
    value,
    indicator: { id: "FP.CPI.TOTL.ZG", value: "Inflation, consumer prices (annual %)" },
  };
}).reverse();

export async function installInflationMock(page: Page) {
  await page.route("https://api.worldbank.org/v2/country/IND/indicator/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify([{ total: 30 }, inflationRows]),
  }));
}
