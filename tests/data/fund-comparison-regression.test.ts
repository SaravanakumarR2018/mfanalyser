import assert from "node:assert/strict";
import test from "node:test";

import type { FundTransaction, HistoricalNavPoint } from "../../app/cas-parser.ts";
import {
  buildFundComparisonCandidates,
  buildFundComparisonModel,
  buildFundComparisonScale,
  fundComparisonLineWidth,
  fundComparisonTooltipAt,
  preserveFundComparisonDateRange,
  rebaseFundComparisonModel,
  shouldStartFundComparisonHistoryLoad,
  type FundComparisonCandidate,
} from "../../app/fund-comparison-service.ts";
import { loadFundComparisonHistories } from "../../app/nav-service.ts";
import { scaleForVerticalRange } from "../../app/vertical-range.ts";
import { activeFund, casPortfolio, closedFund, transaction } from "./helpers.ts";

const candidate = (
  key: string,
  schemeCode: string | undefined,
  transactions: FundTransaction[] = [],
): FundComparisonCandidate => ({
  key,
  name: `Fund ${key}`,
  isin: `INF${key.padEnd(9, "0").slice(0, 9)}`,
  schemeCode,
  category: "Test",
  active: true,
  closed: false,
  transactions,
});

test("comparison history waits for daily enrichment, then preloads without a viewport dependency", () => {
  assert.equal(shouldStartFundComparisonHistoryLoad(true, 30), false);
  assert.equal(shouldStartFundComparisonHistoryLoad(false, 30), true);
  assert.equal(shouldStartFundComparisonHistoryLoad(undefined, 30), true);
  assert.equal(shouldStartFundComparisonHistoryLoad(false, 0), false);
  assert.equal(shouldStartFundComparisonHistoryLoad(false, -1), false);
  assert.equal(shouldStartFundComparisonHistoryLoad(false, 1.5), false);
});

test("comparison lines are thin at rest and only become bold when emphasized", () => {
  const resting = fundComparisonLineWidth("resting");
  const emphasized = fundComparisonLineWidth("emphasized");
  const dimmed = fundComparisonLineWidth("dimmed");

  assert.equal(resting, 1.15);
  assert.equal(emphasized, 3.2);
  assert.equal(dimmed, 0.85);
  assert.ok(dimmed < resting);
  assert.ok(resting < emphasized);
});

const withFetch = async <T>(
  replacement: typeof globalThis.fetch,
  action: () => Promise<T>,
) => {
  const original = globalThis.fetch;
  globalThis.fetch = replacement;
  try {
    return await action();
  } finally {
    globalThis.fetch = original;
  }
};

test("comparison candidates include active and closed schemes while removing fund/folio duplicates", () => {
  const active = activeFund({ key: "active", isin: "INF000A00001", schemeCode: "1001" });
  active.liveNav = true;
  active.nav = 12;
  active.navDate = "2026-02-02";
  active.folioHoldings[0].transactions.push(
    transaction("2026-01-10", 50, 5, 10, 15, "extra-folio"),
  );
  const closed = closedFund({ isin: active.isin, schemeCode: "1001" });
  const portfolio = casPortfolio([active], [closed]);

  const candidates = buildFundComparisonCandidates(portfolio);

  assert.equal(candidates.length, 1);
  assert.deepEqual({
    key: candidates[0].key,
    active: candidates[0].active,
    closed: candidates[0].closed,
    expectedNav: candidates[0].expectedNav,
    expectedNavDate: candidates[0].expectedNavDate,
    transactionCount: candidates[0].transactions.length,
  }, {
    key: "scheme:1001",
    active: true,
    closed: true,
    expectedNav: 12,
    expectedNavDate: "2026-02-02",
    transactionCount: 4,
  });
  assert.equal(
    candidates[0].transactions.filter((item) => item.holdingKey === "active-folio").length,
    1,
  );
  assert.equal(candidates[0].transactions.some((item) => item.holdingKey === "extra-folio"), true);
});

