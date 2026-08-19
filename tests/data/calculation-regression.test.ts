import assert from "node:assert/strict";
import test from "node:test";

import { demoPortfolio, type FolioHolding, type FundHolding } from "../../app/cas-parser.ts";
import { fillCalendarDays } from "../../app/calendar-series.ts";
import { buildChartScale } from "../../app/chart-scale.ts";
import {
  annualizedReturnAt,
  buildFundStackModel,
  maxStackReconciliationDifference,
  portfolioAbsoluteReturn,
  portfolioAnnualizedReturn,
} from "../../app/fund-stack-service.ts";
import { fundSortValue, sortFunds } from "../../app/fund-sort.ts";
import { buildNavPoints } from "../../app/nav-activity-service.ts";
import {
  addDailyPortfolioPoints,
  buildHoldingTimeline,
  normalizePublishedNav,
} from "../../app/timeline-service.ts";
import { activeFund, transaction } from "./helpers.ts";

test("published NAV normalization is sorted, deduplicated last-write-wins, filtered, and immutable", () => {
  const input = [
    { date: "2026-01-10", nav: 10 },
    { date: "2026-01-02", nav: 9 },
    { date: "2026-01-10", nav: 11 },
    { date: "bad", nav: 99 },
    { date: "2026-01-11", nav: Number.NaN },
    { date: "2026-01-12", nav: -1 },
  ];
  const before = structuredClone(input);

  assert.deepEqual(normalizePublishedNav(input), [
    { date: "2026-01-02", nav: 9 },
    { date: "2026-01-10", nav: 11 },
  ]);
  assert.deepEqual(input, before);
});

test("calendar chart points carry Friday values through the weekend without inventing observations", () => {
  const input = [
    { date: "2026-01-09", invested: 100, value: 110, nav: 11, daily: true, transaction: true, transactionAmount: 100 },
    { date: "2026-01-12", invested: 100, value: 120, nav: 12, daily: true },
  ];
  const before = structuredClone(input);

  const points = fillCalendarDays(input);

  assert.deepEqual(points.map((point) => point.date), [
    "2026-01-09", "2026-01-10", "2026-01-11", "2026-01-12",
  ]);
  for (const point of points.slice(1, 3)) {
    assert.equal(point.value, 110);
    assert.equal(point.invested, 100);
    assert.equal(point.nav, 11);
    assert.equal(point.carried, true);
    assert.equal(point.carriedFrom, "2026-01-09");
    assert.equal(point.daily, undefined);
    assert.equal(point.transaction, undefined);
    assert.equal(point.transactionAmount, undefined);
  }
  assert.deepEqual(points.at(-1), input.at(-1));
  assert.deepEqual(input, before);
});

test("calendar chart points preserve a real missing-date transaction and carry from it afterward", () => {
  const points = fillCalendarDays([
    { date: "2026-01-09", nav: 11, investedAmount: 0, transactionAmount: 0 },
    { date: "2026-01-10", nav: 11.5, investedAmount: 50, transactionAmount: 50, transaction: true },
    { date: "2026-01-12", nav: 12, investedAmount: 0, transactionAmount: 0, daily: true },
  ]);

  assert.equal(points[1].transaction, true);
  assert.equal(points[1].investedAmount, 50);
  assert.deepEqual(points[2], {
    date: "2026-01-11",
    nav: 11.5,
    investedAmount: 0,
    transactionAmount: undefined,
    transaction: undefined,
    daily: undefined,
    exact: undefined,
    live: undefined,
    latest: undefined,
    transactionCount: undefined,
    investmentCount: 0,
    carried: true,
    carriedFrom: "2026-01-10",
  });
});

test("calendar chart filling safely leaves single, invalid, and reverse-dated series sparse", () => {
  assert.deepEqual(fillCalendarDays([{ date: "2026-01-09", value: 1 }]), [
    { date: "2026-01-09", value: 1 },
  ]);
  assert.deepEqual(fillCalendarDays([
    { date: "invalid", value: 1 },
    { date: "2026-01-12", value: 2 },
  ]).map((point) => point.date), ["invalid", "2026-01-12"]);
  assert.deepEqual(fillCalendarDays([
    { date: "2026-01-12", value: 2 },
    { date: "2026-01-09", value: 1 },
  ]).map((point) => point.date), ["2026-01-12", "2026-01-09"]);
});

test("a holding with one endpoint gets a deterministic one-year chart baseline", () => {
  const timeline = buildHoldingTimeline({
    currentValue: 110,
    invested: 100,
    units: 10,
    nav: 11,
    navDate: "2026-02-02",
    transactions: [],
  });

  assert.deepEqual(timeline, [
    { date: "2025-02-02", invested: 0, value: 0 },
    {
      date: "2026-02-02",
      invested: 100,
      value: 110,
      nav: 11,
      exact: true,
      live: undefined,
      transaction: false,
      transactionAmount: undefined,
      transactionCount: undefined,
      daily: false,
    },
  ]);
});

