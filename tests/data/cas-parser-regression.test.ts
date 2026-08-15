import assert from "node:assert/strict";
import test from "node:test";

import { demoPortfolio, parseCasFile } from "../../app/cas-parser.ts";
import { buildFundStackModel, maxStackReconciliationDifference } from "../../app/fund-stack-service.ts";
import { pdfFile, validCasLines } from "./helpers.ts";

test("the demo baseline is internally reconciled and stable", () => {
  const fundValue = demoPortfolio.funds.reduce((sum, fund) => sum + fund.currentValue, 0);
  const fundInvested = demoPortfolio.funds.reduce((sum, fund) => sum + fund.invested, 0);
  const fundCost = demoPortfolio.funds.reduce((sum, fund) => sum + fund.costBasis, 0);
  const closedGain = demoPortfolio.closedFunds.reduce((sum, fund) => sum + fund.realizedGain, 0);
  const endpoint = demoPortfolio.timeline.at(-1);

  assert.equal(demoPortfolio.source, "demo");
  assert.equal(demoPortfolio.currentValue, fundValue);
  assert.equal(demoPortfolio.invested, fundInvested);
  assert.equal(demoPortfolio.costBasis, fundCost);
  assert.equal(demoPortfolio.realizedGain, closedGain);
  assert.deepEqual(endpoint, {
    date: demoPortfolio.valuationDate,
    invested: demoPortfolio.invested,
    value: demoPortfolio.currentValue,
    exact: true,
  });
  assert.deepEqual(demoPortfolio.navCoverage, {
    updated: demoPortfolio.funds.length,
    total: demoPortfolio.funds.length,
  });
  assert.ok(demoPortfolio.timeline.every((point, index, points) =>
    index === 0 || point.date > points[index - 1].date));
  assert.ok(demoPortfolio.funds.every((fund) =>
    Math.abs(fund.currentValue - fund.units * fund.nav) < 0.001));
  assert.ok(demoPortfolio.funds.every((fund) =>
    Math.abs(fund.currentValue - fund.folioHoldings.reduce((sum, folio) => sum + folio.currentValue, 0)) < 0.001));

  const model = buildFundStackModel(demoPortfolio);
  assert.equal(model.points.length, demoPortfolio.timeline.length);
  assert.equal(maxStackReconciliationDifference(model), 0);
});

test("CAS ingestion rejects non-PDF input before attempting to parse it", async () => {
  await assert.rejects(
    parseCasFile(new File(["not a statement"], "statement.csv", { type: "text/csv" })),
    /Please choose a PDF Consolidated Account Statement/,
  );
});

test("CAS ingestion enforces the 30 MB local safety limit", async () => {
  const tooLarge = new File(
    [new Uint8Array(30 * 1024 * 1024 + 1)],
    "oversized.pdf",
    { type: "application/pdf" },
  );
  await assert.rejects(parseCasFile(tooLarge), /larger than 30 MB/);
});

test("CAS ingestion rejects a valid PDF that is not a consolidated statement", async () => {
  const file = pdfFile("other.pdf", ["A valid PDF", "but not a mutual fund statement"]);
  await assert.rejects(parseCasFile(file), /does not look like a CAMS\/KFintech/);
});

test("CAS ingestion requires a portfolio summary", async () => {
  const file = pdfFile("missing-summary.pdf", [
    "CAMS KFintech Consolidated Account Statement",
    "PORTFOLIO SUMMARY",
    "There is no total row here",
  ]);
  await assert.rejects(parseCasFile(file), /portfolio summary total could not be read/);
});

test("CAS ingestion requires at least one valuation row", async () => {
  const file = pdfFile("missing-holdings.pdf", [
    "CAMS KFintech Consolidated Account Statement",
    "PORTFOLIO SUMMARY",
    "Total 0.00 0.00",
    "There are no holdings here",
  ]);
  await assert.rejects(parseCasFile(file), /No mutual fund valuation rows could be read/);
});

test("CAS ingestion fails closed when holdings do not reconcile to the statement", async () => {
  const lines = validCasLines.map((line) => line === "Total 350.00 385.00" ? "Total 350.00 999.00" : line);
  await assert.rejects(
    parseCasFile(pdfFile("unreconciled.pdf", lines)),
    /statement did not reconcile \(value differs by ₹614\.00\)/,
  );
});

test("CAS ingestion also fails closed on a cost-only reconciliation difference", async () => {
  const lines = validCasLines.map((line) => line === "Total 350.00 385.00" ? "Total 352.00 385.00" : line);
  await assert.rejects(
    parseCasFile(pdfFile("cost-unreconciled.pdf", lines)),
    /statement did not reconcile/,
  );
});

