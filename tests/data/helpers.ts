import type {
  ClosedFund,
  FolioHolding,
  FundHolding,
  FundTransaction,
  Portfolio,
} from "../../app/cas-parser.ts";

export const transaction = (
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

type ActiveFundOptions = {
  key?: string;
  isin?: string;
  schemeCode?: string;
  name?: string;
  units?: number;
  invested?: number;
  nav?: number;
  navDate?: string;
  transactionDate?: string;
  withTransactions?: boolean;
};

export const activeFund = (options: ActiveFundOptions = {}): FundHolding => {
  const key = options.key ?? "fund-a";
  const isin = options.isin ?? "INF000A00001";
  const units = options.units ?? 10;
  const invested = options.invested ?? 100;
  const nav = options.nav ?? 11;
  const navDate = options.navDate ?? "2026-01-31";
  const purchase = transaction(
    options.transactionDate ?? "2026-01-02",
    invested,
    units,
    invested / units,
    units,
    `${key}-folio`,
  );
  const transactions = options.withTransactions === false ? [] : [purchase];
  const folio: FolioHolding = {
    key: `${key}-folio`,
    label: "Folio •••1234",
    currentValue: units * nav,
    invested,
    costBasis: invested,
    units,
    nav,
    navDate,
    transactions,
  };
  return {
    key,
    name: options.name ?? `Test ${key} Direct Growth`,
    isin,
    fundHouse: "Test House",
    category: "Diversified equity",
    currentValue: units * nav,
    invested,
    costBasis: invested,
    units,
    nav,
    navDate,
    schemeCode: options.schemeCode,
    folios: 1,
    transactions,
    folioHoldings: [folio],
  };
};

export const closedFund = (overrides: Partial<ClosedFund> = {}): ClosedFund => ({
  key: "closed-a",
  name: "Test Closed Fund Direct Growth",
  isin: "INF000A00003",
  fundHouse: "Test House",
  category: "Diversified equity",
  realizedGain: 20,
  totalInvested: 50,
  totalProceeds: 70,
  closedDate: "2026-01-20",
  folios: 1,
  transactions: [
    transaction("2026-01-02", 50, 5, 10, 5, "closed-a"),
    transaction("2026-01-20", -70, -5, 14, 0, "closed-a"),
  ],
  ...overrides,
});

export const casPortfolio = (
  funds: FundHolding[] = [activeFund()],
  closedFunds: ClosedFund[] = [],
): Portfolio => {
  const currentValue = funds.reduce((sum, fund) => sum + fund.currentValue, 0);
  const invested = funds.reduce((sum, fund) => sum + fund.invested, 0);
  const transactions = [...funds, ...closedFunds]
    .flatMap((fund) => fund.transactions)
    .sort((left, right) => left.date.localeCompare(right.date));
  const timeline: Portfolio["timeline"] = [];
  const balances = new Map<string, { balance: number; price: number }>();
  let netInvested = 0;
  for (const item of transactions) {
    netInvested += item.amount;
    balances.set(item.holdingKey ?? "holding", { balance: item.balance, price: item.price });
    const estimatedValue = [...balances.values()].reduce(
      (sum, lot) => sum + lot.balance * lot.price,
      0,
    );
    const previous = timeline.at(-1);
    if (previous?.date === item.date) {
      previous.invested = netInvested;
      previous.value = estimatedValue;
      previous.transactionAmount = (previous.transactionAmount ?? 0) + item.amount;
      previous.transactionCount = (previous.transactionCount ?? 0) + 1;
    } else {
      timeline.push({
        date: item.date,
        invested: netInvested,
        value: estimatedValue,
        transaction: true,
        transactionAmount: item.amount,
        transactionCount: 1,
      });
    }
  }
  timeline.push({
    date: "2026-01-31",
    invested,
    value: currentValue,
    exact: true,
    transaction: false,
  });
  return {
    source: "cas",
    statementDate: "2026-01-31",
    valuationDate: "2026-01-31",
    valuationSource: "cas",
    currentValue,
    invested,
    costBasis: invested,
    realizedGain: closedFunds.reduce((sum, fund) => sum + fund.realizedGain, 0),
    funds,
    closedFunds,
    timeline,
    reconciliationDifference: 0,
    navCoverage: { updated: 0, total: funds.length },
  };
};

const escapePdfText = (value: string) => value
  .replace(/\\/g, "\\\\")
  .replace(/\(/g, "\\(")
  .replace(/\)/g, "\\)");

/**
 * Builds a minimal, deterministic one-page PDF. This keeps parser regression
 * fixtures synthetic: tests never need a real investor statement on disk.
 */
export const pdfFile = (name: string, lines: string[], type = "application/pdf") => {
  const text = lines
    .map((line, index) => `${index ? "0 -15 Td " : ""}(${escapePdfText(line)}) Tj`)
    .join("\n");
  const stream = `BT\n/F1 9 Tf\n50 760 Td\n${text}\nET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${new TextEncoder().encode(stream).byteLength} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(new TextEncoder().encode(body).byteLength);
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = new TextEncoder().encode(body).byteLength;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new File([new TextEncoder().encode(body)], name, { type });
};

export const validCasLines = [
  "CAMS KFintech Consolidated Account Statement",
  "PORTFOLIO SUMMARY",
  "Total 350.00 385.00",
  "HDFC Small Cap Fund Direct Growth - ISIN: INF179K01ABC",
  "Folio No: 123456/78",
  "NAV on 31-Jul-2026: INR 11.0000 Market Value on 31-Jul-2026: INR 110.00",
  "Closing Unit Balance: 10.000 Total Cost Value: 100.00",
  "01-Jan-2026 Purchase 100.00 10.000 10.0000 10.000",
  "HDFC Small Cap Fund Direct Growth - ISIN: INF179K01ABC",
  "Folio No: 998877/66",
  "NAV on 31-Jul-2026: INR 11.0000 Market Value on 31-Jul-2026: INR 55.00",
  "Closing Unit Balance: 5.000 Total Cost Value: 50.00",
  "15-Jan-2026 SIP Purchase 50.00 5.000 10.0000 5.000",
  "ICICI Prudential Gold Fund Direct Growth - ISIN: INF109K01XYZ",
  "Folio No: 246810/12",
  "NAV on 31-Jul-2026: INR 22.0000 Market Value on 31-Jul-2026: INR 220.00",
  "Closing Unit Balance: 10.000 Total Cost Value: 200.00",
  "01-Feb-2026 Purchase 200.00 10.000 20.0000 10.000",
  "Harbour Tax Saver Direct Growth - ISIN: INF000A00999",
  "Folio No: 135790/24",
  "02-Jan-2025 Purchase 50.00 5.000 10.0000 5.000",
  "20-Jan-2026 Redemption (65.00) (5.000) 13.0000 0.000",
];