test("same-day transactions are consolidated with their final units and total cash flow", () => {
  const first = transaction("2026-01-02", 100, 10, 10, 10);
  const second = transaction("2026-01-02", 55, 5, 11, 15);
  const timeline = buildHoldingTimeline({
    currentValue: 180,
    invested: 155,
    units: 15,
    nav: 12,
    navDate: "2026-02-02",
    transactions: [first, second],
  });
  const purchase = timeline.find((point) => point.date === "2026-01-02");

  assert.deepEqual(purchase, {
    date: "2026-01-02",
    invested: 155,
    value: 165,
    nav: 11,
    transaction: true,
    transactionAmount: 155,
    transactionCount: 2,
  });
});

test("history is not valued when closing units cannot be reconstructed", () => {
  const purchase = transaction("2026-01-02", 100, 10, 10, 8);
  const timeline = buildHoldingTimeline({
    currentValue: 110,
    invested: 100,
    units: 10,
    nav: 11,
    navDate: "2026-02-02",
    transactions: [purchase],
    navHistory: [{ date: "2026-01-10", nav: 10.5 }],
  });

  assert.equal(timeline.some((point) => point.date === "2026-01-10"), false);
  assert.deepEqual(timeline.map((point) => point.date), ["2026-01-02", "2026-02-02"]);
});

test("portfolio history returns the original timeline by identity if any active units are unreconstructable", () => {
  const fund = activeFund();
  fund.transactions[0].balance = 8;
  fund.folioHoldings[0].transactions[0].balance = 8;
  fund.navHistory = [{ date: "2026-01-10", nav: 10.5 }];
  const base = [{ date: "2026-01-31", invested: 100, value: 110, exact: true }];

  const result = addDailyPortfolioPoints(base, [fund], []);
  assert.equal(result, base);
  assert.deepEqual(result, base);
});

test("portfolio history keeps a date only when every scheme held that day published a NAV", () => {
  const fundA = activeFund({ key: "a", isin: "INF000A00001", units: 10, nav: 11 });
  const fundB = activeFund({
    key: "b", isin: "INF000A00002", units: 20, nav: 6, transactionDate: "2026-01-10",
  });
  fundA.navHistory = [
    { date: "2026-01-10", nav: 10 },
    { date: "2026-01-20", nav: 11 },
  ];
  fundB.navHistory = [{ date: "2026-01-10", nav: 5 }];
  fundA.folioHoldings[0].navHistory = fundA.navHistory;
  fundB.folioHoldings[0].navHistory = fundB.navHistory;
  const base = [{ date: "2026-01-31", invested: 200, value: 230, exact: true }];

  const result = addDailyPortfolioPoints(base, [fundA, fundB], []);
  assert.equal(result.some((point) => point.date === "2026-01-10" && point.daily), true);
  assert.equal(result.some((point) => point.date === "2026-01-20"), false);
});

test("NAV activity combines purchases, redemptions, daily publication, and the latest marker without mutation", () => {
  const transactions = [
    transaction("2026-01-02", 100, 10, 10, 10),
    transaction("2026-01-02", -20, -2, 10, 8),
    transaction("", 99, 1, 99, 9),
    transaction("2026-01-03", 50, 5, 0, 13),
  ];
  const before = structuredClone(transactions);
  const points = buildNavPoints(
    transactions,
    [{ date: "2026-01-02", nav: 10.1 }, { date: "", nav: 99 }, { date: "2026-01-04", nav: -1 }],
    10.5,
    "2026-01-05",
  );

  assert.deepEqual(points, [
    {
      date: "2026-01-02",
      nav: 10.1,
      investedAmount: 100,
      investmentCount: 1,
      transactionAmount: 80,
      transactionCount: 2,
      transaction: true,
      daily: true,
      publishedNav: 10.1,
      transactionNav: 10,
      latest: undefined,
    },
    {
      date: "2026-01-05",
      nav: 10.5,
      investedAmount: 0,
      investmentCount: 0,
      transactionAmount: 0,
      transactionCount: 0,
      transaction: undefined,
      daily: undefined,
      publishedNav: undefined,
      transactionNav: undefined,
      latest: true,
    },
  ]);
  assert.deepEqual(transactions, before);
});

