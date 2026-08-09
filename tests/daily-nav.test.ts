import assert from "node:assert/strict";
import test from "node:test";

import { buildNavPoints } from "../app/nav-activity-service.ts";
import { buildChartScale } from "../app/chart-scale.ts";
import {
  annualizedReturnAt,
  buildSharedFundStackScale,
  buildFundStackModel,
  findStackFundIndex,
  fundValueShare,
  maxStackReconciliationDifference,
  stackBoundsForPoint,
  toggleStackModeSelection,
  type FundStackPoint,
} from "../app/fund-stack-service.ts";
import { formatInr } from "../app/formatters.ts";
import { historyRange, mirrorDateToIso } from "../app/nav-history-utils.ts";
import { shiftRangeWindow } from "../app/range-window.ts";
import {
  addDailyPortfolioPoints,
  buildHoldingTimeline,
  normalizePublishedNav,
} from "../app/timeline-service.ts";
import type { ClosedFund, FolioHolding, FundHolding, FundTransaction, Portfolio } from "../app/cas-parser.ts";

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

test("graph tooltip amounts use Indian digit grouping", () => {
  assert.equal(formatInr(5_000), "₹5,000");
  assert.equal(formatInr(20_223_264), "₹2,02,23,264");
  assert.equal(formatInr(1234.5678, 4), "₹1,234.5678");
});

test("dragging a selected chart window preserves its width and clamps at both ends", () => {
  assert.deepEqual(shiftRangeWindow([20, 39], 10, 100), [30, 49]);
  assert.deepEqual(shiftRangeWindow([20, 39], -50, 100), [0, 19]);
  assert.deepEqual(shiftRangeWindow([20, 39], 100, 100), [80, 99]);
  assert.deepEqual(shiftRangeWindow([0, 99], 20, 100), [0, 99]);

  const shifted = shiftRangeWindow([12, 31], 17, 100);
  assert.equal(shifted[1] - shifted[0], 19);
});

test("stack view selection supports one, two, or three ordered panels", () => {
  assert.deepEqual(toggleStackModeSelection(["value"], "invested"), ["value", "invested"]);
  assert.deepEqual(toggleStackModeSelection(["value", "invested"], "contribution"), ["value", "invested", "contribution"]);
  assert.deepEqual(toggleStackModeSelection(["value", "invested", "contribution"], "value"), ["invested", "contribution"]);
  assert.deepEqual(toggleStackModeSelection(["invested"], "invested"), ["invested"]);
});

test("annualised fund return uses dated investor cash flows and terminal value", () => {
  const purchase = transaction("2025-01-01", 100, 10, 10, 10);
  const oneYear = annualizedReturnAt([purchase], "2026-01-01", 110);
  assert.ok(oneYear !== null && Math.abs(oneYear - 10) < 0.0001);

  const partialRedemption = transaction("2025-07-01", -30, -2.5, 12, 7.5);
  const withRedemption = annualizedReturnAt([purchase, partialRedemption], "2026-01-01", 90);
  assert.ok(withRedemption !== null && withRedemption > 20);
  assert.equal(annualizedReturnAt([purchase], "2025-01-01", 100), null);
  assert.equal(annualizedReturnAt([], "2026-01-01", 100), null);
});

test("hiding net invested tightens the Y-axis around visible portfolio values", () => {
  const visible = [
    { value: 28_000_000, invested: 20_000_000 },
    { value: 28_120_000, invested: 20_000_000 },
    { value: 28_060_000, invested: 20_000_000 },
  ];
  const combined = buildChartScale(visible, true);
  const valueOnly = buildChartScale(visible, false);

  assert.ok(valueOnly.max - valueOnly.min < combined.max - combined.min);
  assert.ok(valueOnly.min < 28_000_000);
  assert.ok(valueOnly.max > 28_120_000);
  assert.ok(valueOnly.step < 1_000_000);
  assert.ok(valueOnly.ticks.every((tick, index) => index === 0 || tick > valueOnly.ticks[index - 1]));
});

test("fund stacks include every active fund and reconcile value, invested, and contribution", () => {
  const firstTransaction = transaction("2026-01-02", 100, 10, 10, 10, "first");
  const secondTransaction = transaction("2026-01-09", 100, 20, 5, 20, "second");
  const makeFund = (
    key: string,
    purchase: FundTransaction,
    units: number,
    invested: number,
    currentValue: number,
    history: Array<{ date: string; nav: number }>,
  ): FundHolding => ({
    key, name: key, isin: `INF${key.padEnd(9, "0")}`, fundHouse: key, category: "Test",
    currentValue, invested, costBasis: invested, units, nav: currentValue / units,
    navDate: "2026-01-16", folios: 1, transactions: [purchase], folioHoldings: [],
    navHistory: history,
  });
  const first = makeFund("First", firstTransaction, 10, 100, 120, [
    { date: "2026-01-09", nav: 11 },
    { date: "2026-01-12", nav: 11.5 },
  ]);
  const second = makeFund("Second", secondTransaction, 20, 100, 120, [
    { date: "2026-01-09", nav: 5 },
    { date: "2026-01-12", nav: 5.5 },
  ]);
  const portfolio: Portfolio = {
    source: "cas", statementDate: "2026-01-16", valuationDate: "2026-01-16",
    valuationSource: "amfi", currentValue: 240, invested: 200, costBasis: 200,
    realizedGain: 0, funds: [first, second], closedFunds: [], timeline: [],
    reconciliationDifference: 0, navCoverage: { updated: 2, total: 2 },
  };
  const model = buildFundStackModel(portfolio);

  assert.deepEqual(model.funds.map((fund) => fund.key), ["First", "Second"]);
  assert.deepEqual(model.points.map((point) => point.date), ["2026-01-02", "2026-01-09", "2026-01-12", "2026-01-16"]);
  assert.deepEqual(
    model.points.map((point) => [point.totalValue, point.totalInvested, point.totalContribution]),
    [[100, 100, 0], [210, 200, 10], [225, 200, 25], [240, 200, 40]],
  );
  assert.equal(maxStackReconciliationDifference(model), 0);
});

