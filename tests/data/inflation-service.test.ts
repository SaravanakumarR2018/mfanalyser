import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIndiaInflationUrl,
  INDIA_INFLATION_INDICATOR,
  loadIndiaInflation,
  parseIndiaInflationResponse,
} from "../../app/inflation-service.ts";

const row = (year: number, value: unknown, overrides: Record<string, unknown> = {}) => ({
  countryiso3code: "IND",
  date: String(year),
  value,
  indicator: { id: INDIA_INFLATION_INDICATOR, value: "Inflation, consumer prices (annual %)" },
  ...overrides,
});

test("builds a public World Bank request for India without portfolio parameters", () => {
  const url = new URL(buildIndiaInflationUrl(2026));
  assert.equal(url.origin, "https://api.worldbank.org");
  assert.equal(url.pathname, `/v2/country/IND/indicator/${INDIA_INFLATION_INDICATOR}`);
  assert.equal(url.searchParams.get("format"), "json");
  assert.equal(url.searchParams.get("date"), "1990:2026");
  assert.equal(url.searchParams.get("per_page"), "100");
  assert.throws(() => buildIndiaInflationUrl(1989), /valid current year/);
  assert.throws(() => buildIndiaInflationUrl(2101), /valid current year/);
  assert.throws(() => buildIndiaInflationUrl(2026.5), /valid current year/);
});

test("validates, sorts, deduplicates, and retains the latest 30 observations", () => {
  const validRows = Array.from({ length: 35 }, (_, index) => row(1991 + index, 3 + index / 10));
  const payload = [{ total: 35 }, [
    ...validRows.reverse(),
    row(2025, 4.95),
    null,
    "invalid",
    row(2024, 5, { countryiso3code: "USA" }),
    row(2024, 5, { indicator: null }),
    row(2024, 5, { indicator: { id: "OTHER" } }),
    row(1989, 5),
    row(2101, 5),
    row(2024, null),
    row(2024, Number.NaN),
    row(2024, -101),
    row(2024, 101),
    row(2024, 5, { date: 2024 }),
  ]];

  const points = parseIndiaInflationResponse(payload);
  assert.equal(points.length, 30);
  assert.deepEqual(points[0], { year: 1996, value: 3.5 });
  assert.deepEqual(points.at(-1), { year: 2025, value: 4.95 });
  assert.ok(points.every((point, index) => index === 0 || point.year > points[index - 1].year));
});

test("rejects malformed and insufficient World Bank responses", () => {
  assert.throws(() => parseIndiaInflationResponse(null), /unexpected response/);
  assert.throws(() => parseIndiaInflationResponse([{}]), /unexpected response/);
  assert.throws(() => parseIndiaInflationResponse([{}, [row(2025, 4.9)]]), /currently unavailable/);
});

test("loads inflation with a read-only abortable client request", async () => {
  const controller = new AbortController();
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const points = await loadIndiaInflation({
    currentYear: 2026,
    signal: controller.signal,
    fetcher: async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return {
        ok: true,
        json: async () => [{}, [row(2024, 5.1), row(2025, 4.95)]],
      } as Response;
    },
  });

  assert.equal(requestedInit?.method, "GET");
  assert.equal((requestedInit?.headers as Record<string, string>).Accept, "application/json");
  assert.equal(requestedInit?.signal, controller.signal);
  assert.match(requestedUrl, /country\/IND\/indicator\/FP\.CPI\.TOTL\.ZG/);
  assert.deepEqual(points, [{ year: 2024, value: 5.1 }, { year: 2025, value: 4.95 }]);

  await assert.rejects(() => loadIndiaInflation({
    currentYear: 2026,
    fetcher: async () => ({ ok: false, status: 503 } as Response),
  }), /could not be loaded/);
});
