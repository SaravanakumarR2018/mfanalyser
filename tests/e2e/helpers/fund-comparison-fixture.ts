import type { Page, Route } from "@playwright/test";

export const COMPARISON_SCHEMES = {
  alpha: { code: "100001", isin: "INF111A01010", name: "Alpha Flexi Cap Direct Growth", latestNav: 16 },
  beta: { code: "100002", isin: "INF222B02020", name: "Beta Mid Cap Direct Growth", latestNav: 32 },
  gamma: { code: "100003", isin: "INF333C03030", name: "Gamma Small Cap Direct Growth", latestNav: 12 },
  delta: { code: "100004", isin: "INF444D04040", name: "Delta Value Direct Growth", latestNav: 14 },
  unavailable: { isin: "INF999U09090", name: "Unmatched Equity Direct Growth" },
} as const;

export type ComparisonSchemeKey = Exclude<keyof typeof COMPARISON_SCHEMES, "unavailable">;

const escapePdfText = (value: string) => value
  .replaceAll("\\", "\\\\")
  .replaceAll("(", "\\(")
  .replaceAll(")", "\\)");

const buildPdf = (lines: string[]) => {
  const objects: string[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pages = addObject("");
  const font = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const commands = [
    "BT", "/F1 9 Tf", "12 TL", "42 770 Td",
    ...lines.flatMap((line, index) => [
      `(${escapePdfText(line)}) Tj`,
      ...(index === lines.length - 1 ? [] : ["T*"]),
    ]),
    "ET",
  ].join("\n");
  const content = addObject(`<< /Length ${Buffer.byteLength(commands, "latin1")} >>\nstream\n${commands}\nendstream`);
  const page = addObject(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`);
  objects[pages - 1] = `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`;

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
};

/**
 * A reconciled, multi-scheme CAS used to test the comparison through the real
 * pdf.js extraction and CAS parser. Alpha includes two same-day cash-flow
 * events, Gamma has the latest inception, Delta is closed, and Unmatched has no
 * public scheme mapping.
 */
export const makeFundComparisonCasPdf = () => buildPdf([
  "Consolidated Account Statement",
  "PORTFOLIO SUMMARY",
  "Total 22,000.00 31,500.00",
  `${COMPARISON_SCHEMES.alpha.name} - ISIN : ${COMPARISON_SCHEMES.alpha.isin} Registrar : CAMS`,
  "Folio No : 11111111/11",
  "NAV on 31-Jul-2026: INR 14.0000 Market Value on 31-Jul-2026: INR 11,200.00",
  "Closing Unit Balance: 800.000 Total Cost Value: 9,000.00",
  "02-Jan-2020 Purchase 7,000.00 700.000 10.0000 700.000",
  "16-Jun-2023 SIP Purchase 3,000.00 150.000 20.0000 850.000",
  "16-Jun-2023 Redemption -1,000.00 -50.000 20.0000 800.000",
  `${COMPARISON_SCHEMES.beta.name} - ISIN : ${COMPARISON_SCHEMES.beta.isin} Registrar : CAMS`,
  "Folio No : 22222222/22",
  "NAV on 31-Jul-2026: INR 30.0000 Market Value on 31-Jul-2026: INR 9,000.00",
  "Closing Unit Balance: 300.000 Total Cost Value: 6,000.00",
  "04-Jan-2021 Purchase 6,000.00 300.000 20.0000 300.000",
  `${COMPARISON_SCHEMES.gamma.name} - ISIN : ${COMPARISON_SCHEMES.gamma.isin} Registrar : CAMS`,
  "Folio No : 33333333/33",
  "NAV on 31-Jul-2026: INR 10.0000 Market Value on 31-Jul-2026: INR 8,000.00",
  "Closing Unit Balance: 800.000 Total Cost Value: 4,000.00",
  "03-Jan-2022 Purchase 4,000.00 800.000 5.0000 800.000",
  `${COMPARISON_SCHEMES.unavailable.name} - ISIN : ${COMPARISON_SCHEMES.unavailable.isin} Registrar : CAMS`,
  "Folio No : 99999999/99",
  "NAV on 31-Jul-2026: INR 11.0000 Market Value on 31-Jul-2026: INR 3,300.00",
  "Closing Unit Balance: 300.000 Total Cost Value: 3,000.00",
  "03-Jan-2022 Purchase 3,000.00 300.000 10.0000 300.000",
  `${COMPARISON_SCHEMES.delta.name} - ISIN : ${COMPARISON_SCHEMES.delta.isin} Registrar : CAMS`,
  "Folio No : 44444444/44",
  "01-Jan-2019 Purchase 5,000.00 500.000 10.0000 500.000",
  "02-Jan-2020 Redemption -6,000.00 -500.000 12.0000 0.000",
]);

export const comparisonLatestNavText = () => (
  (Object.values(COMPARISON_SCHEMES) as Array<typeof COMPARISON_SCHEMES[keyof typeof COMPARISON_SCHEMES]>)
    .filter((scheme): scheme is typeof COMPARISON_SCHEMES[ComparisonSchemeKey] => "code" in scheme)
    .map((scheme) => `${scheme.code};${scheme.isin};;${scheme.name};${scheme.latestNav.toFixed(4)};14-Aug-2026`)
    .join("\n") + "\n"
);

const histories: Record<ComparisonSchemeKey, Array<{ date: string; nav: number }>> = {
  alpha: [
    { date: "02-01-2020", nav: 10 },
    { date: "04-01-2021", nav: 12 },
    { date: "03-01-2022", nav: 15 },
    { date: "15-06-2023", nav: 20 },
    { date: "01-08-2024", nav: 18 },
    { date: "14-08-2025", nav: 19 },
    { date: "14-08-2026", nav: 16 },
  ],
  beta: [
    { date: "04-01-2021", nav: 20 },
    { date: "03-01-2022", nav: 25 },
    { date: "01-08-2024", nav: 28 },
    { date: "14-08-2025", nav: 30 },
    { date: "14-08-2026", nav: 32 },
  ],
  gamma: [
    { date: "03-01-2022", nav: 5 },
    { date: "15-06-2023", nav: 6 },
    { date: "01-08-2024", nav: 8 },
    { date: "14-08-2025", nav: 10 },
    { date: "14-08-2026", nav: 12 },
  ],
  delta: [
    { date: "01-01-1990", nav: 10 },
    { date: "01-01-2019", nav: 11 },
    { date: "02-01-2020", nav: 12 },
    { date: "03-01-2022", nav: 15 },
    { date: "15-06-2023", nav: 16 },
    { date: "01-08-2024", nav: 13 },
    { date: "14-08-2025", nav: 13.5 },
    { date: "14-08-2026", nav: 14 },
  ],
};

export function comparisonHistoryPayload(key: ComparisonSchemeKey) {
  const scheme = COMPARISON_SCHEMES[key];
  return {
    status: "SUCCESS",
    meta: { scheme_code: scheme.code },
    data: histories[key].map((point) => ({ date: point.date, nav: point.nav.toFixed(4) })),
  };
}

export const comparisonKeyForCode = (code: string) => (
  (Object.keys(COMPARISON_SCHEMES) as Array<keyof typeof COMPARISON_SCHEMES>)
    .find((key) => "code" in COMPARISON_SCHEMES[key] && COMPARISON_SCHEMES[key].code === code)
) as ComparisonSchemeKey | undefined;

export async function fulfillComparisonHistory(route: Route, key: ComparisonSchemeKey) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(comparisonHistoryPayload(key)),
  });
}

export async function installFundComparisonMocks(page: Page, onHistory?: (
  route: Route,
  key: ComparisonSchemeKey,
  isFullHistory: boolean,
) => Promise<void>) {
  await page.route("**/api/nav", (route) => route.fulfill({
    status: 200,
    contentType: "text/plain; charset=utf-8",
    body: comparisonLatestNavText(),
  }));
  await page.route("**/api/nav-history?**", async (route) => {
    const url = new URL(route.request().url());
    const key = comparisonKeyForCode(url.searchParams.get("sd_id") ?? "");
    if (!key) {
      await route.fulfill({ status: 400, contentType: "application/json", body: "{}" });
      return;
    }
    if (onHistory) {
      await onHistory(route, key, url.searchParams.get("from_date") === "1900-01-01");
      return;
    }
    await fulfillComparisonHistory(route, key);
  });
}
