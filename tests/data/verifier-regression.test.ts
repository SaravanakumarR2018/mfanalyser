import assert from "node:assert/strict";
import test from "node:test";

import type { Portfolio } from "../../app/cas-parser.ts";
import { parseCasFile } from "../../app/cas-parser.ts";
import { refreshWithDailyHistory } from "../../app/nav-service.ts";
import { activeFund, casPortfolio, pdfFile } from "./helpers.ts";

const liveHistoryPortfolio = (count = 1): Portfolio => {
  const funds = Array.from({ length: count }, (_, index) => {
    const suffix = String(index + 1).padStart(5, "0");
    const fund = activeFund({
      key: `fund-${index + 1}`,
      isin: `INF000A${suffix}`,
      schemeCode: String(1001 + index),
      nav: 12,
      navDate: "2026-02-02",
    });
    fund.liveNav = true;
    fund.folioHoldings[0].liveNav = true;
    return fund;
  });
  const portfolio = casPortfolio(funds);
  portfolio.valuationDate = "2026-02-02";
  portfolio.valuationSource = "amfi";
  portfolio.navHistoryCoverage = { updated: 0, total: count };
  portfolio.navHistoryLoading = true;
  return portfolio;
};

test("same-day CAS transactions survive replacement by the exact statement endpoint", async () => {
  const portfolio = await parseCasFile(pdfFile("same-day-endpoint.pdf", [
    "CAMS KFintech Consolidated Account Statement",
    "PORTFOLIO SUMMARY",
    "Total 150.00 165.00",
    "HDFC Small Cap Fund Direct Growth - ISIN: INF179K01ABC",
    "Folio No: 123456/78",
    "NAV on 31-Jul-2026: INR 11.0000 Market Value on 31-Jul-2026: INR 165.00",
    "Closing Unit Balance: 15.000 Total Cost Value: 150.00",
    "31-Jul-2026 Purchase 100.00 10.000 10.0000 10.000",
    "31-Jul-2026 SIP Purchase 50.00 5.000 10.0000 15.000",
  ]));

  assert.deepEqual(portfolio.timeline, [{
    date: "2026-07-31",
    invested: 150,
    value: 165,
    exact: true,
    transaction: true,
    transactionAmount: 150,
    transactionCount: 2,
  }]);
});

test("closed folios with one ISIN merge without losing proceeds, dates, or transaction labels", async () => {
  const portfolio = await parseCasFile(pdfFile("merged-closed-folios.pdf", [
    "CAMS KFintech Consolidated Account Statement",
    "PORTFOLIO SUMMARY",
    "Total 100.00 110.00",
    "HDFC Small Cap Fund Direct Growth - ISIN: INF179K01ABC",
    "Folio No: 123456/78",
    "NAV on 31-Jul-2026: INR 11.0000 Market Value on 31-Jul-2026: INR 110.00",
    "Closing Unit Balance: 10.000 Total Cost Value: 100.00",
    "01-Jan-2026 Purchase 100.00 10.000 10.0000 10.000",
    "Harbour Tax Saver Direct Growth - ISIN: INF000A00999",
    "Folio No: 111111/11",
    "02-Jan-2025 Switch In 40.00 4.000 10.0000 4.000",
    "20-Jan-2026 Redemption (50.00) (4.000) 12.5000 0.000",
    "Harbour Tax Saver Direct Growth - ISIN: INF000A00999",
    "Folio No: 222222/22",
    "03-Jan-2025 Dividend Reinvestment 60.00 6.000 10.0000 6.000",
    "20-Feb-2026 Switch Out (72.00) (6.000) 12.0000 0.000",
  ]));

  assert.equal(portfolio.closedFunds.length, 1);
  const closed = portfolio.closedFunds[0];
  assert.deepEqual({
    isin: closed.isin,
    realizedGain: closed.realizedGain,
    totalInvested: closed.totalInvested,
    totalProceeds: closed.totalProceeds,
    closedDate: closed.closedDate,
    folios: closed.folios,
    labels: closed.transactions.map((transaction) => transaction.label),
  }, {
    isin: "INF000A00999",
    realizedGain: 22,
    totalInvested: 100,
    totalProceeds: 122,
    closedDate: "2026-02-20",
    folios: 2,
    labels: ["Switch in", "Redemption", "Dividend", "Switch out"],
  });
});

test("daily history enforces the four-request concurrency cap and inter-batch pause", async () => {
  const portfolio = liveHistoryPortfolio(5);
  const originalSetTimeout = globalThis.setTimeout;
  const observedDelays: number[] = [];
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  let calls = 0;
  const originalFetch = globalThis.fetch;

  globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    observedDelays.push(Number(delay));
    return originalSetTimeout(callback, delay === 900 ? 0 : delay, ...args);
  }) as typeof globalThis.setTimeout;
  globalThis.fetch = (async (input) => {
    calls += 1;
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    const schemeCode = new URL(String(input), "http://localhost").searchParams.get("sd_id") ?? "";
    return await new Promise<Response>((resolve) => {
      originalSetTimeout(() => {
        activeRequests -= 1;
        resolve(Response.json({
          meta: { scheme_code: schemeCode },
          data: [{ date: "02-02-2026", nav: 12 }],
        }));
      }, 5);
    });
  }) as typeof globalThis.fetch;

  try {
    const refreshed = await refreshWithDailyHistory(portfolio);
    assert.equal(calls, 5);
    assert.equal(maximumActiveRequests, 4);
    assert.equal(observedDelays.filter((delay) => delay === 900).length, 1);
    assert.deepEqual(refreshed.navHistoryCoverage, { updated: 5, total: 5 });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("daily history honors the numeric Retry-After duration, not only the retry count", async () => {
  const portfolio = liveHistoryPortfolio();
  const originalSetTimeout = globalThis.setTimeout;
  const observedDelays: number[] = [];
  let calls = 0;
  const originalFetch = globalThis.fetch;

  globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    observedDelays.push(Number(delay));
    return originalSetTimeout(callback, delay === 1_250 ? 0 : delay, ...args);
  }) as typeof globalThis.setTimeout;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return new Response("throttled", { status: 429, headers: { "retry-after": "1.25" } });
    }
    return Response.json({
      meta: { scheme_code: "1001" },
      data: [{ date: "02-02-2026", nav: 12 }],
    });
  }) as typeof globalThis.fetch;

  try {
    const refreshed = await refreshWithDailyHistory(portfolio);
    assert.equal(calls, 2);
    assert.equal(observedDelays.filter((delay) => delay === 1_250).length, 1);
    assert.deepEqual(refreshed.navHistoryCoverage, { updated: 1, total: 1 });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("daily history propagates cancellation that occurs while a request is in flight", async () => {
  const portfolio = liveHistoryPortfolio();
  const controller = new AbortController();
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async (_input, init) => {
    calls += 1;
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("request aborted", "AbortError"));
      }, { once: true });
      queueMicrotask(() => controller.abort());
    });
  }) as typeof globalThis.fetch;

  try {
    const refreshed = await refreshWithDailyHistory(portfolio, controller.signal);
    assert.equal(calls, 1);
    assert.equal(refreshed.navHistoryLoading, false);
    assert.match(refreshed.navHistoryError ?? "", /abort/i);
    assert.equal(refreshed.funds, portfolio.funds);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
