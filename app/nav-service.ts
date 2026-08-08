import type { Portfolio, TimelinePoint } from "./cas-parser";

type NavRecord = {
  isin: string;
  nav: number;
  date: string;
  schemeName: string;
};

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

const parseAmfiDate = (value: string) => {
  const match = value.trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match || !MONTHS[match[2]]) return "";
  return `${match[3]}-${MONTHS[match[2]]}-${match[1]}`;
};

export const parseAmfiNavText = (text: string) => {
  const records = new Map<string, NavRecord>();
  for (const line of text.split(/\r?\n/)) {
    const [schemeCode, primaryIsin, reinvestmentIsin, schemeName, navValue, navDate] = line.split(";");
    if (!schemeCode || !schemeName || !navValue || !navDate) continue;
    const nav = Number(navValue);
    const date = parseAmfiDate(navDate);
    if (!Number.isFinite(nav) || nav <= 0 || !date) continue;
    for (const isin of [primaryIsin, reinvestmentIsin]) {
      if (!/^INF[A-Z0-9]{9}$/.test(isin)) continue;
      const prior = records.get(isin);
      if (!prior || date >= prior.date) records.set(isin, { isin, nav, date, schemeName });
    }
  }
  return records;
};

export async function refreshWithLatestNav(portfolio: Portfolio): Promise<Portfolio> {
  if (portfolio.source === "demo") return portfolio;
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    const response = await fetch("/api/nav", { cache: "no-store", signal: controller.signal });
    window.clearTimeout(timeout);
    if (!response.ok) throw new Error("Official AMFI NAVs are temporarily unavailable.");
    const records = parseAmfiNavText(await response.text());
    if (!records.size) throw new Error("The AMFI NAV response could not be read safely.");

    let updated = 0;
    let valuationDate = portfolio.statementDate;
    const funds = portfolio.funds.map((fund) => {
      const record = records.get(fund.isin);
      if (!record || record.date < fund.navDate) return fund;
      updated += 1;
      if (record.date > valuationDate) valuationDate = record.date;
      return {
        ...fund,
        currentValue: fund.units * record.nav,
        nav: record.nav,
        navDate: record.date,
        liveNav: true,
        folioHoldings: fund.folioHoldings.map((folio) => ({
          ...folio,
          currentValue: folio.units * record.nav,
          nav: record.nav,
          navDate: record.date,
          liveNav: true,
        })),
      };
    });
    if (!updated) throw new Error("None of the statement schemes matched the latest AMFI data.");

    const currentValue = funds.reduce((total, fund) => total + fund.currentValue, 0);
    const previousFolios = new Map(
      portfolio.funds.flatMap((fund) => fund.folioHoldings.map((folio) => [folio.key, folio.currentValue] as const)),
    );
    const livePoint: TimelinePoint = {
      date: valuationDate,
      invested: portfolio.invested,
      value: currentValue,
      live: true,
      contributors: funds.flatMap((fund) => fund.folioHoldings.map((folio) => ({
        label: fund.name,
        folio: folio.label,
        valueChange: folio.currentValue - (previousFolios.get(folio.key) ?? 0),
        investedChange: 0,
      }))).filter((contributor) => Math.abs(contributor.valueChange) >= 0.005),
    };
    const timeline = [...portfolio.timeline];
    if (timeline.at(-1)?.date === valuationDate) timeline[timeline.length - 1] = livePoint;
    else timeline.push(livePoint);

    const closedFunds = portfolio.closedFunds.map((fund) => {
      const record = records.get(fund.isin);
      const hasUsableName = fund.name.length > 12 && !fund.name.toLowerCase().startsWith("demat");
      return record && !hasUsableName ? { ...fund, name: record.schemeName } : fund;
    });

    return {
      ...portfolio,
      valuationDate,
      valuationSource: "amfi",
      currentValue,
      funds: funds.sort((a, b) => b.currentValue - a.currentValue),
      closedFunds,
      timeline,
      navCoverage: { updated, total: portfolio.funds.length },
      liveUpdateError: updated === portfolio.funds.length
        ? undefined
        : `${portfolio.funds.length - updated} fund${portfolio.funds.length - updated === 1 ? "" : "s"} could not be updated from AMFI.`,
    };
  } catch (error) {
    return {
      ...portfolio,
      valuationSource: "cas",
      navCoverage: { updated: 0, total: portfolio.funds.length },
      liveUpdateError: error instanceof Error ? error.message : "Live NAVs could not be loaded.",
    };
  }
}
