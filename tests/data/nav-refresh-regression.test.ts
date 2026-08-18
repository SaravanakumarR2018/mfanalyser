import assert from "node:assert/strict";
import test from "node:test";

import { demoPortfolio, type Portfolio } from "../../app/cas-parser.ts";
import {
  loadFullSchemeNavHistory,
  parseAmfiNavText,
  refreshWithDailyHistory,
  refreshWithLatestNav,
} from "../../app/nav-service.ts";
import { activeFund, casPortfolio, closedFund } from "./helpers.ts";

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

const amfiLine = (
  code: string,
  isin: string,
  nav: number,
  date: string,
  name = `Official ${isin}`,
  reinvestmentIsin = "",
) => `${code};${isin};${reinvestmentIsin};${name};${nav};${date}`;

test("AMFI text parsing accepts both ISIN fields, rejects unsafe rows, and keeps the newest duplicate", () => {
  const records = parseAmfiNavText([
    "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date",
    amfiLine("1001", "INF000A00001", 10, "01-Feb-2026", "Fund A", "INF000A00002"),
    amfiLine("1001", "INF000A00001", 11, "03-Feb-2026", "Fund A"),
    amfiLine("1001", "INF000A00001", 99, "02-Feb-2026", "older duplicate"),
    amfiLine("bad", "NOT-AN-ISIN", 12, "03-Feb-2026"),
    amfiLine("bad", "INF000A00003", 0, "03-Feb-2026"),
    amfiLine("bad", "INF000A00004", 12, "2026-02-03"),
    "truncated;row",
  ].join("\n"));

  assert.equal(records.size, 2);
  assert.deepEqual(records.get("INF000A00001"), {
    schemeCode: "1001",
    isin: "INF000A00001",
    nav: 11,
    date: "2026-02-03",
    schemeName: "Fund A",
  });
  assert.equal(records.get("INF000A00002")?.nav, 10);
});

test("the demo portfolio is never sent to network refresh and is returned by identity", async () => {
  let calls = 0;
  const result = await withFetch(async () => {
    calls += 1;
    throw new Error("must not be called");
  }, () => refreshWithLatestNav(demoPortfolio));

  assert.equal(result, demoPortfolio);
  assert.equal(calls, 0);
});

test("latest NAV refresh updates every active folio, enriches closed funds, and appends one live endpoint", async () => {
  const fundA = activeFund({ key: "a", isin: "INF000A00001", units: 10, invested: 100, nav: 11 });
  const fundB = activeFund({ key: "b", isin: "INF000A00002", units: 20, invested: 100, nav: 5 });
  const exited = closedFund({ name: "Demat", isin: "INF000A00003" });
  const original = casPortfolio([fundA, fundB], [exited]);
  const response = [
    amfiLine("1001", fundA.isin, 12, "02-Feb-2026", "Official A"),
    amfiLine("1002", fundB.isin, 6, "01-Feb-2026", "Official B"),
    amfiLine("1003", exited.isin, 14, "02-Feb-2026", "Official Closed Scheme"),
  ].join("\n");

  const refreshed = await withFetch(
    async (input, init) => {
      assert.equal(input, "/api/nav");
      assert.equal(init?.cache, "no-store");
      assert.ok(init?.signal instanceof AbortSignal);
      return new Response(response);
    },
    () => refreshWithLatestNav(original),
  );

  assert.equal(refreshed.valuationDate, "2026-02-02");
  assert.equal(refreshed.valuationSource, "amfi");
  assert.equal(refreshed.currentValue, 240);
  assert.deepEqual(refreshed.navCoverage, { updated: 2, total: 2 });
  assert.deepEqual(refreshed.navHistoryCoverage, { updated: 0, total: 3 });
  assert.equal(refreshed.navHistoryLoading, true);
  assert.equal(refreshed.navHistoryError, undefined);
  assert.equal(refreshed.liveUpdateError, undefined);
  assert.deepEqual(refreshed.funds.map((fund) => ({
    key: fund.key,
    value: fund.currentValue,
    nav: fund.nav,
    date: fund.navDate,
    live: fund.liveNav,
    code: fund.schemeCode,
    folioValue: fund.folioHoldings[0].currentValue,
    folioLive: fund.folioHoldings[0].liveNav,
  })), [
    { key: "a", value: 120, nav: 12, date: "2026-02-02", live: true, code: "1001", folioValue: 120, folioLive: true },
    { key: "b", value: 120, nav: 6, date: "2026-02-01", live: true, code: "1002", folioValue: 120, folioLive: true },
  ]);
  assert.deepEqual(
    { name: refreshed.closedFunds[0].name, code: refreshed.closedFunds[0].schemeCode },
    { name: "Official Closed Scheme", code: "1003" },
  );
  assert.deepEqual(refreshed.timeline.at(-1), {
    date: "2026-02-02",
    invested: 200,
    value: 240,
    live: true,
    transaction: false,
    transactionAmount: undefined,
    transactionCount: undefined,
  });

  assert.equal(original.valuationSource, "cas");
  assert.equal(original.funds[0].nav, 11);
  assert.equal(original.timeline.some((point) => point.live), false);
});