test("comparison candidates fall back to ISIN identity and retain legitimate duplicate transactions", () => {
  const fund = activeFund({ key: "active", isin: "INF000A00001" });
  fund.schemeCode = "unsafe-code";
  fund.transactions.push({ ...fund.transactions[0] });
  fund.folioHoldings[0].transactions = fund.transactions.map((item) => ({ ...item }));
  const candidates = buildFundComparisonCandidates(casPortfolio([fund]));

  assert.equal(candidates[0].key, "isin:INF000A00001");
  assert.equal(candidates[0].schemeCode, undefined);
  assert.equal(candidates[0].transactions.length, 2);

  const noIdentityA = activeFund({ key: "one", isin: "" });
  const noIdentityB = activeFund({ key: "two", isin: "" });
  assert.deepEqual(
    buildFundComparisonCandidates(casPortfolio([noIdentityA, noIdentityB])).map((item) => item.key),
    ["holding:one", "holding:two"],
  );
});

test("comparison candidates remain one line when a scheme code arrives after ISIN identity", () => {
  const initial = activeFund({ key: "initial", isin: "INF000A00001" });
  const upgraded = activeFund({ key: "upgraded", isin: initial.isin, schemeCode: "1001" });
  const alternateIsin = activeFund({ key: "alternate", isin: "INF000B00002", schemeCode: "1001" });

  const candidates = buildFundComparisonCandidates(casPortfolio([
    initial,
    upgraded,
    alternateIsin,
  ]));

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].key, "scheme:1001");
  assert.equal(candidates[0].schemeCode, "1001");
  assert.equal(candidates[0].transactions.length, 3);
});

test("comparison candidates merge transitive ISIN and scheme groups when the bridge arrives last", () => {
  const isinOnly = activeFund({ key: "isin-only", isin: "INF000A00001" });
  const schemeOnly = activeFund({ key: "scheme-only", isin: "INF000B00002", schemeCode: "1001" });
  const bridge = activeFund({ key: "bridge", isin: isinOnly.isin, schemeCode: "1001" });

  const candidates = buildFundComparisonCandidates(casPortfolio([isinOnly, schemeOnly, bridge]));

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].key, "scheme:1001");
  assert.equal(candidates[0].transactions.length, 3);
});

