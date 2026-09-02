import assert from "node:assert/strict";
import test from "node:test";

import { demoPortfolio } from "../../app/cas-parser";
import { readStoredPortfolio } from "../../app/portfolio-storage";

test("stored portfolio validation accepts a versioned reconciled CAS", () => {
  const portfolio = { ...demoPortfolio, source: "cas" as const, valuationSource: "cas" as const };
  assert.equal(readStoredPortfolio({ version: 1, savedAt: "2026-09-01T00:00:00.000Z", portfolio }), portfolio);
});

test("stored portfolio validation rejects demo, malformed, and incompatible records", () => {
  assert.equal(readStoredPortfolio(null), null);
  assert.equal(readStoredPortfolio({ version: 2, portfolio: demoPortfolio }), null);
  assert.equal(readStoredPortfolio({ version: 1, portfolio: demoPortfolio }), null);
  assert.equal(readStoredPortfolio({
    version: 1,
    portfolio: { ...demoPortfolio, source: "cas", currentValue: Number.NaN },
  }), null);
});