test("latest NAV refresh preserves unmatched funds and reports partial coverage", async () => {
  const fundA = activeFund({ key: "a", isin: "INF000A00001", units: 10, invested: 100, nav: 11 });
  const fundB = activeFund({ key: "b", isin: "INF000A00002", units: 20, invested: 100, nav: 5 });
  const original = casPortfolio([fundA, fundB]);
  const refreshed = await withFetch(
    async () => new Response(amfiLine("1001", fundA.isin, 12, "02-Feb-2026")),
    () => refreshWithLatestNav(original),
  );

  assert.equal(refreshed.currentValue, 220);
  assert.deepEqual(refreshed.navCoverage, { updated: 1, total: 2 });
  assert.equal(refreshed.liveUpdateError, "1 fund could not be updated from AMFI.");
  assert.equal(refreshed.funds.find((fund) => fund.key === "b"), fundB);
  assert.equal(refreshed.funds.find((fund) => fund.key === "a")?.currentValue, 120);
});

test("latest NAV refresh fails closed for server, malformed, no-match, and stale-only data", async (context) => {
  const portfolio = casPortfolio();
  const cases: Array<{ name: string; response: Response; message: RegExp }> = [
    {
      name: "server error",
      response: new Response("unavailable", { status: 503 }),
      message: /temporarily unavailable/,
    },
    {
      name: "malformed body",
      response: new Response("not;safe"),
      message: /could not be read safely/,
    },
    {
      name: "no matching scheme",
      response: new Response(amfiLine("9999", "INF999A99999", 12, "02-Feb-2026")),
      message: /None of the statement schemes matched/,
    },
    {
      name: "stale matching scheme",
      response: new Response(amfiLine("1001", portfolio.funds[0].isin, 9, "01-Jan-2026")),
      message: /None of the statement schemes matched/,
    },
  ];

  for (const item of cases) {
    await context.test(item.name, async () => {
      const result = await withFetch(async () => item.response.clone(), () => refreshWithLatestNav(portfolio));
      assert.equal(result.valuationSource, "cas");
      assert.equal(result.currentValue, portfolio.currentValue);
      assert.equal(result.funds[0], portfolio.funds[0]);
      assert.deepEqual(result.navCoverage, { updated: 0, total: 1 });
      assert.deepEqual(result.navHistoryCoverage, { updated: 0, total: 1 });
      assert.equal(result.navHistoryLoading, false);
      assert.equal(result.navHistoryError, "Daily NAV history requires a successful AMFI scheme match.");
      assert.match(result.liveUpdateError ?? "", item.message);
    });
  }
});

test("repeating the same latest NAV refresh replaces rather than duplicates the live endpoint", async () => {
  const portfolio = casPortfolio();
  const responseText = amfiLine("1001", portfolio.funds[0].isin, 12, "02-Feb-2026");
  const twice = await withFetch(async () => new Response(responseText), async () => {
    const once = await refreshWithLatestNav(portfolio);
    const twiceResult = await refreshWithLatestNav(once);
    assert.equal(twiceResult.timeline.length, once.timeline.length);
    assert.deepEqual(twiceResult.timeline, once.timeline);
    return twiceResult;
  });
  assert.equal(twice.timeline.filter((point) => point.date === "2026-02-02").length, 1);
});

