import type { HistoricalNavPoint, Portfolio, TimelinePoint } from "./cas-parser";
import { historyRanges, MINIMUM_HISTORY_DATE } from "./nav-history-utils";
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
      if (!prior || date >= prior.date) {
        records.set(isin, { schemeCode, isin, nav, date, schemeName });
      }
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

const HISTORY_CONCURRENCY = 6;

async function fetchHistoryRange(schemeCode: string, from: string, to: string) {
  const params = new URLSearchParams({
    query_type: "historical_period",
    from_date: from,
    to_date: to,
    sd_id: schemeCode,
  });
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`/api/nav-history?${params}`, {
        cache: "force-cache",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`AMFI history returned ${response.status}.`);
      const payload = await response.json() as HistoricalNavResponse;
      const points: HistoricalNavPoint[] = [];
      for (const group of payload.data?.nav_groups ?? []) {
        for (const record of group.historical_records ?? []) {
          const nav = Number(record.nav);
          if (!record.date || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) || !Number.isFinite(nav) || nav <= 0) {
            continue;
          }
          points.push({ date: record.date, nav });
        }
      }
      return points;
    } catch (error) {
      lastError = error;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AMFI history could not be loaded.");
}

async function fetchSchemeHistory(schemeCode: string, from: string, to: string) {
  const byDate = new Map<string, HistoricalNavPoint>();
  let complete = from >= MINIMUM_HISTORY_DATE;
  for (const [rangeStart, rangeEnd] of historyRanges(from, to)) {
    try {
      for (const point of await fetchHistoryRange(schemeCode, rangeStart, rangeEnd)) {
        byDate.set(point.date, point);
      }
    } catch {
      complete = false;
    }
  }
  return { points: sampleWeeklyNav([...byDate.values()]), complete };
}

type HistoryTarget = {
  schemeCode: string;
  keys: string[];
  firstDate: string;
};

type HistoryLoadProgress = {
  historyByKey: Map<string, HistoricalNavPoint[]>;
  updated: number;
  total: number;
  incomplete: number;
};

async function loadWeeklyHistories(
  holdings: Array<{ key: string; schemeCode?: string; transactions: Array<{ date: string }> }>,
  valuationDate: string,
  onProgress?: (progress: HistoryLoadProgress) => void,
) {
  const candidates = holdings.filter((holding) => holding.transactions.some((item) => item.date));
  const targetByScheme = new Map<string, HistoryTarget>();
  for (const holding of candidates) {
    if (!holding.schemeCode) continue;
    const firstDate = holding.transactions
      .map((transaction) => transaction.date)
      .filter(Boolean)
      .sort()[0];
    if (!firstDate) continue;
    const existing = targetByScheme.get(holding.schemeCode);
    if (existing) {
      existing.keys.push(holding.key);
      if (firstDate < existing.firstDate) existing.firstDate = firstDate;
    } else {
      targetByScheme.set(holding.schemeCode, {
        schemeCode: holding.schemeCode,
        keys: [holding.key],
        firstDate,
      });
    }
  }

  const targets = [...targetByScheme.values()];
  const historyByKey = new Map<string, HistoricalNavPoint[]>();
  const incompleteSchemes = new Set<string>();
  let cursor = 0;

  const report = () => {
    const updated = candidates.filter((holding) => historyByKey.has(holding.key)).length;
    const incomplete = candidates.filter(
      (holding) => !historyByKey.has(holding.key)
        || Boolean(holding.schemeCode && incompleteSchemes.has(holding.schemeCode)),
    ).length;
    onProgress?.({
      historyByKey: new Map(historyByKey),
      updated,
      total: candidates.length,
      incomplete,
    });
  };

  const worker = async () => {
    while (cursor < targets.length) {
      const target = targets[cursor];
      cursor += 1;
      const history = await fetchSchemeHistory(target.schemeCode, target.firstDate, valuationDate);
      for (const key of target.keys) {
        if (history.points.length) historyByKey.set(key, history.points);
      }
      if (!history.complete || !history.points.length) incompleteSchemes.add(target.schemeCode);
      report();
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(HISTORY_CONCURRENCY, targets.length) }, () => worker()),
  );
  report();
  const updated = candidates.filter((holding) => historyByKey.has(holding.key)).length;
  const incomplete = candidates.filter(
    (holding) => !historyByKey.has(holding.key)
      || Boolean(holding.schemeCode && incompleteSchemes.has(holding.schemeCode)),
  ).length;
  return {
    historyByKey,
    updated,
    total: candidates.length,
    incomplete,
  };
}

