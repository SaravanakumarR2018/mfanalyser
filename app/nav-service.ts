import type { HistoricalNavPoint, Portfolio, TimelinePoint } from "./cas-parser";
import type { FundComparisonCandidate } from "./fund-comparison-service";
import { fullHistoryRange, historyRange, mirrorDateToIso } from "./nav-history-utils";
import { addDailyPortfolioPoints, normalizePublishedNav } from "./timeline-service";

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

const isIsoCalendarDate = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
};

const parseAmfiDate = (value: string) => {
  const match = value.trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match || !MONTHS[match[2]]) return "";
  return `${match[3]}-${MONTHS[match[2]]}-${match[1]}`;
};

export const parseAmfiNavText = (text: string) => {
  const records = new Map<string, NavRecord>();
  for (const line of text.split(/\r?\n/)) {
    const fields = line.split(";");
    if (fields.length < 6) continue;
    const [schemeCode, primaryIsin, reinvestmentIsin] = fields;
    const schemeName = fields[3];
    const navValue = fields[fields.length - 2];
    const navDate = fields[fields.length - 1];
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
  status?: string;
  meta?: { scheme_code?: string | number };
  data?: {
    nav_groups?: Array<{
      historical_records?: Array<{ date?: string; nav?: number }>;
    }>;
  } | Array<{ date?: string; nav?: string | number }>;
};

const HISTORY_CONCURRENCY = 4;
const HISTORY_BATCH_PAUSE_MS = 900;
const wait = (milliseconds: number) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
const historySessionCache = new Map<string, HistoricalNavPoint[]>();
let historySessionFetch = globalThis.fetch;

const currentHistoryCache = () => {
  if (historySessionFetch !== globalThis.fetch) {
    historySessionCache.clear();
    historySessionFetch = globalThis.fetch;
  }
  return historySessionCache;
};

const historyCacheKey = (
  schemeCode: string,
  range: [string, string],
  expected: Array<{ nav?: number; date?: string }>,
) => `${schemeCode}:${range.join(":")}:${expected
  .map(({ nav, date }) => `${date ?? ""}:${nav ?? ""}`)
  .sort()
  .join("|")}`;

async function fetchSchemeHistory(
  schemeCode: string,
  range: [string, string],
  parentSignal?: AbortSignal,
) {
  const [from, to] = range;
  // Keep the browser coupled to our small, validated history contract rather
  // than to a third-party response shape. The proxy also gives Cloudflare one
  // shared cache for all visitors when the history provider is intermittent.
  const upstream = new URL("/api/nav-history", globalThis.location?.origin ?? "http://localhost");
  upstream.searchParams.set("schemeCode", schemeCode);
  upstream.searchParams.set("startDate", from);
  upstream.searchParams.set("endDate", to);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (parentSignal?.aborted) throw new DOMException("History load cancelled.", "AbortError");
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 30_000);
    const abort = () => controller.abort();
    parentSignal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(`${upstream.pathname}${upstream.search}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 429 && attempt < 2) {
          const retryAfter = Number(response.headers.get("retry-after"));
          await wait(Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1_000
            : 2_000 * (attempt + 1));
          continue;
        }
        throw new Error(`AMFI history returned ${response.status}.`);
      }
      const payload = await response.json() as HistoricalNavResponse;
      const points: HistoricalNavPoint[] = [];
      const mirrorRecords = Array.isArray(payload.data) ? payload.data : [];
      if (mirrorRecords.length && String(payload.meta?.scheme_code ?? "") !== schemeCode) {
        throw new Error("Published history returned a different scheme.");
      }
      for (const record of mirrorRecords) {
        const date = mirrorDateToIso(record.date ?? "");
        const nav = Number(record.nav);
        if (isIsoCalendarDate(date) && date >= from && date <= to && Number.isFinite(nav) && nav > 0) {
          points.push({ date, nav });
        }
      }
      const navGroups = !Array.isArray(payload.data) ? payload.data?.nav_groups ?? [] : [];
      for (const group of navGroups) {
        for (const record of group.historical_records ?? []) {
          const nav = Number(record.nav);
          if (!record.date || !isIsoCalendarDate(record.date) || !Number.isFinite(nav) || nav <= 0) {
            continue;
          }
          points.push({ date: record.date, nav });
        }
      }
      const publishedPoints = normalizePublishedNav(points);
      return { points: publishedPoints, complete: publishedPoints.length > 0 };
    } catch (error) {
      lastError = error;
      if (parentSignal?.aborted) throw error;
      if (attempt < 2) await wait(500 * (attempt + 1));
    } finally {
      globalThis.clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AMFI history could not be loaded.");
}

const reconcileHistoryWithExpectedNav = (
  points: readonly HistoricalNavPoint[],
  expectedNav?: number,
  expectedDate?: string,
) => {
  if (expectedNav === undefined && expectedDate === undefined) return [...points];
  if (!expectedDate || !isIsoCalendarDate(expectedDate) || !Number.isFinite(expectedNav) || (expectedNav ?? 0) <= 0) {
    throw new Error("Historical NAV did not reconcile to the latest official NAV.");
  }
  const expectedPoint = points.find((point) => point.date === expectedDate);
  if (expectedPoint) {
    if (Math.abs(expectedPoint.nav - expectedNav) > Math.max(0.000001, expectedNav * 0.0000001)) {
      throw new Error("Historical NAV did not reconcile to the latest official NAV.");
    }
    return [...points];
  }
  const latestHistoryDate = points.at(-1)?.date;
  if (!latestHistoryDate || expectedDate <= latestHistoryDate) {
    throw new Error("Historical NAV did not reconcile to the latest official NAV.");
  }
  return normalizePublishedNav([...points, { date: expectedDate, nav: expectedNav }]);
};

export async function loadFullSchemeNavHistory(
  schemeCode: string,
  valuationDate: string,
  expectedNav?: number,
  expectedDate?: string,
  signal?: AbortSignal,
): Promise<HistoricalNavPoint[]> {
  if (!/^\d{1,12}$/.test(schemeCode) || !/^\d{4}-\d{2}-\d{2}$/.test(valuationDate)) {
    throw new Error("Full published NAV history is unavailable for this scheme.");
  }
  const range = fullHistoryRange(valuationDate);
  const cacheKey = historyCacheKey(schemeCode, range, [{ nav: expectedNav, date: expectedDate }]);
  const cachedPoints = currentHistoryCache().get(cacheKey);
  if (cachedPoints) return cachedPoints;
  const history = await fetchSchemeHistory(
    schemeCode,
    range,
    signal,
  );
  if (!history.points.length) {
    throw new Error("Full published NAV history is unavailable for this scheme.");
  }
  const reconciledHistory = reconcileHistoryWithExpectedNav(history.points, expectedNav, expectedDate);
  currentHistoryCache().set(cacheKey, reconciledHistory);
  return reconciledHistory;
}

export type FundComparisonHistoryProgress = {
  completed: number;
  total: number;
};

export type FundComparisonHistoryLoadResult = {
  historyByKey: Map<string, HistoricalNavPoint[]>;
  failures: Map<string, string>;
  completed: number;
  total: number;
};

type FundComparisonHistoryTarget = {
  schemeCode: string;
  candidates: FundComparisonCandidate[];
};

export async function loadFundComparisonHistories(
  candidates: readonly FundComparisonCandidate[],
  valuationDate: string,
  signal?: AbortSignal,
  onProgress?: (progress: FundComparisonHistoryProgress) => void,
): Promise<FundComparisonHistoryLoadResult> {
  if (signal?.aborted) throw new DOMException("History load cancelled.", "AbortError");
  const historyByKey = new Map<string, HistoricalNavPoint[]>();
  const failures = new Map<string, string>();
  const total = candidates.length;
  let completed = 0;

  if (!isIsoCalendarDate(valuationDate)) {
    for (const candidate of candidates) {
      failures.set(candidate.key, "Full published NAV history is unavailable for this scheme.");
    }
    onProgress?.({ completed: total, total });
    return { historyByKey, failures, completed: total, total };
  }

  const targetByScheme = new Map<string, FundComparisonHistoryTarget>();
  for (const candidate of candidates) {
    if (!candidate.schemeCode || !/^\d{1,12}$/.test(candidate.schemeCode)) {
      failures.set(candidate.key, "An official AMFI scheme match is unavailable.");
      completed += 1;
      continue;
    }
    const existing = targetByScheme.get(candidate.schemeCode);
    if (existing) existing.candidates.push(candidate);
    else targetByScheme.set(candidate.schemeCode, {
      schemeCode: candidate.schemeCode,
      candidates: [candidate],
    });
  }

  onProgress?.({ completed, total });
  const targets = [...targetByScheme.values()];
  for (let cursor = 0; cursor < targets.length; cursor += HISTORY_CONCURRENCY) {
    const batch = targets.slice(cursor, cursor + HISTORY_CONCURRENCY);
    await Promise.all(batch.map(async (target) => {
      if (signal?.aborted) throw new DOMException("History load cancelled.", "AbortError");
      try {
        const range = fullHistoryRange(valuationDate);
        const cacheKey = historyCacheKey(
          target.schemeCode,
          range,
          target.candidates.map((candidate) => ({
            nav: candidate.expectedNav,
            date: candidate.expectedNavDate,
          })),
        );
        let reconciledHistory = currentHistoryCache().get(cacheKey);
        if (!reconciledHistory) {
          const history = await fetchSchemeHistory(
            target.schemeCode,
            range,
            signal,
          );
          if (!history.points.length) {
            throw new Error("Full published NAV history is unavailable for this scheme.");
          }
          reconciledHistory = history.points;
          for (const candidate of target.candidates) {
            reconciledHistory = reconcileHistoryWithExpectedNav(
              reconciledHistory,
              candidate.expectedNav,
              candidate.expectedNavDate,
            );
          }
          currentHistoryCache().set(cacheKey, reconciledHistory);
        }
        for (const candidate of target.candidates) {
          historyByKey.set(candidate.key, reconciledHistory);
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        const message = error instanceof Error
          && /reconcile|unavailable for this scheme/i.test(error.message)
          ? error.message
          : "Full published NAV history could not be loaded.";
        for (const candidate of target.candidates) failures.set(candidate.key, message);
      } finally {
        completed += target.candidates.length;
        onProgress?.({ completed: Math.min(completed, total), total });
      }
    }));
    if (cursor + HISTORY_CONCURRENCY < targets.length) await wait(HISTORY_BATCH_PAUSE_MS);
  }

  return { historyByKey, failures, completed: Math.min(completed, total), total };
}

type HistoryTarget = {
  schemeCode: string;
  keys: string[];
  firstDate: string;
  expectedNav?: number;
  expectedDate?: string;
};

type HistoryLoadProgress = {
  historyByKey: Map<string, HistoricalNavPoint[]>;
  updated: number;
  total: number;
  incomplete: number;
};

export type NavHistoryProgress = {
  completed: number;
  total: number;
};

async function loadDailyHistories(
  holdings: Array<{
    key: string;
    schemeCode?: string;
    nav?: number;
    navDate?: string;
    liveNav?: boolean;
    transactions: Array<{ date: string }>;
  }>,
  valuationDate: string,
  signal?: AbortSignal,
  onProgress?: (progress: NavHistoryProgress) => void,
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
        expectedNav: holding.liveNav ? holding.nav : undefined,
        expectedDate: holding.liveNav ? holding.navDate : undefined,
      });
    }
  }

  const targets = [...targetByScheme.values()];
  const historyByKey = new Map<string, HistoricalNavPoint[]>();
  const incompleteSchemes = new Set<string>();
  const requestable = targets.reduce((total, target) => total + target.keys.length, 0);
  let completed = Math.max(0, candidates.length - requestable);
  onProgress?.({ completed, total: candidates.length });
  for (let cursor = 0; cursor < targets.length; cursor += HISTORY_CONCURRENCY) {
    const batch = targets.slice(cursor, cursor + HISTORY_CONCURRENCY);
    await Promise.all(batch.map(async (target) => {
      if (signal?.aborted) throw new DOMException("History load cancelled.", "AbortError");
      try {
        const history = await fetchSchemeHistory(
          target.schemeCode,
          historyRange(target.firstDate, valuationDate),
          signal,
        );
        const expectedPoint = target.expectedDate
          ? history.points.find((point) => point.date === target.expectedDate)
          : undefined;
        if (
          expectedPoint
          && target.expectedNav
          && Math.abs(expectedPoint.nav - target.expectedNav) > Math.max(0.000001, target.expectedNav * 0.0000001)
        ) {
          throw new Error("Historical NAV did not reconcile to the latest official NAV.");
        }
        for (const key of target.keys) {
          if (history.points.length) historyByKey.set(key, history.points);
        }
        if (!history.complete || !history.points.length) incompleteSchemes.add(target.schemeCode);
      } catch (error) {
        if (signal?.aborted) throw error;
        incompleteSchemes.add(target.schemeCode);
      } finally {
        completed += target.keys.length;
        onProgress?.({ completed: Math.min(completed, candidates.length), total: candidates.length });
      }
    }));
    if (cursor + HISTORY_CONCURRENCY < targets.length) await wait(HISTORY_BATCH_PAUSE_MS);
  }
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
    const endpointTimeline = [...portfolio.timeline];
    const priorEndpoint = endpointTimeline.at(-1)?.date === valuationDate
      ? endpointTimeline.at(-1)
      : undefined;
    const livePoint: TimelinePoint = {
      date: valuationDate,
      invested: portfolio.invested,
      value: currentValue,
      live: true,
      transaction: Boolean(priorEndpoint?.transaction || latestTransactions.length),
      transactionAmount: priorEndpoint?.transactionAmount
        ?? (latestTransactions.length
          ? latestTransactions.reduce((total, transaction) => total + transaction.amount, 0)
          : undefined),
      transactionCount: priorEndpoint?.transactionCount ?? (latestTransactions.length || undefined),
    };
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
      navHistoryError: "Daily NAV history requires a successful AMFI scheme match.",
      liveUpdateError: error instanceof Error ? error.message : "Live NAVs could not be loaded.",
    };
  }
}

const applyDailyHistories = (
  portfolio: Portfolio,
  progress: HistoryLoadProgress,
  loading: boolean,
) => {
  const funds = portfolio.funds.map((fund) => {
    const navHistory = progress.historyByKey.get(fund.key);
    if (!navHistory) return fund;
    return {
      ...fund,
      navHistory,
      folioHoldings: fund.folioHoldings.map((folio) => ({ ...folio, navHistory })),
    };
  });
  const closedFunds = portfolio.closedFunds.map((fund) => ({
    ...fund,
    navHistory: progress.historyByKey.get(fund.key),
  }));
  const missing = Math.max(progress.total - progress.updated, progress.incomplete);
  return {
    ...portfolio,
    funds,
    closedFunds,
    timeline: addDailyPortfolioPoints(portfolio.timeline, funds, closedFunds),
    navHistoryCoverage: { updated: progress.updated, total: progress.total },
    navHistoryLoading: loading,
    navHistoryError: !loading && missing > 0
      ? `Official daily NAV history was incomplete for ${missing} scheme${missing === 1 ? "" : "s"}; no values were estimated for missing dates.`
      : undefined,
  };
};

export async function refreshWithDailyHistory(
  portfolio: Portfolio,
  signal?: AbortSignal,
  onProgress?: (progress: NavHistoryProgress) => void,
): Promise<Portfolio> {
  if (portfolio.source === "demo" || !portfolio.navHistoryLoading) return portfolio;
  try {
    const history = await loadDailyHistories(
      [...portfolio.funds, ...portfolio.closedFunds],
      portfolio.valuationDate,
      signal,
      onProgress,
    );
    return applyDailyHistories(portfolio, history, false);
  } catch (error) {
    return {
      ...portfolio,
      navHistoryLoading: false,
      navHistoryError: error instanceof Error ? error.message : "Daily AMFI history could not be loaded.",
    };
  }
}