test("full scheme history loads the earliest published series on demand and reconciles its live endpoint", async () => {
  let calls = 0;
  const points = await withFetch(async (input, init) => {
    calls += 1;
    const url = new URL(String(input), "http://localhost");
    assert.equal(url.origin + url.pathname, "https://api.mfapi.in/mf/1001");
    assert.equal(url.searchParams.get("startDate"), "1900-01-01");
    assert.equal(url.searchParams.get("endDate"), "2026-02-02");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json({
      status: "SUCCESS",
      meta: { scheme_code: "1001" },
      data: [
        { date: "02-02-2026", nav: "12.0000" },
        { date: "15-05-2004", nav: "10.2500" },
        { date: "01-01-1900", nav: "0" },
      ],
    });
  }, () => loadFullSchemeNavHistory("1001", "2026-02-02", 12, "2026-02-02"));

  assert.equal(calls, 1);
  assert.deepEqual(points, [
    { date: "2004-05-15", nav: 10.25 },
    { date: "2026-02-02", nav: 12 },
  ]);
});

test("full scheme history rejects unsafe identity inputs and a live NAV mismatch", async () => {
  let calls = 0;
  await assert.rejects(
    () => withFetch(async () => {
      calls += 1;
      throw new Error("must not fetch");
    }, () => loadFullSchemeNavHistory("scheme-1001", "2026-02-02")),
    /unavailable/,
  );
  assert.equal(calls, 0);

  await assert.rejects(
    () => withFetch(async () => Response.json({
      status: "SUCCESS",
      meta: { scheme_code: "1001" },
      data: [
        { date: "02-02-2026", nav: "11.9990" },
        { date: "15-05-2004", nav: "10.2500" },
      ],
    }), () => loadFullSchemeNavHistory("1001", "2026-02-02", 12, "2026-02-02")),
    /did not reconcile/,
  );
});

const livePortfolio = (): Portfolio => {
  const fundA = activeFund({
    key: "a", isin: "INF000A00001", schemeCode: "1001", units: 10,
    invested: 100, nav: 12, navDate: "2026-02-02",
  });
  const fundB = activeFund({
    key: "b", isin: "INF000A00002", schemeCode: "1002", units: 20,
    invested: 100, nav: 6, navDate: "2026-02-02", transactionDate: "2026-01-10",
  });
  fundA.liveNav = true;
  fundA.folioHoldings[0].liveNav = true;
  fundB.liveNav = true;
  fundB.folioHoldings[0].liveNav = true;
  const exited = closedFund({ schemeCode: "1003" });
  const portfolio = casPortfolio([fundA, fundB], [exited]);
  portfolio.valuationDate = "2026-02-02";
  portfolio.valuationSource = "amfi";
  portfolio.currentValue = 240;
  portfolio.timeline[portfolio.timeline.length - 1] = {
    date: "2026-02-02",
    invested: 200,
    value: 240,
    live: true,
  };
  portfolio.navCoverage = { updated: 2, total: 2 };
  portfolio.navHistoryCoverage = { updated: 0, total: 3 };
  portfolio.navHistoryLoading = true;
  return portfolio;
};

const mirrorHistory = (schemeCode: string) => {
  const records: Record<string, Array<{ date: string; nav: number }>> = {
    "1001": [
      { date: "02-01-2026", nav: 10 },
      { date: "10-01-2026", nav: 11 },
      { date: "20-01-2026", nav: 11.5 },
      { date: "02-02-2026", nav: 12 },
    ],
    "1002": [
      { date: "10-01-2026", nav: 5 },
      { date: "20-01-2026", nav: 5.5 },
      { date: "02-02-2026", nav: 6 },
    ],
    "1003": [
      { date: "02-01-2026", nav: 10 },
      { date: "10-01-2026", nav: 12 },
      { date: "20-01-2026", nav: 14 },
    ],
  };
  return { meta: { scheme_code: schemeCode }, data: records[schemeCode] ?? [] };
};