test("every selected scheme starts at 100 on its own earliest published date", () => {
  const fundA = candidate("a", "1001", [
    transaction("2026-01-02", 110, 10, 11, 10, "a"),
    transaction("2026-01-03", 60, 5, 12, 15, "a"),
    transaction("2026-01-03", -12, -1, 12, 14, "a"),
  ]);
  const fundB = candidate("b", "1002", [
    transaction("2026-01-04", 44, 2, 22, 2, "b"),
  ]);
  const histories = new Map<string, HistoricalNavPoint[]>([
    ["a", [
      { date: "2026-01-01", nav: 10 },
      { date: "2026-01-02", nav: 11 },
      { date: "2026-01-04", nav: 12 },
    ]],
    ["b", [
      { date: "2026-01-02", nav: 20 },
      { date: "2026-01-03", nav: 21 },
      { date: "2026-01-04", nav: 22 },
      { date: "2026-01-05", nav: 23 },
    ]],
  ]);

  const model = buildFundComparisonModel(
    [fundA, fundB],
    histories,
    new Set(["a", "b"]),
    "2026-01-05",
  );

  assert.equal(model.baselineDate, "2026-01-01");
  assert.deepEqual(model.series.map((series) => series.points[0].indexedValue), [100, 100]);
  assert.deepEqual(model.series[0].points.map((point) => point.date), ["2026-01-01", "2026-01-02", "2026-01-04"]);
  assert.equal(model.series[0].points.some((point) => point.date === "2026-01-03"), false);
  assert.equal(model.series[0].latestPoint?.indexedValue, 120);
  assert.deepEqual(model.dates, ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"]);

});

test("tooltip lookup uses only exact union dates and respects focused-series mode", () => {
  const candidates = [candidate("a", "1001"), candidate("b", "1002")];
  const model = buildFundComparisonModel(candidates, new Map([
    ["a", [{ date: "2026-01-01", nav: 10 }, { date: "2026-01-03", nav: 12 }]],
    ["b", [{ date: "2026-01-01", nav: 20 }, { date: "2026-01-02", nav: 21 }]],
  ]), new Set(["a", "b"]), "2026-01-03");

  assert.deepEqual(fundComparisonTooltipAt(model, "2026-01-02").map((entry) => ({
    key: entry.key,
    available: entry.available,
    nav: entry.nav,
  })), [
    { key: "a", available: false, nav: undefined },
    { key: "b", available: true, nav: 21 },
  ]);
  assert.deepEqual(fundComparisonTooltipAt(model, "2026-01-02", "a").map((entry) => ({
    key: entry.key,
    available: entry.available,
  })), [{ key: "a", available: false }]);
  assert.equal(fundComparisonTooltipAt(model, "2026-01-02", "missing").length, 0);
});

test("a selected range rebases each fund at its first exact observation inside the window", () => {
  const source = buildFundComparisonModel(
    [candidate("a", "1001"), candidate("b", "1002"), candidate("c", "1003")],
    new Map([
      ["a", [
        { date: "2026-01-01", nav: 10 },
        { date: "2026-01-03", nav: 12 },
        { date: "2026-01-05", nav: 18 },
      ]],
      ["b", [
        { date: "2026-01-02", nav: 20 },
        { date: "2026-01-04", nav: 30 },
      ]],
      ["c", [{ date: "2025-12-31", nav: 8 }]],
    ]),
    new Set(["a", "b", "c"]),
    "2026-01-05",
  );

  const visible = rebaseFundComparisonModel(source, "2026-01-02", "2026-01-04");

  assert.equal(visible.baselineDate, "2026-01-02");
  assert.deepEqual(visible.dates, ["2026-01-02", "2026-01-03", "2026-01-04"]);
  assert.deepEqual(visible.series.map((series) => ({
    key: series.key,
    baseNav: series.baseNav,
    dates: series.points.map((point) => point.date),
    values: series.points.map((point) => point.indexedValue),
  })), [
    { key: "a", baseNav: 12, dates: ["2026-01-03"], values: [100] },
    { key: "b", baseNav: 20, dates: ["2026-01-02", "2026-01-04"], values: [100, 150] },
  ]);
  assert.equal(visible.series.some((series) => series.key === "c"), false);
  assert.deepEqual(fundComparisonTooltipAt(visible, "2026-01-04", "b")[0], {
    key: "b",
    name: "Fund b",
    date: "2026-01-04",
    available: true,
    nav: 30,
    indexedValue: 150,
  });
  assert.deepEqual(rebaseFundComparisonModel(source, "2026-01-05", "2026-01-02"), {
    dates: [],
    series: [],
    unavailable: [],
    minIndex: 100,
    maxIndex: 100,
  });
});

test("comparison scale supports the same shared vertical min, max, and window math as fund contribution", () => {
  const source = buildFundComparisonModel(
    [candidate("a", "1001")],
    new Map([["a", [
      { date: "2026-01-01", nav: 10 },
      { date: "2026-01-02", nav: 15 },
    ]]]),
    new Set(["a"]),
    "2026-01-02",
  );

  const full = buildFundComparisonScale(source);
  assert.deepEqual(full, {
    min: 94,
    max: 156,
    step: 15.5,
    ticks: [94, 109.5, 125, 140.5, 156],
  });
  assert.deepEqual(scaleForVerticalRange(full, [250, 750]), {
    min: 109.5,
    max: 140.5,
    step: 5,
    ticks: [110, 115, 120, 125, 130, 135, 140],
  });
  assert.equal(buildFundComparisonScale({
    dates: [],
    series: [],
    unavailable: [],
    minIndex: 100,
    maxIndex: 100,
  }).min, 98);
});

test("custom comparison windows preserve calendar bounds when selected funds change union dates", () => {
  const previous = ["1990-01-01", "2020-01-01", "2022-01-01", "2024-01-01", "2026-01-01"];

  assert.deepEqual(
    preserveFundComparisonDateRange(
      previous,
      [2, 3],
      ["1990-01-01", "2022-01-01", "2024-01-01", "2026-01-01"],
    ),
    [1, 2],
  );
  assert.deepEqual(
    preserveFundComparisonDateRange(
      previous,
      [1, 3],
      ["1990-01-01", "2022-01-01", "2023-01-01", "2025-01-01", "2026-01-01"],
    ),
    [1, 2],
  );
  assert.deepEqual(preserveFundComparisonDateRange(previous, [2, 3], []), [0, 0]);
  assert.deepEqual(preserveFundComparisonDateRange(previous, [2, 3], ["2023-01-01"]), [0, 0]);
  assert.deepEqual(
    preserveFundComparisonDateRange([], [0, 0], ["2022-01-01", "2024-01-01"]),
    [0, 1],
  );
});

test("comparison normalization filters unsafe observations, future points, and does not mutate inputs", () => {
  const fund = candidate("a", "1001", [
    transaction("2026-01-02", 100, 10, 10, 10),
    { ...transaction("2026-01-03", 50, 5, 10, 15), amount: Number.NaN },
  ]);
  const history = [
    { date: "2026-02-31", nav: 99 },
    { date: "2026-01-02", nav: 9 },
    { date: "2026-01-02", nav: 10 },
    { date: "2026-01-03", nav: -1 },
    { date: "2026-01-04", nav: Number.NaN },
    { date: "2026-01-06", nav: 12 },
  ];
  const beforeFund = structuredClone(fund);
  const beforeHistory = structuredClone(history);

  const model = buildFundComparisonModel(
    [fund],
    new Map([["a", history]]),
    new Set(["a"]),
    "2026-01-05",
  );

  assert.deepEqual(model.series[0].points, [{ date: "2026-01-02", nav: 10, indexedValue: 100 }]);
  assert.deepEqual(fund, beforeFund);
  assert.deepEqual(history, beforeHistory);

  const invalidAsOf = buildFundComparisonModel(
    [fund],
    new Map([["a", history]]),
    new Set(["a"]),
    "2026-02-31",
  );
  assert.equal(invalidAsOf.series.length, 0);
  assert.equal(invalidAsOf.unavailable[0].reason, "missing-history");
});

test("comparison normalization drops derived values that cannot be rendered safely", () => {
  const model = buildFundComparisonModel(
    [candidate("a", "1001")],
    new Map([["a", [
      { date: "2026-01-01", nav: Number.MIN_VALUE },
      { date: "2026-01-02", nav: Number.MAX_VALUE },
    ]]]),
    new Set(["a"]),
    "2026-01-02",
  );

  assert.deepEqual(model.series[0].points, [{
    date: "2026-01-01",
    nav: Number.MIN_VALUE,
    indexedValue: 100,
  }]);
  assert.equal(Number.isFinite(model.maxIndex), true);

  const hugeFinite = buildFundComparisonModel(
    [candidate("b", "1002")],
    new Map([["b", [
      { date: "2026-01-01", nav: 100 },
      { date: "2026-01-02", nav: Number.MAX_VALUE },
    ]]]),
    new Set(["b"]),
    "2026-01-02",
  );
  assert.deepEqual(hugeFinite.series[0].points.map((point) => point.date), ["2026-01-01"]);
  assert.equal(hugeFinite.maxIndex, 100);
});

test("CAS transaction metadata cannot enter the published timeline or distort its scale", () => {
  const fund = candidate("a", "1001", [
    transaction("2026-01-02", 1_000, 1, 1_000, 1),
  ]);
  const model = buildFundComparisonModel(
    [fund],
    new Map([["a", [
      { date: "2026-01-01", nav: 10 },
      { date: "2026-01-03", nav: 11 },
    ]]]),
    new Set(["a"]),
    "2026-01-03",
  );

  assert.deepEqual(model.dates, ["2026-01-01", "2026-01-03"]);
  assert.equal(fundComparisonTooltipAt(model, "2026-01-02", "a")[0].available, false);
  assert.equal(model.minIndex, 100);
  assert.ok(Math.abs(model.maxIndex - 110) < 0.000001);
});

test("missing schemes and histories do not block non-overlapping eligible histories", () => {
  const availableA = candidate("a", "1001");
  const availableB = candidate("b", "1002");
  const missingScheme = candidate("c", undefined);
  const missingHistory = candidate("d", "1004");
  const candidates = [availableA, availableB, missingScheme, missingHistory];
  const histories = new Map<string, HistoricalNavPoint[]>([
    ["a", [{ date: "2026-01-01", nav: 10 }]],
    ["b", [{ date: "2026-01-02", nav: 20 }]],
  ]);

  const model = buildFundComparisonModel(
    candidates,
    histories,
    new Set(candidates.map((item) => item.key)),
    "2026-01-02",
  );
  assert.equal(model.series.length, 2);
  assert.equal(model.baselineDate, "2026-01-01");
  assert.deepEqual(model.series.map((series) => series.points[0].indexedValue), [100, 100]);
  assert.deepEqual(new Map(model.unavailable.map((item) => [item.key, item.reason])), new Map([
    ["c", "missing-scheme"],
    ["d", "missing-history"],
  ]));

  const eligibleOnly = buildFundComparisonModel(
    candidates,
    new Map([["a", [{ date: "2026-01-01", nav: 10 }]]]),
    new Set(["a", "c"]),
    "2026-01-02",
  );
  assert.equal(eligibleOnly.baselineDate, "2026-01-01");
  assert.equal(eligibleOnly.series.length, 1);
  assert.equal(eligibleOnly.unavailable[0].reason, "missing-scheme");

  const empty = buildFundComparisonModel(candidates, histories, new Set(), "2026-01-02");
  assert.deepEqual(empty, { dates: [], series: [], unavailable: [], minIndex: 100, maxIndex: 100 });
});

test("bulk comparison history loading deduplicates schemes and returns partial safe results", async () => {
  const a = candidate("a", "1001");
  const shared = candidate("shared", "1001");
  const unavailable = candidate("unavailable", "1002");
  const unmatched = candidate("unmatched", undefined);
  a.expectedNav = 12;
  a.expectedNavDate = "2026-02-02";
  const urls: URL[] = [];
  const progress: Array<{ completed: number; total: number }> = [];

  const result = await withFetch(async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    urls.push(url);
    assert.deepEqual([...url.searchParams.keys()].sort(), ["from_date", "query_type", "sd_id", "to_date"]);
    assert.equal(url.searchParams.get("from_date"), "1900-01-01");
    assert.equal(url.searchParams.get("to_date"), "2026-02-02");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal instanceof AbortSignal);
    if (url.searchParams.get("sd_id") === "1002") {
      return Response.json({ data: { nav_groups: [{ historical_records: [] }] } });
    }
    return Response.json({
      meta: { scheme_code: "1001" },
      data: [
        { date: "02-02-2026", nav: 12 },
        { date: "01-01-2005", nav: 10 },
      ],
    });
  }, () => loadFundComparisonHistories(
    [a, shared, unavailable, unmatched],
    "2026-02-02",
    undefined,
    (value) => progress.push(value),
  ));

  assert.equal(urls.length, 2);
  assert.deepEqual(new Set(urls.map((url) => url.searchParams.get("sd_id"))), new Set(["1001", "1002"]));
  assert.equal(result.historyByKey.has("a"), true);
  assert.equal(result.historyByKey.get("a"), result.historyByKey.get("shared"));
  assert.equal(result.failures.get("unavailable"), "Full published NAV history is unavailable for this scheme.");
  assert.equal(result.failures.get("unmatched"), "An official AMFI scheme match is unavailable.");
  assert.deepEqual(progress[0], { completed: 1, total: 4 });
  assert.deepEqual(progress.at(-1), { completed: 4, total: 4 });
  assert.ok(progress.every((item, index) => index === 0 || item.completed >= progress[index - 1].completed));
  assert.deepEqual({ completed: result.completed, total: result.total }, { completed: 4, total: 4 });
});

