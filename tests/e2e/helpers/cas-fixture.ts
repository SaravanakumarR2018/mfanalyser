import type { Page } from "@playwright/test";

export const TEST_ISIN = "INF000A00123";
export const TEST_SCHEME_CODE = "100001";

type CasPdfOptions = {
  statementValue?: number;
  statementCost?: number;
  pages?: number;
  transactionCount?: number;
};

const pdfNumber = (value: number) => value.toLocaleString("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const escapePdfText = (value: string) => value
  .replaceAll("\\", "\\\\")
  .replaceAll("(", "\\(")
  .replaceAll(")", "\\)");

/**
 * Build a small, standards-compliant PDF whose text is deliberately shaped like
 * a detailed CAMS/KFintech CAS. The application still loads pdf.js, extracts the
 * PDF text, parses transactions, reconciles totals, and constructs its timeline.
 */
export function makeCasPdf({
  statementValue = 12_000,
  statementCost = 10_000,
  pages = 1,
  transactionCount = 3,
}: CasPdfOptions = {}) {
  const compactTransactions = [
    "01-Jan-2025 Purchase 4,000.00 400.000 10.0000 400.000",
    "01-Jul-2025 SIP Purchase 3,000.00 272.727 11.0000 672.727",
    "01-Jan-2026 Purchase 3,000.00 327.273 9.1667 1,000.000",
  ];
  const generatedTransactions = Array.from({ length: transactionCount }, (_, index) => {
    const date = new Date(Date.UTC(2024, index, 1));
    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    const year = date.getUTCFullYear();
    const amount = 10_000 / transactionCount;
    const units = 1_000 / transactionCount;
    const balance = units * (index + 1);
    return `${day}-${month}-${year} SIP Purchase ${amount.toFixed(2)} ${units.toFixed(3)} 10.0000 ${balance.toFixed(3)}`;
  });
  const transactions = transactionCount === 3 ? compactTransactions : generatedTransactions;
  const holdingLines = [
    "Consolidated Account Statement",
    "PORTFOLIO SUMMARY",
    `Total ${pdfNumber(statementCost)} ${pdfNumber(statementValue)}`,
    `Testhouse Flexi Cap Direct Growth - ISIN : ${TEST_ISIN} Registrar : CAMS`,
    "Folio No : 12345678/90",
    `NAV on 31-Jul-2026: INR 12.0000 Market Value on 31-Jul-2026: INR ${pdfNumber(12_000)}`,
    `Closing Unit Balance: 1,000.000 Total Cost Value: ${pdfNumber(10_000)}`,
  ];
  const continuation = [
    "Consolidated Account Statement",
    "Transaction details continued",
    "This page exists to exercise multi-page PDF progress reporting.",
  ];
  const transactionPages = Array.from(
    { length: Math.max(1, Math.ceil(transactions.length / 10)) },
    (_, index) => transactions.slice(index * 10, (index + 1) * 10),
  );
  const pageLines = Array.from({ length: Math.max(pages, transactionPages.length) }, (_, index) => [
    ...(index === 0 ? holdingLines : continuation),
    ...(transactionPages[index] ?? []),
  ]);

  const objects: string[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = addObject("");
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];

  for (const lines of pageLines) {
    const commands = [
      "BT",
      "/F1 11 Tf",
      "14 TL",
      "54 760 Td",
      ...lines.flatMap((line, index) => [
        `(${escapePdfText(line)}) Tj`,
        ...(index === lines.length - 1 ? [] : ["T*"]),
      ]),
      "ET",
    ].join("\n");
    const contentId = addObject(`<< /Length ${Buffer.byteLength(commands, "latin1")} >>\nstream\n${commands}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

export const latestNavText = ({
  nav = 15,
  date = "14-Aug-2026",
}: { nav?: number; date?: string } = {}) =>
  `${TEST_SCHEME_CODE};${TEST_ISIN};;Testhouse Flexi Cap Direct Growth;Direct Plan;Growth;${nav.toFixed(4)};${date}\n`;

export const dailyHistoryPayload = ({
  finalNav = 15,
}: { finalNav?: number } = {}) => ({
  status: "SUCCESS",
  meta: { scheme_code: TEST_SCHEME_CODE },
  data: [
    { date: "01-01-2025", nav: "10.0000" },
    { date: "01-07-2025", nav: "11.0000" },
    { date: "01-01-2026", nav: "12.0000" },
    { date: "01-04-2026", nav: "13.0000" },
    { date: "01-07-2026", nav: "14.0000" },
    { date: "14-08-2026", nav: finalNav.toFixed(4) },
  ],
});

export const fullDailyHistoryPayload = ({
  finalNav = 15,
}: { finalNav?: number } = {}) => ({
  status: "SUCCESS",
  meta: { scheme_code: TEST_SCHEME_CODE },
  data: [
    { date: "15-05-2004", nav: "6.4000" },
    { date: "02-06-2008", nav: "7.1500" },
    { date: "03-09-2012", nav: "8.0500" },
    { date: "04-01-2016", nav: "8.8000" },
    { date: "06-04-2020", nav: "7.9000" },
    { date: "01-07-2024", nav: "9.5000" },
    ...dailyHistoryPayload({ finalNav }).data,
  ],
});

export async function mockLatestNav(page: Page, options: {
  status?: number;
  body?: string;
  delayMs?: number;
} = {}) {
  await page.route("**/api/nav", async (route) => {
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    await route.fulfill({
      status: options.status ?? 200,
      contentType: "text/plain; charset=utf-8",
      body: options.body ?? latestNavText(),
    });
  });
}

export async function mockDailyHistory(page: Page, options: {
  status?: number;
  body?: unknown;
  delayMs?: number;
} = {}) {
  await page.route("**/api/nav-history?**", async (route) => {
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    await route.fulfill({
      status: options.status ?? 200,
      contentType: "application/json",
      body: JSON.stringify(options.body ?? dailyHistoryPayload()),
    });
  });
}