test("daily history refresh loads each scheme, reports progress, and builds only complete portfolio dates", async () => {
  const portfolio = livePortfolio();
  const urls: string[] = [];
  const progress: Array<{ completed: number; total: number }> = [];
  const refreshed = await withFetch(async (input) => {
    const url = new URL(String(input), "http://localhost");
    urls.push(url.href);
    const schemeCode = url.pathname.split("/").at(-1) ?? "";
    assert.equal(url.origin, "https://api.mfapi.in");
    assert.equal(url.searchParams.get("endDate"), "2026-02-02");
    return Response.json(mirrorHistory(schemeCode));
  }, () => refreshWithDailyHistory(portfolio, undefined, (value) => progress.push(value)));

  assert.equal(urls.length, 3);
  assert.deepEqual(new Set(urls.map((url) => new URL(url).pathname.split("/").at(-1))), new Set(["1001", "1002", "1003"]));
  assert.deepEqual(refreshed.navHistoryCoverage, { updated: 3, total: 3 });
  assert.equal(refreshed.navHistoryLoading, false);
  assert.equal(refreshed.navHistoryError, undefined);
  assert.deepEqual(refreshed.funds[0].navHistory, [
    { date: "2026-01-02", nav: 10 },
    { date: "2026-01-10", nav: 11 },
    { date: "2026-01-20", nav: 11.5 },
    { date: "2026-02-02", nav: 12 },
  ]);
  assert.equal(refreshed.funds[0].folioHoldings[0].navHistory, refreshed.funds[0].navHistory);
  assert.deepEqual(progress[0], { completed: 0, total: 3 });
  assert.deepEqual(progress.at(-1), { completed: 3, total: 3 });
  assert.ok(progress.every((value, index) => index === 0 || value.completed >= progress[index - 1].completed));

  const jan10 = refreshed.timeline.find((point) => point.date === "2026-01-10");
  assert.deepEqual(jan10, {
    date: "2026-01-10",
    invested: 250,
    value: 270,
    daily: true,
    exact: false,
    live: false,
    nav: undefined,
    transaction: true,
    transactionAmount: 100,
    transactionCount: 1,
  });
  assert.deepEqual(refreshed.timeline.at(-1), {
    date: "2026-02-02",
    invested: 200,
    value: 240,
    live: true,
    daily: true,
    exact: false,
    nav: undefined,
    transaction: false,
    transactionAmount: undefined,
    transactionCount: undefined,
  });
});

test("daily history accepts the grouped API format and filters invalid observations", async () => {
  const portfolio = livePortfolio();
  portfolio.funds = [portfolio.funds[0]];
  portfolio.closedFunds = [];
  portfolio.currentValue = 120;
  portfolio.invested = 100;
  portfolio.navHistoryCoverage = { updated: 0, total: 1 };
  const payload = {
    data: {
      nav_groups: [{
        historical_records: [
          { date: "2026-01-02", nav: 10 },
          { date: "bad-date", nav: 99 },
          { date: "2026-01-10", nav: -1 },
          { date: "2026-02-02", nav: 12 },
        ],
      }],
    },
  };
  const refreshed = await withFetch(
    async () => Response.json(payload),
    () => refreshWithDailyHistory(portfolio),
  );

  assert.deepEqual(refreshed.funds[0].navHistory, [
    { date: "2026-01-02", nav: 10 },
    { date: "2026-02-02", nav: 12 },
  ]);
  assert.deepEqual(refreshed.navHistoryCoverage, { updated: 1, total: 1 });
});

test("daily history honors Retry-After on throttling and succeeds on the next attempt", async () => {
  const portfolio = livePortfolio();
  portfolio.funds = [portfolio.funds[0]];
  portfolio.closedFunds = [];
  portfolio.currentValue = 120;
  portfolio.invested = 100;
  portfolio.navHistoryCoverage = { updated: 0, total: 1 };
  let calls = 0;
  const refreshed = await withFetch(async () => {
    calls += 1;
    if (calls === 1) {
      return new Response("throttled", { status: 429, headers: { "retry-after": "0.001" } });
    }
    return Response.json(mirrorHistory("1001"));
  }, () => refreshWithDailyHistory(portfolio));

  assert.equal(calls, 2);
  assert.deepEqual(refreshed.navHistoryCoverage, { updated: 1, total: 1 });
  assert.equal(refreshed.navHistoryError, undefined);
});