export async function refreshWithLatestNav(portfolio: Portfolio): Promise<Portfolio> {
  if (portfolio.source === "demo") return portfolio;
  try {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 15_000);
    const response = await fetch("/api/nav", { cache: "no-store", signal: controller.signal });
    globalThis.clearTimeout(timeout);
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
    const allTransactions = [...funds, ...closedFunds].flatMap((fund) => fund.transactions);
    const latestTransactions = allTransactions.filter((transaction) => transaction.date === valuationDate);
    const livePoint: TimelinePoint = {
      date: valuationDate,
      invested: portfolio.invested,
      value: currentValue,
      live: true,
      transaction: latestTransactions.length > 0,
      transactionAmount: latestTransactions.reduce((total, transaction) => total + transaction.amount, 0),
      transactionCount: latestTransactions.length || undefined,
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
      funds: funds.sort((left, right) => right.currentValue - left.currentValue),
      closedFunds,
      timeline: endpointTimeline,
      navCoverage: { updated, total: portfolio.funds.length },
      navHistoryCoverage: { updated: 0, total: historyTotal },
      navHistoryLoading: historyTotal > 0,
      navHistoryError: undefined,
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
      navHistoryError: "Weekly NAV history requires a successful AMFI scheme match.",
      liveUpdateError: error instanceof Error ? error.message : "Live NAVs could not be loaded.",
    };
  }
}

const applyWeeklyHistories = (
  portfolio: Portfolio,
  progress: HistoryLoadProgress,
  loading: boolean,
) => {
  const funds = portfolio.funds.map((fund) => {
    const weeklyNav = progress.historyByKey.get(fund.key);
    if (!weeklyNav) return fund;
    return {
      ...fund,
      weeklyNav,
      folioHoldings: fund.folioHoldings.map((folio) => ({ ...folio, weeklyNav })),
    };
  });
  const closedFunds = portfolio.closedFunds.map((fund) => ({
    ...fund,
    weeklyNav: progress.historyByKey.get(fund.key),
  }));
  const missing = Math.max(progress.total - progress.updated, progress.incomplete);
  return {
    ...portfolio,
    funds,
    closedFunds,
    timeline: addWeeklyPortfolioPoints(portfolio.timeline, funds, closedFunds),
    navHistoryCoverage: { updated: progress.updated, total: progress.total },
    navHistoryLoading: loading,
    navHistoryError: !loading && missing > 0
      ? `Official weekly NAV history was incomplete for ${missing} scheme${missing === 1 ? "" : "s"}; no values were estimated for missing weeks.`
      : undefined,
  };
};

export async function refreshWithWeeklyHistory(
  portfolio: Portfolio,
  onProgress?: (portfolio: Portfolio) => void,
): Promise<Portfolio> {
  if (portfolio.source === "demo" || !portfolio.navHistoryLoading) return portfolio;
  try {
    const history = await loadWeeklyHistories(
      [...portfolio.funds, ...portfolio.closedFunds],
      portfolio.valuationDate,
      (progress) => onProgress?.(applyWeeklyHistories(portfolio, progress, true)),
    );
    return applyWeeklyHistories(portfolio, history, false);
  } catch (error) {
    return {
      ...portfolio,
      navHistoryLoading: false,
      navHistoryError: error instanceof Error ? error.message : "Weekly AMFI history could not be loaded.",
    };
  }
}
