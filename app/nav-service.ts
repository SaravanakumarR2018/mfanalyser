import type { HistoricalNavPoint, Portfolio, TimelinePoint } from "./cas-parser";
import { addWeeklyPortfolioPoints, sampleWeeklyNav } from "./timeline-service";

type NavRecord = {
  schemeCode: string;
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
      if (!prior || date >= prior.date) records.set(isin, { schemeCode, isin, nav, date, schemeName });
    }
  }
  return records;
};

type HistoricalNavResponse = {
  data?: {
    nav_groups?: Array<{
      historical_records?: Array<{ date?: string; nav?: number }>;
    }>;
  };
};

const addUtcDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const addUtcYears = (date: string, years: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCFullYear(value.getUTCFullYear() + years);
  return value.toISOString().slice(0, 10);
};

const historyRanges = (from: string, to: string) => {
  const ranges: Array<[string, string]> = [];
  let start = from;
  while (start <= to) {
    const fiveYearsLater = addUtcYears(start, 5);
    const end = fiveYearsLater <= to ? addUtcDays(fiveYearsLater, -2) : to;
    ranges.push([start, end]);
    start = addUtcDays(end, 1);
  }
  return ranges;
};

async function fetchSchemeHistory(schemeCode: string, from: string, to: string) {
  const byDate = new Map<string, HistoricalNavPoint>();
  for (const [rangeStart, rangeEnd] of historyRanges(from, to)) {
    const params = new URLSearchParams({
      query_type: "historical_period",
      from_date: rangeStart,
      to_date: rangeEnd,
      sd_id: schemeCode,
    });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 35_000);
    try {
      const response = await fetch(`/api/nav-history?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`AMFI history returned ${response.status}.`);
      const payload = await response.json() as HistoricalNavResponse;
      for (const group of payload.data?.nav_groups ?? []) {
        for (const record of group.historical_records ?? []) {
          if (!record.date || !Number.isFinite(record.nav) || Number(record.nav) <= 0) continue;
          byDate.set(record.date, { date: record.date, nav: Number(record.nav) });
        }
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }
  return sampleWeeklyNav([...byDate.values()]);
}

async function loadWeeklyHistories(
  holdings: Array<{ key: string; schemeCode?: string; transactions: Array<{ date: string }> }>,
  valuationDate: string,
) {
  const historyByKey = new Map<string, HistoricalNavPoint[]>();
  let updated = 0;
  const candidates = holdings.filter((holding) => holding.transactions.some((item) => item.date));
  const eligible = candidates.filter((holding) => holding.schemeCode);
  const concurrency = 10;
  for (let index = 0; index < eligible.length; index += concurrency) {
    const batch = eligible.slice(index, index + concurrency);
    await Promise.all(batch.map(async (holding) => {
      const firstDate = [...holding.transactions]
        .map((transaction) => transaction.date)
        .filter(Boolean)
        .sort()[0];
      if (!holding.schemeCode || !firstDate) return;
      try {
        const history = await fetchSchemeHistory(holding.schemeCode, firstDate, valuationDate);
        if (history.length) {
          historyByKey.set(holding.key, history);
          updated += 1;
        }
      } catch {
        // A missing history must not discard a valid current NAV update.
      }
    }));
  }
  return { historyByKey, updated, total: candidates.length };
}

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
      if (!record) return fund;
      if (record.date < fund.navDate) return { ...fund, schemeCode: record.schemeCode };
      updated += 1;
      if (record.date > valuationDate) valuationDate = record.date;
      return {
        ...fund,
        schemeCode: record.schemeCode,
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

    const closedFunds = portfolio.closedFunds.map((fund) => {
      const record = records.get(fund.isin);
      const hasUsableName = fund.name.length > 12 && !fund.name.toLowerCase().startsWith("demat");
      if (!record) return fund;
      return {
        ...fund,
        schemeCode: record.schemeCode,
        name: hasUsableName ? fund.name : record.schemeName,
      };
    });

    const currentValue = funds.reduce((total, fund) => total + fund.currentValue, 0);
    const livePoint: TimelinePoint = {
      date: valuationDate,
      invested: portfolio.invested,
      value: currentValue,
      live: true,
      transaction: [...funds, ...closedFunds]
        .some((fund) => fund.transactions.some((transaction) => transaction.date === valuationDate)),
    };
    const endpointTimeline = [...portfolio.timeline];
    if (endpointTimeline.at(-1)?.date === valuationDate) endpointTimeline[endpointTimeline.length - 1] = livePoint;
    else endpointTimeline.push(livePoint);
    const historyTotal = [...funds, ...closedFunds]
      .filter((fund) => fund.transactions.some((transaction) => transaction.date)).length;

    return {
      ...portfolio,
      valuationDate,
      valuationSource: "amfi",
      currentValue,
      funds: funds.sort((a, b) => b.currentValue - a.currentValue),
      closedFunds,
      timeline: endpointTimeline,
      navCoverage: { updated, total: portfolio.funds.length },
      navHistoryCoverage: { updated: 0, total: historyTotal },
      navHistoryLoading: historyTotal > 0,
      liveUpdateError: updated === portfolio.funds.length
        ? undefined
        : `${portfolio.funds.length - updated} fund${portfolio.funds.length - updated === 1 ? "" : "s"} could not be updated from AMFI.`,
    };
  } catch (error) {
    return {
      ...portfolio,
      valuationSource: "cas",
      navCoverage: { updated: 0, total: portfolio.funds.length },
      navHistoryCoverage: { updated: 0, total: portfolio.funds.length },
      navHistoryLoading: false,
      liveUpdateError: error instanceof Error ? error.message : "Live NAVs could not be loaded.",
    };
  }
}

export async function refreshWithWeeklyHistory(portfolio: Portfolio): Promise<Portfolio> {
  if (portfolio.source === "demo" || !portfolio.navHistoryLoading) return portfolio;
  try {
    const history = await loadWeeklyHistories(
      [...portfolio.funds, ...portfolio.closedFunds],
      portfolio.valuationDate,
    );
    const funds = portfolio.funds.map((fund) => {
      const weeklyNav = history.historyByKey.get(fund.key);
      if (!weeklyNav) return fund;
      return {
        ...fund,
        weeklyNav,
        folioHoldings: fund.folioHoldings.map((folio) => ({ ...folio, weeklyNav })),
      };
    });
    const closedFunds = portfolio.closedFunds.map((fund) => ({
      ...fund,
      weeklyNav: history.historyByKey.get(fund.key),
    }));
    return {
      ...portfolio,
      funds,
      closedFunds,
      timeline: addWeeklyPortfolioPoints(portfolio.timeline, funds, closedFunds),
      navHistoryCoverage: { updated: history.updated, total: history.total },
      navHistoryLoading: false,
      liveUpdateError: history.updated === history.total
        ? portfolio.liveUpdateError
        : `Weekly AMFI history was unavailable for ${history.total - history.updated} scheme${history.total - history.updated === 1 ? "" : "s"}.`,
    };
  } catch (error) {
    return {
      ...portfolio,
      navHistoryLoading: false,
      liveUpdateError: error instanceof Error ? error.message : "Weekly AMFI history could not be loaded.",
    };
  }
}
