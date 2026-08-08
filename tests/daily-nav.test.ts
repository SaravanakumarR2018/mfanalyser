import assert from "node:assert/strict";
import test from "node:test";

import { buildNavPoints } from "../app/nav-activity-service.ts";
import { historyRange, mirrorDateToIso } from "../app/nav-history-utils.ts";
import {
  addDailyPortfolioPoints,
  buildHoldingTimeline,
  normalizePublishedNav,
} from "../app/timeline-service.ts";
import type { ClosedFund, FolioHolding, FundHolding, FundTransaction } from "../app/cas-parser.ts";

const transaction = (
  date: string,
  amount: number,
  units: number,
  price: number,
  balance: number,
  holdingKey = "folio-1",
): FundTransaction => ({
  date,
  amount,
  units,
  price,
  balance,
  holdingKey,
  label: amount < 0 ? "Redemption" : "Purchase",
});

test("daily normalization retains every real published NAV date", () => {
  const sampled = normalizePublishedNav([
    { date: "2026-01-05", nav: 10 },
    { date: "2026-01-07", nav: 10.4 },
    { date: "2026-01-09", nav: 10.8 },
    { date: "2026-01-12", nav: 11 },
    { date: "bad-date", nav: 99 },
    { date: "2026-01-13", nav: 0 },
  ]);

  assert.deepEqual(sampled, [
    { date: "2026-01-05", nav: 10 },
    { date: "2026-01-07", nav: 10.4 },
    { date: "2026-01-09", nav: 10.8 },
    { date: "2026-01-12", nav: 11 },
  ]);
});

test("holding values use the exact units held at each daily NAV and retain transactions", () => {
  const transactions = [
    transaction("2026-01-02", 100, 10, 10, 10),
    transaction("2026-01-20", 55, 5, 11, 15),
  ];
  const timeline = buildHoldingTimeline({
    currentValue: 180,
    invested: 155,
    units: 15,
    nav: 12,
    navDate: "2026-02-02",
    liveNav: true,
    transactions,
    navHistory: [
      { date: "2026-01-05", nav: 10.5 },
      { date: "2026-01-12", nav: 9 },
      { date: "2026-01-19", nav: 12 },
      { date: "2026-01-26", nav: 11.5 },
    ],
  });

  const byDate = new Map(timeline.map((point) => [point.date, point]));
  assert.equal(byDate.get("2026-01-05")?.value, 105);
  assert.equal(byDate.get("2026-01-12")?.value, 90);
  assert.equal(byDate.get("2026-01-19")?.value, 120);
  assert.equal(byDate.get("2026-01-26")?.value, 172.5);
  assert.deepEqual(
    {
      value: byDate.get("2026-01-20")?.value,
      invested: byDate.get("2026-01-20")?.invested,
      transaction: byDate.get("2026-01-20")?.transaction,
      amount: byDate.get("2026-01-20")?.transactionAmount,
    },
    { value: 165, invested: 155, transaction: true, amount: 55 },
  );
  assert.equal(byDate.get("2026-02-02")?.value, 180);
  assert.equal(byDate.get("2026-02-02")?.live, true);
});

test("fund daily values aggregate the balances of every folio on that date", () => {
  const first = transaction("2026-01-02", 100, 10, 10, 10, "folio-a");
  const second = transaction("2026-01-10", 200, 20, 10, 20, "folio-b");
  const folios: FolioHolding[] = [
    {
      key: "folio-a",
      label: "A",
      currentValue: 120,
      invested: 100,
      costBasis: 100,
      units: 10,
      nav: 12,
      navDate: "2026-02-02",
      transactions: [first],
    },
    {
      key: "folio-b",
      label: "B",
      currentValue: 240,
      invested: 200,
      costBasis: 200,
      units: 20,
      nav: 12,
      navDate: "2026-02-02",
      transactions: [second],
    },
  ];
  const timeline = buildHoldingTimeline({
    currentValue: 360,
    invested: 300,
    units: 30,
    nav: 12,
    navDate: "2026-02-02",
    transactions: [first, second],
    folioHoldings: folios,
    navHistory: [
      { date: "2026-01-05", nav: 10.5 },
      { date: "2026-01-12", nav: 9 },
    ],
  });

  const byDate = new Map(timeline.map((point) => [point.date, point]));
  assert.equal(byDate.get("2026-01-05")?.value, 105);
  assert.equal(byDate.get("2026-01-12")?.value, 270);
});

test("portfolio daily totals require an actual same-day NAV for every held scheme", () => {
  const makeFund = (
    key: string,
    units: number,
    amount: number,
    navs: Array<{ date: string; nav: number }>,
  ): FundHolding => {
    const purchase = transaction("2026-01-02", amount, units, amount / units, units, key);
    const folio: FolioHolding = {
      key: `${key}-folio`, label: key, currentValue: amount, invested: amount, costBasis: amount,
      units, nav: amount / units, navDate: "2026-01-20", transactions: [purchase], navHistory: navs,
    };
    return {
      key, name: key, isin: `INF${key.padEnd(9, "0")}`, fundHouse: key, category: "Test",
      currentValue: amount, invested: amount, costBasis: amount, units, nav: amount / units,
      navDate: "2026-01-20", folios: 1, transactions: [purchase], folioHoldings: [folio], navHistory: navs,
    };
  };

  const first = makeFund("A", 10, 100, [
    { date: "2026-01-09", nav: 10 },
    { date: "2026-01-16", nav: 11 },
  ]);
  const second = makeFund("B", 20, 100, [{ date: "2026-01-09", nav: 5 }]);
  const result = addDailyPortfolioPoints(
    [{ date: "2026-01-02", invested: 200, value: 200, transaction: true }],
    [first, second],
    [],
  );

  const daily = result.filter((point) => point.daily);
  assert.equal(daily.length, 1);
  assert.equal(daily[0].date, "2026-01-09");
  assert.equal(daily[0].value, 200);
  assert.equal(result.some((point) => point.date === "2026-01-16" && point.daily), false);
});