test("CAS ingestion normalizes active folios, transactions, closed funds, and the exact endpoint", async () => {
  const progress: number[] = [];
  const portfolio = await parseCasFile(
    pdfFile("synthetic-cas.pdf", validCasLines),
    "",
    (value) => progress.push(value),
  );

  assert.equal(portfolio.source, "cas");
  assert.equal(portfolio.statementDate, "2026-07-31");
  assert.equal(portfolio.valuationDate, "2026-07-31");
  assert.equal(portfolio.valuationSource, "cas");
  assert.equal(portfolio.currentValue, 385);
  assert.equal(portfolio.costBasis, 350);
  assert.equal(portfolio.invested, 350);
  assert.equal(portfolio.realizedGain, 15);
  assert.equal(portfolio.reconciliationDifference, 0);
  assert.deepEqual(portfolio.navCoverage, { updated: 0, total: 2 });
  assert.deepEqual(progress, [88, 100]);

  assert.deepEqual(
    portfolio.funds.map((fund) => ({
      name: fund.name,
      isin: fund.isin,
      category: fund.category,
      value: fund.currentValue,
      invested: fund.invested,
      costBasis: fund.costBasis,
      units: fund.units,
      nav: fund.nav,
      navDate: fund.navDate,
      folios: fund.folios,
      transactionCount: fund.transactions.length,
    })),
    [
      {
        name: "ICICI Prudential Gold Fund Direct Growth",
        isin: "INF109K01XYZ",
        category: "Gold",
        value: 220,
        invested: 200,
        costBasis: 200,
        units: 10,
        nav: 22,
        navDate: "2026-07-31",
        folios: 1,
        transactionCount: 1,
      },
      {
        name: "HDFC Small Cap Fund Direct Growth",
        isin: "INF179K01ABC",
        category: "Small cap",
        value: 165,
        invested: 150,
        costBasis: 150,
        units: 15,
        nav: 11,
        navDate: "2026-07-31",
        folios: 2,
        transactionCount: 2,
      },
    ],
  );

  const hdfc = portfolio.funds[1];
  assert.deepEqual(hdfc.folioHoldings.map((folio) => ({
    label: folio.label,
    value: folio.currentValue,
    invested: folio.invested,
    units: folio.units,
    transactions: folio.transactions.length,
  })), [
    { label: "Folio ••••6/78", value: 110, invested: 100, units: 10, transactions: 1 },
    { label: "Folio ••••7/66", value: 55, invested: 50, units: 5, transactions: 1 },
  ]);
  assert.deepEqual(hdfc.transactions.map(({ date, amount, units, price, balance, label, holdingKey }) => ({
    date, amount, units, price, balance, label, holdingKey,
  })), [
    { date: "2026-01-01", amount: 100, units: 10, price: 10, balance: 10, label: "Purchase", holdingKey: "1" },
    { date: "2026-01-15", amount: 50, units: 5, price: 10, balance: 5, label: "SIP purchase", holdingKey: "2" },
  ]);
  assert.deepEqual(portfolio.closedFunds.map((fund) => ({
    name: fund.name,
    realizedGain: fund.realizedGain,
    totalInvested: fund.totalInvested,
    totalProceeds: fund.totalProceeds,
    closedDate: fund.closedDate,
    folios: fund.folios,
  })), [{
    name: "Harbour Tax Saver Direct Growth",
    realizedGain: 15,
    totalInvested: 50,
    totalProceeds: 65,
    closedDate: "2026-01-20",
    folios: 1,
  }]);

  assert.deepEqual(portfolio.timeline, [
    {
      date: "2025-01-02",
      invested: 50,
      value: 50,
      transaction: true,
      transactionAmount: 50,
      transactionCount: 1,
    },
    {
      date: "2026-01-01",
      invested: 150,
      value: 150,
      transaction: true,
      transactionAmount: 100,
      transactionCount: 1,
    },
    {
      date: "2026-01-15",
      invested: 200,
      value: 200,
      transaction: true,
      transactionAmount: 50,
      transactionCount: 1,
    },
    {
      date: "2026-01-20",
      invested: 135,
      value: 150,
      transaction: true,
      transactionAmount: -65,
      transactionCount: 1,
    },
    {
      date: "2026-02-01",
      invested: 335,
      value: 350,
      transaction: true,
      transactionAmount: 200,
      transactionCount: 1,
    },
    {
      date: "2026-07-31",
      invested: 350,
      value: 385,
      exact: true,
      transaction: false,
      transactionAmount: undefined,
      transactionCount: undefined,
    },
  ]);
  assert.equal(maxStackReconciliationDifference(buildFundStackModel(portfolio)), 0);
});

test("parsing the same CAS twice is deterministic and does not retain parser state", async () => {
  const first = await parseCasFile(pdfFile("first.pdf", validCasLines));
  const second = await parseCasFile(pdfFile("second.pdf", validCasLines));

  assert.deepEqual(second, first);
  assert.notEqual(second, first);
  assert.notEqual(second.funds, first.funds);
});