test("fund stack dates are omitted instead of estimating a missing held-fund NAV", () => {
  const firstTransaction = transaction("2026-01-02", 100, 10, 10, 10, "first");
  const secondTransaction = transaction("2026-01-02", 100, 10, 10, 10, "second");
  const makeFund = (key: string, purchase: FundTransaction, history: Array<{ date: string; nav: number }>): FundHolding => ({
    key, name: key, isin: `INF${key.padEnd(9, "0")}`, fundHouse: key, category: "Test",
    currentValue: 110, invested: 100, costBasis: 100, units: 10, nav: 11,
    navDate: "2026-01-16", folios: 1, transactions: [purchase], folioHoldings: [], navHistory: history,
  });
  const portfolio: Portfolio = {
    source: "cas", statementDate: "2026-01-16", valuationDate: "2026-01-16",
    valuationSource: "amfi", currentValue: 220, invested: 200, costBasis: 200,
    realizedGain: 0,
    funds: [
      makeFund("First", firstTransaction, [{ date: "2026-01-09", nav: 10.5 }]),
      makeFund("Second", secondTransaction, [{ date: "2026-01-12", nav: 10.7 }]),
    ],
    closedFunds: [], timeline: [], reconciliationDifference: 0,
    navCoverage: { updated: 2, total: 2 },
  };

  assert.deepEqual(buildFundStackModel(portfolio).points.map((point) => point.date), ["2026-01-02", "2026-01-16"]);
});

test("closed funds remain in the stack and carry realised gain into contribution", () => {
  const activePurchase = transaction("2026-01-02", 100, 10, 10, 10, "active");
  const active: FundHolding = {
    key: "active", name: "Active", isin: "INFACTIVE000", fundHouse: "A", category: "Test",
    currentValue: 120, invested: 100, costBasis: 100, units: 10, nav: 12,
    navDate: "2026-01-16", folios: 1, transactions: [activePurchase], folioHoldings: [],
    navHistory: [{ date: "2026-01-09", nav: 11 }],
  };
  const closedTransactions = [
    transaction("2026-01-02", 50, 5, 10, 5, "closed"),
    transaction("2026-01-09", -70, -5, 14, 0, "closed"),
  ];
  const closed: ClosedFund = {
    key: "closed", name: "Closed", isin: "INFCLOSED000", fundHouse: "C", category: "Test",
    realizedGain: 20, totalInvested: 50, totalProceeds: 70, closedDate: "2026-01-09",
    folios: 1, transactions: closedTransactions,
    navHistory: [{ date: "2026-01-09", nav: 14 }],
  };
  const portfolio: Portfolio = {
    source: "cas", statementDate: "2026-01-16", valuationDate: "2026-01-16",
    valuationSource: "amfi", currentValue: 120, invested: 100, costBasis: 100,
    realizedGain: 20, funds: [active], closedFunds: [closed], timeline: [],
    reconciliationDifference: 0, navCoverage: { updated: 1, total: 1 },
  };
  const model = buildFundStackModel(portfolio);
  const latest = model.points.at(-1);

  assert.deepEqual(model.funds.map((fund) => [fund.key, fund.closed]), [["active", false], ["closed", true]]);
  assert.deepEqual(
    [latest?.totalValue, latest?.totalInvested, latest?.totalContribution],
    [120, 80, 40],
  );
  assert.deepEqual(latest?.funds[1], {
    fundKey: "closed", value: 0, invested: -20, contribution: 20,
  });
});

test("stack hover hit-testing identifies positive and negative fund layers exactly", () => {
  const point: FundStackPoint = {
    date: "2026-01-16",
    funds: [
      { fundKey: "first", value: 120, invested: 80, contribution: 40 },
      { fundKey: "second", value: 70, invested: 90, contribution: -20 },
      { fundKey: "third", value: 40, invested: 30, contribution: 10 },
    ],
    totalValue: 230,
    totalInvested: 200,
    totalContribution: 30,
  };

  assert.deepEqual(stackBoundsForPoint(point, "value"), [
    { lower: 0, upper: 120 },
    { lower: 120, upper: 190 },
    { lower: 190, upper: 230 },
  ]);
  assert.deepEqual(stackBoundsForPoint(point, "contribution"), [
    { lower: 0, upper: 40 },
    { lower: -20, upper: 0 },
    { lower: 40, upper: 50 },
  ]);
  assert.equal(findStackFundIndex(point, "contribution", 20), 0);
  assert.equal(findStackFundIndex(point, "contribution", -10), 1);
  assert.equal(findStackFundIndex(point, "contribution", 45), 2);
  assert.equal(findStackFundIndex(point, "contribution", 60), -1);
  assert.equal(fundValueShare(point, 0), 120 / 230 * 100);
  assert.deepEqual(buildSharedFundStackScale([point], ["value", "invested"]), {
    min: 0,
    max: 250,
    step: 50,
    ticks: [0, 50, 100, 150, 200, 250],
  });
  assert.deepEqual(buildSharedFundStackScale([point], ["value", "invested", "contribution"]), {
    min: -50,
    max: 250,
    step: 50,
    ticks: [-50, 0, 50, 100, 150, 200, 250],
  });
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