test("daily enrichment never overwrites an exact endpoint's active invested amount", () => {
  const activePurchase = transaction("2026-01-02", 100, 10, 10, 10, "active");
  const activeFolio: FolioHolding = {
    key: "active-folio", label: "Active", currentValue: 110, invested: 100, costBasis: 100,
    units: 10, nav: 11, navDate: "2026-01-16", liveNav: true,
    transactions: [activePurchase], navHistory: [{ date: "2026-01-16", nav: 11 }],
  };
  const active: FundHolding = {
    key: "active", name: "Active", isin: "INFACTIVE000", fundHouse: "A", category: "Test",
    currentValue: 110, invested: 100, costBasis: 100, units: 10, nav: 11,
    navDate: "2026-01-16", liveNav: true, folios: 1, transactions: [activePurchase],
    folioHoldings: [activeFolio], navHistory: [{ date: "2026-01-16", nav: 11 }],
  };
  const closedTransactions = [
    transaction("2026-01-02", 100, 10, 10, 10, "closed"),
    transaction("2026-01-10", -120, -10, 12, 0, "closed"),
  ];
  const closed: ClosedFund = {
    key: "closed", name: "Closed", isin: "INFCLOSED000", fundHouse: "C", category: "Test",
    realizedGain: 20, totalInvested: 100, totalProceeds: 120, closedDate: "2026-01-10",
    folios: 1, transactions: closedTransactions, navHistory: [{ date: "2026-01-16", nav: 12 }],
  };

  const result = addDailyPortfolioPoints(
    [{ date: "2026-01-16", invested: 100, value: 110, live: true }],
    [active],
    [closed],
  );
  assert.deepEqual(
    { invested: result[0].invested, value: result[0].value, live: result[0].live, daily: result[0].daily },
    { invested: 100, value: 110, live: true, daily: true },
  );
});

test("a mixed publication date cannot replace a transaction point with a partial value", () => {
  const makeFund = (
    key: string,
    purchaseDate: string,
    publicationDate: string,
    units: number,
    nav: number,
  ): FundHolding => {
    const purchase = transaction(purchaseDate, units * nav, units, nav, units, key);
    const folio: FolioHolding = {
      key: `${key}-folio`, label: key, currentValue: units * nav, invested: units * nav,
      costBasis: units * nav, units, nav, navDate: "2026-01-09", transactions: [purchase],
    };
    return {
      key, name: key, isin: `INF${key.padEnd(9, "0")}`, fundHouse: key, category: "Test",
      currentValue: units * nav, invested: units * nav, costBasis: units * nav, units, nav,
      navDate: "2026-01-09", folios: 1, transactions: [purchase], folioHoldings: [folio],
      navHistory: [{ date: publicationDate, nav }],
    };
  };
  const first = makeFund("A", "2026-01-02", "2026-01-09", 10, 10);
  const second = makeFund("B", "2026-01-09", "2026-01-08", 20, 5);
  const result = addDailyPortfolioPoints(
    [{ date: "2026-01-09", invested: 200, value: 200, transaction: true, transactionAmount: 100 }],
    [first, second],
    [],
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].value, 200);
  assert.equal(result[0].daily, undefined);
  assert.equal(result[0].transaction, true);
});

test("NAV chart differentiates daily, transaction, and combined points", () => {
  const points = buildNavPoints(
    [transaction("2026-01-09", 108, 10, 10.8, 10)],
    [
      { date: "2026-01-09", nav: 10.8 },
      { date: "2026-01-16", nav: 11.2 },
    ],
    11.5,
    "2026-01-20",
  );
  const byDate = new Map(points.map((point) => [point.date, point]));
  assert.equal(byDate.get("2026-01-09")?.daily, true);
  assert.equal(byDate.get("2026-01-09")?.transaction, true);
  assert.equal(byDate.get("2026-01-09")?.investedAmount, 108);
  assert.equal(byDate.get("2026-01-16")?.daily, true);
  assert.equal(byDate.get("2026-01-16")?.transaction, undefined);
  assert.equal(byDate.get("2026-01-20")?.latest, true);
});

test("a combined point preserves official daily NAV provenance separately from CAS NAV", () => {
  const points = buildNavPoints(
    [transaction("2026-01-09", 107, 10, 10.7, 10)],
    [{ date: "2026-01-09", nav: 10.8 }],
    10.8,
    "2026-01-09",
  );
  assert.equal(points[0].nav, 10.8);
  assert.equal(points[0].publishedNav, 10.8);
  assert.equal(points[0].transactionNav, 10.7);
  assert.equal(points[0].daily, true);
  assert.equal(points[0].transaction, true);
});

test("history uses one full-range request and never precedes published availability", () => {
  assert.deepEqual(historyRange("2008-04-01", "2026-08-07"), ["2010-01-01", "2026-08-07"]);
  assert.deepEqual(historyRange("2022-04-01", "2026-08-07"), ["2022-04-01", "2026-08-07"]);
  assert.equal(mirrorDateToIso("07-08-2026"), "2026-08-07");
  assert.equal(mirrorDateToIso("2026-08-07"), "");
});