test("bulk comparison history rejects an inconsistent live endpoint without affecting another scheme", async () => {
  const mismatched = candidate("mismatch", "1001");
  mismatched.expectedNav = 12;
  mismatched.expectedNavDate = "2026-02-02";
  const valid = candidate("valid", "1002");

  const result = await withFetch(async (input) => {
    const schemeCode = new URL(String(input), "http://localhost").searchParams.get("sd_id");
    return Response.json({
      meta: { scheme_code: schemeCode },
      data: [{ date: "02-02-2026", nav: schemeCode === "1001" ? 99 : 5 }],
    });
  }, () => loadFundComparisonHistories([mismatched, valid], "2026-02-02"));

  assert.match(result.failures.get("mismatch") ?? "", /did not reconcile/);
  assert.equal(result.historyByKey.has("mismatch"), false);
  assert.deepEqual(result.historyByKey.get("valid"), [{ date: "2026-02-02", nav: 5 }]);

  const invalidExpected = candidate("invalid-expected", "1002");
  invalidExpected.expectedNav = Number.NaN;
  invalidExpected.expectedNavDate = "2026-02-02";
  const invalidResult = await withFetch(async () => Response.json({
    meta: { scheme_code: "1002" },
    data: [{ date: "02-02-2026", nav: 5 }],
  }), () => loadFundComparisonHistories([invalidExpected], "2026-02-02"));
  assert.match(invalidResult.failures.get("invalid-expected") ?? "", /did not reconcile/);

  const missingEndpoint = candidate("missing-endpoint", "1003");
  missingEndpoint.expectedNav = 12;
  missingEndpoint.expectedNavDate = "2026-02-02";
  const missingResult = await withFetch(async () => Response.json({
    meta: { scheme_code: "1003" },
    data: [{ date: "01-02-2026", nav: 12 }],
  }), () => loadFundComparisonHistories([missingEndpoint], "2026-02-02"));
  assert.match(missingResult.failures.get("missing-endpoint") ?? "", /did not reconcile/);
  assert.equal(missingResult.historyByKey.has("missing-endpoint"), false);
});