test("daily history deduplicates one scheme request shared by multiple holdings", async () => {
  const portfolio = livePortfolio();
  portfolio.closedFunds = [];
  portfolio.funds[1].schemeCode = "1001";
  portfolio.funds[1].nav = 12;
  portfolio.funds[1].navDate = "2026-02-02";
  portfolio.navHistoryCoverage = { updated: 0, total: 2 };
  let calls = 0;
  const refreshed = await withFetch(async (input) => {
    calls += 1;
    const schemeCode = new URL(String(input), "http://localhost").pathname.split("/").at(-1) ?? "";
    return Response.json(mirrorHistory(schemeCode));
  }, () => refreshWithDailyHistory(portfolio));

  assert.equal(calls, 1);
  assert.deepEqual(refreshed.navHistoryCoverage, { updated: 2, total: 2 });
  assert.deepEqual(refreshed.funds[1].navHistory, refreshed.funds[0].navHistory);
});

test("missing scheme codes finish cleanly with explicit incomplete coverage and no estimates", async () => {
  const portfolio = livePortfolio();
  portfolio.funds[1].schemeCode = undefined;
  let calls = 0;
  const refreshed = await withFetch(async (input) => {
    calls += 1;
    const schemeCode = new URL(String(input), "http://localhost").pathname.split("/").at(-1) ?? "";
    return Response.json(mirrorHistory(schemeCode));
  }, () => refreshWithDailyHistory(portfolio));

  assert.equal(calls, 2);
  assert.deepEqual(refreshed.navHistoryCoverage, { updated: 2, total: 3 });
  assert.equal(refreshed.navHistoryLoading, false);
  assert.equal(refreshed.navHistoryError, "Official daily NAV history was incomplete for 1 scheme; no values were estimated for missing dates.");
  assert.equal(refreshed.funds[1].navHistory, undefined);
});

test("history that disagrees with the official endpoint is excluded after reconciliation", async () => {
  const portfolio = livePortfolio();
  portfolio.funds = [portfolio.funds[0]];
  portfolio.closedFunds = [];
  portfolio.navHistoryCoverage = { updated: 0, total: 1 };
  let calls = 0;
  const refreshed = await withFetch(async () => {
    calls += 1;
    return Response.json({
      meta: { scheme_code: "1001" },
      data: [
        { date: "02-01-2026", nav: 10 },
        { date: "02-02-2026", nav: 99 },
      ],
    });
  }, () => refreshWithDailyHistory(portfolio));

  assert.equal(calls, 1);
  assert.deepEqual(refreshed.navHistoryCoverage, { updated: 0, total: 1 });
  assert.equal(refreshed.funds[0].navHistory, undefined);
  assert.match(refreshed.navHistoryError ?? "", /incomplete for 1 scheme/);
});

test("daily history cancellation is surfaced without mutating loaded data", async () => {
  const portfolio = livePortfolio();
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const refreshed = await withFetch(async () => {
    calls += 1;
    return Response.json({});
  }, () => refreshWithDailyHistory(portfolio, controller.signal));

  assert.equal(calls, 0);
  assert.equal(refreshed.navHistoryLoading, false);
  assert.equal(refreshed.navHistoryError, "History load cancelled.");
  assert.equal(refreshed.funds, portfolio.funds);
});

test("daily history rerun is a no-op after loading completes", async () => {
  const portfolio = livePortfolio();
  portfolio.navHistoryLoading = false;
  let calls = 0;
  const result = await withFetch(async () => {
    calls += 1;
    return Response.json({});
  }, () => refreshWithDailyHistory(portfolio));

  assert.equal(result, portfolio);
  assert.equal(calls, 0);
});