test("absolute and annualized metrics preserve loss, gain, and unavailable semantics", () => {
  const purchase = transaction("2025-01-01", 100, 10, 10, 10);
  const gain = annualizedReturnAt([purchase], "2026-01-01", 110);
  const loss = annualizedReturnAt([purchase], "2026-01-01", 90);

  assert.ok(gain !== null && Math.abs(gain - 10) < 0.0001);
  assert.ok(loss !== null && Math.abs(loss + 10) < 0.0001);
  assert.equal(annualizedReturnAt([purchase], "2024-12-31", 90), null);
  assert.equal(annualizedReturnAt([{ ...purchase, amount: Number.NaN }], "2026-01-01", 110), null);
  assert.equal(portfolioAbsoluteReturn(100, -25), -25);
  assert.equal(portfolioAbsoluteReturn(100, Number.POSITIVE_INFINITY), null);
});

test("portfolio annualized return rejects an active folio whose cash flows are missing", () => {
  const complete = activeFund({ key: "complete" });
  const incomplete = activeFund({ key: "incomplete", isin: "INF000A00002", withTransactions: false });

  assert.equal(portfolioAnnualizedReturn({
    valuationDate: "2026-01-31",
    currentValue: complete.currentValue + incomplete.currentValue,
    timeline: [{ date: "2026-01-02", transactionAmount: 100 }],
    funds: [complete, incomplete],
  }), null);
});

test("chart scale has safe empty and constant-value domains and ignores non-finite observations", () => {
  assert.deepEqual(buildChartScale([], true), {
    min: 0,
    max: 1,
    step: 0.25,
    ticks: [0, 0.25, 0.5, 0.75, 1],
  });
  assert.deepEqual(buildChartScale([
    { value: 100, invested: 100 },
    { value: Number.NaN, invested: Number.POSITIVE_INFINITY },
  ], true), {
    min: 98,
    max: 102,
    step: 1,
    ticks: [98, 99, 100, 101, 102],
  });
});

test("fund sorting is deterministic, keeps unavailable metrics last, and never mutates input", () => {
  const funds = [
    { name: "Zulu", invested: 100, currentValue: 110, annualizedReturn: null },
    { name: "Alpha", invested: 100, currentValue: 110, annualizedReturn: 5 },
    { name: "Beta", invested: 0, currentValue: 20, annualizedReturn: Number.NaN },
  ];
  const before = structuredClone(funds);

  assert.deepEqual(sortFunds(funds, { key: "value", direction: "desc" }).map((fund) => fund.name), ["Alpha", "Zulu", "Beta"]);
  assert.deepEqual(sortFunds(funds, { key: "annualizedReturn", direction: "asc" }).map((fund) => fund.name), ["Alpha", "Beta", "Zulu"]);
  assert.equal(fundSortValue(funds[2], "return"), 0);
  assert.deepEqual(funds, before);
});

test("fund stack empty and demo models preserve exact totals across every baseline point", () => {
  assert.deepEqual(buildFundStackModel({ ...demoPortfolio, funds: [], closedFunds: [] }), {
    funds: [],
    points: [],
  });
  const model = buildFundStackModel(demoPortfolio);
  assert.equal(maxStackReconciliationDifference(model), 0);
  assert.equal(model.points.at(-1)?.latest, true);
  for (const point of model.points) {
    assert.equal(point.totalValue, point.funds.reduce((sum, fund) => sum + fund.value, 0));
    assert.equal(point.totalInvested, point.funds.reduce((sum, fund) => sum + fund.invested, 0));
    assert.ok(Math.abs(point.totalContribution - (point.totalValue - point.totalInvested)) < 0.000001);
  }
});

test("folio-level reconstruction sums independent balances without double-counting fund transactions", () => {
  const first = transaction("2026-01-02", 100, 10, 10, 10, "folio-a");
  const second = transaction("2026-01-10", 50, 5, 10, 5, "folio-b");
  const folios: FolioHolding[] = [
    {
      key: "folio-a", label: "A", currentValue: 120, invested: 100, costBasis: 100,
      units: 10, nav: 12, navDate: "2026-02-02", transactions: [first],
    },
    {
      key: "folio-b", label: "B", currentValue: 60, invested: 50, costBasis: 50,
      units: 5, nav: 12, navDate: "2026-02-02", transactions: [second],
    },
  ];
  const fund: FundHolding = {
    key: "combined", name: "Combined", isin: "INF000A00001", fundHouse: "Test",
    category: "Test", currentValue: 180, invested: 150, costBasis: 150, units: 15,
    nav: 12, navDate: "2026-02-02", folios: 2, transactions: [first, second],
    folioHoldings: folios, navHistory: [{ date: "2026-01-10", nav: 11 }],
  };

  const point = buildHoldingTimeline(fund).find((item) => item.date === "2026-01-10");
  assert.equal(point?.value, 165);
  assert.equal(point?.invested, 150);
  assert.equal(point?.transactionAmount, 50);
  assert.equal(point?.transactionCount, 1);
});