test("bulk comparison history rejects impossible upstream calendar dates", async () => {
  const fund = candidate("invalid-date", "1001");
  const result = await withFetch(async () => Response.json({
    meta: { scheme_code: "1001" },
    data: [{ date: "31-02-2026", nav: 12 }],
  }), () => loadFundComparisonHistories([fund], "2026-02-28"));

  assert.equal(result.historyByKey.has(fund.key), false);
  assert.equal(result.failures.get(fund.key), "Full published NAV history is unavailable for this scheme.");
});

test("bulk comparison loads all thirty schemes from 1900 and retains exact 1990 inception observations", async () => {
  const candidates = Array.from({ length: 30 }, (_, index) => candidate(
    `fund-${index + 1}`,
    String(2_000 + index),
  ));
  const urls: URL[] = [];
  const progress: Array<{ completed: number; total: number }> = [];
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) =>
    originalSetTimeout(callback, delay === 900 ? 0 : delay, ...args)) as typeof globalThis.setTimeout;
  try {
    const result = await withFetch(async (input) => {
      const url = new URL(String(input), "http://localhost");
      urls.push(url);
      return Response.json({
        meta: { scheme_code: url.searchParams.get("sd_id") },
        data: [
          { date: "14-08-2026", nav: 20 },
          { date: "01-01-1990", nav: 10 },
        ],
      });
    }, () => loadFundComparisonHistories(
      candidates,
      "2026-08-14",
      undefined,
      (value) => progress.push(value),
    ));

    assert.equal(urls.length, 30);
    assert.equal(result.historyByKey.size, 30);
    assert.equal(result.failures.size, 0);
    assert.ok(urls.every((url) => url.searchParams.get("from_date") === "1900-01-01"));
    assert.ok(urls.every((url) => url.searchParams.get("to_date") === "2026-08-14"));
    assert.deepEqual(progress.at(-1), { completed: 30, total: 30 });
    assert.ok([...result.historyByKey.values()].every((points) => points[0].date === "1990-01-01"));
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("bulk comparison history enforces four concurrent schemes and one inter-batch pause", async () => {
  const candidates = Array.from({ length: 5 }, (_, index) => candidate(
    `fund-${index}`,
    String(1001 + index),
  ));
  const originalSetTimeout = globalThis.setTimeout;
  const observedDelays: number[] = [];
  let active = 0;
  let maximumActive = 0;

  globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    observedDelays.push(Number(delay));
    return originalSetTimeout(callback, delay === 900 ? 0 : delay, ...args);
  }) as typeof globalThis.setTimeout;
  try {
    const result = await withFetch(async (input) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const schemeCode = new URL(String(input), "http://localhost").searchParams.get("sd_id") ?? "";
      return await new Promise<Response>((resolve) => {
        originalSetTimeout(() => {
          active -= 1;
          resolve(Response.json({
            meta: { scheme_code: schemeCode },
            data: [{ date: "02-02-2026", nav: 10 }],
          }));
        }, 5);
      });
    }, () => loadFundComparisonHistories(candidates, "2026-02-02"));

    assert.equal(maximumActive, 4);
    assert.equal(result.historyByKey.size, 5);
    assert.equal(observedDelays.filter((delay) => delay === 900).length, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("bulk comparison history propagates cancellation and validates the request date before fetching", async () => {
  const fund = candidate("a", "1001");
  const invalid = await withFetch(async () => {
    throw new Error("must not fetch");
  }, () => loadFundComparisonHistories([fund], "not-a-date"));
  assert.equal(invalid.historyByKey.size, 0);
  assert.equal(invalid.failures.has("a"), true);
  const invalidCalendar = await withFetch(async () => {
    throw new Error("must not fetch");
  }, () => loadFundComparisonHistories([fund], "2026-02-31"));
  assert.equal(invalidCalendar.failures.has("a"), true);

  const controller = new AbortController();
  await assert.rejects(
    () => withFetch(async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(
        new DOMException("request aborted", "AbortError"),
      ), { once: true });
      queueMicrotask(() => controller.abort());
    }), () => loadFundComparisonHistories([fund], "2026-02-02", controller.signal)),
    { name: "AbortError" },
  );

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(
    () => loadFundComparisonHistories([fund], "2026-02-02", alreadyAborted.signal),
    { name: "AbortError" },
  );
});
