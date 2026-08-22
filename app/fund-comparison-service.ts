import type {
  ClosedFund,
  FundHolding,
  FundTransaction,
  HistoricalNavPoint,
  Portfolio,
} from "./cas-parser";

export type FundComparisonCandidate = {
  key: string;
  name: string;
  isin: string;
  schemeCode?: string;
  category: string;
  active: boolean;
  closed: boolean;
  transactions: FundTransaction[];
  expectedNav?: number;
  expectedNavDate?: string;
};

export type FundComparisonPoint = {
  date: string;
  nav: number;
  indexedValue: number;
};

export type FundComparisonSeries = {
  key: string;
  name: string;
  isin: string;
  schemeCode?: string;
  category: string;
  active: boolean;
  closed: boolean;
  baseNav: number;
  points: FundComparisonPoint[];
  latestPoint?: FundComparisonPoint;
};

export type FundComparisonUnavailable = {
  key: string;
  name: string;
  reason: "missing-scheme" | "missing-history";
};

export type FundComparisonModel = {
  baselineDate?: string;
  dates: string[];
  series: FundComparisonSeries[];
  unavailable: FundComparisonUnavailable[];
  minIndex: number;
  maxIndex: number;
};

export type FundComparisonTooltipEntry = {
  key: string;
  name: string;
  date: string;
  available: boolean;
  nav?: number;
  indexedValue?: number;
};

export type FundComparisonScale = {
  min: number;
  max: number;
  step: number;
  ticks: number[];
};

export type FundComparisonAxisTick = {
  value: number;
  percentageChange: number;
};

export type FundComparisonLineState = "resting" | "emphasized" | "dimmed";

export function shouldStartFundComparisonHistoryLoad(
  navHistoryLoading: boolean | undefined,
  eligibleFundCount: number,
) {
  return navHistoryLoading !== true
    && Number.isInteger(eligibleFundCount)
    && eligibleFundCount > 0;
}

export function fundComparisonLineWidth(state: FundComparisonLineState) {
  if (state === "emphasized") return 3.2;
  if (state === "dimmed") return 0.85;
  return 1.15;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SCHEME_CODE = /^\d{1,12}$/;
const MAX_COMPARISON_INDEX = 1_000_000_000_000;

const isCalendarDate = (value: string) => {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
};

const transactionFingerprint = (transaction: FundTransaction) => [
  transaction.date,
  transaction.amount,
  transaction.price,
  transaction.units,
  transaction.balance,
  transaction.label,
  transaction.holdingKey ?? "",
].join("\u0000");

const transactionMultiset = (transactions: FundTransaction[]) => {
  const counts = new Map<string, number>();
  for (const transaction of transactions) {
    const fingerprint = transactionFingerprint(transaction);
    counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  }
  return counts;
};

const holdingTransactions = (holding: FundHolding | ClosedFund) => {
  const transactions = [...holding.transactions];
  if (!("folioHoldings" in holding)) return transactions;
  const canonicalCounts = transactionMultiset(transactions);
  const folioCounts = new Map<string, number>();
  for (const transaction of holding.folioHoldings.flatMap((folio) => folio.transactions)) {
    const fingerprint = transactionFingerprint(transaction);
    const occurrence = (folioCounts.get(fingerprint) ?? 0) + 1;
    folioCounts.set(fingerprint, occurrence);
    if (occurrence > (canonicalCounts.get(fingerprint) ?? 0)) transactions.push(transaction);
  }
  return transactions;
};

const mergeTransactionMultiset = (
  existing: FundTransaction[],
  incoming: FundTransaction[],
) => {
  const existingCounts = transactionMultiset(existing);
  const incomingCounts = new Map<string, number>();
  const merged = [...existing];
  for (const transaction of incoming) {
    const fingerprint = transactionFingerprint(transaction);
    const occurrence = (incomingCounts.get(fingerprint) ?? 0) + 1;
    incomingCounts.set(fingerprint, occurrence);
    if (occurrence > (existingCounts.get(fingerprint) ?? 0)) merged.push(transaction);
  }
  return merged.sort((left, right) => left.date.localeCompare(right.date));
};

const candidateIdentity = (holding: FundHolding | ClosedFund) => {
  if (holding.schemeCode && SCHEME_CODE.test(holding.schemeCode)) return `scheme:${holding.schemeCode}`;
  if (holding.isin) return `isin:${holding.isin}`;
  return `holding:${holding.key}`;
};

export function buildFundComparisonCandidates(portfolio: Portfolio): FundComparisonCandidate[] {
  const holdings: Array<{ holding: FundHolding | ClosedFund; active: boolean }> = [
    ...portfolio.funds.map((holding) => ({ holding, active: true })),
    ...portfolio.closedFunds.map((holding) => ({ holding, active: false })),
  ];
  const parent = holdings.map((_item, index) => index);
  const find = (index: number): number => {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  };
  const join = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
  };
  const firstByScheme = new Map<string, number>();
  const firstByIsin = new Map<string, number>();
  holdings.forEach(({ holding }, index) => {
    if (holding.schemeCode && SCHEME_CODE.test(holding.schemeCode)) {
      const prior = firstByScheme.get(holding.schemeCode);
      if (prior === undefined) firstByScheme.set(holding.schemeCode, index);
      else join(index, prior);
    }
    if (holding.isin) {
      const prior = firstByIsin.get(holding.isin);
      if (prior === undefined) firstByIsin.set(holding.isin, index);
      else join(index, prior);
    }
  });

  const groups = new Map<number, typeof holdings>();
  holdings.forEach((item, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(item);
    groups.set(root, group);
  });

  return [...groups.values()].map((group) => {
    const representative = group.find((item) => item.active) ?? group[0];
    const schemeCode = group
      .map(({ holding }) => holding.schemeCode)
      .filter((value): value is string => Boolean(value && SCHEME_CODE.test(value)))
      .sort()[0];
    const isin = group.map(({ holding }) => holding.isin).filter(Boolean).sort()[0] ?? "";
    const liveHolding = group.flatMap(({ holding, active }) =>
      active && "liveNav" in holding && holding.liveNav ? [holding] : [])[0];
    const transactions = group.reduce(
      (merged, { holding }) => mergeTransactionMultiset(merged, holdingTransactions(holding)),
      [] as FundTransaction[],
    );
    return {
      key: schemeCode ? `scheme:${schemeCode}` : isin ? `isin:${isin}` : candidateIdentity(representative.holding),
      name: representative.holding.name,
      isin,
      schemeCode,
      category: representative.holding.category,
      active: group.some((item) => item.active),
      closed: group.some((item) => !item.active),
      transactions,
      expectedNav: liveHolding?.nav,
      expectedNavDate: liveHolding?.navDate,
    };
  });
}

const safeIndexedValue = (nav: number, baseNav: number) => {
  const indexedValue = (nav / baseNav) * 100;
  return Number.isFinite(indexedValue)
    && indexedValue > 0
    && indexedValue <= MAX_COMPARISON_INDEX
    ? indexedValue
    : undefined;
};

const normalizeHistory = (
  history: readonly HistoricalNavPoint[] | undefined,
  asOfDate: string,
) => {
  if (!isCalendarDate(asOfDate)) return [];
  const byDate = new Map<string, HistoricalNavPoint>();
  for (const point of history ?? []) {
    if (
      !isCalendarDate(point.date)
      || point.date > asOfDate
      || !Number.isFinite(point.nav)
      || point.nav <= 0
    ) continue;
    byDate.set(point.date, { date: point.date, nav: point.nav });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
};

export function buildFundComparisonModel(
  candidates: readonly FundComparisonCandidate[],
  historyByKey: ReadonlyMap<string, HistoricalNavPoint[]>,
  selectedKeys: ReadonlySet<string>,
  asOfDate: string,
): FundComparisonModel {
  const selected = candidates.filter((candidate) => selectedKeys.has(candidate.key));
  const unavailable: FundComparisonUnavailable[] = [];
  const normalized = selected.flatMap((candidate) => {
    if (!candidate.schemeCode) {
      unavailable.push({ key: candidate.key, name: candidate.name, reason: "missing-scheme" });
      return [];
    }
    const points = normalizeHistory(historyByKey.get(candidate.key), asOfDate);
    if (!points.length) {
      unavailable.push({ key: candidate.key, name: candidate.name, reason: "missing-history" });
      return [];
    }
    return [{ candidate, points }];
  });

  if (!normalized.length) {
    return { dates: [], series: [], unavailable, minIndex: 100, maxIndex: 100 };
  }

  const series = normalized.map(({ candidate, points: rawPoints }) => {
    const baseNav = rawPoints[0].nav;
    const points = rawPoints.flatMap((point) => {
      const indexedValue = safeIndexedValue(point.nav, baseNav);
      return indexedValue === undefined ? [] : [{ ...point, indexedValue }];
    });
    return {
      key: candidate.key,
      name: candidate.name,
      isin: candidate.isin,
      schemeCode: candidate.schemeCode,
      category: candidate.category,
      active: candidate.active,
      closed: candidate.closed,
      baseNav,
      points,
      latestPoint: points.at(-1),
    };
  });
  const values = series
    .flatMap((item) => item.points.map((point) => point.indexedValue))
    .filter(Number.isFinite);
  const dates = [...new Set(series.flatMap((item) =>
    item.points.map((point) => point.date)))].sort();
  const baselineDate = series
    .map((item) => item.points[0]?.date)
    .filter((date): date is string => Boolean(date))
    .sort()[0];

  return {
    baselineDate,
    dates,
    series,
    unavailable,
    minIndex: values.length ? Math.min(...values) : 100,
    maxIndex: values.length ? Math.max(...values) : 100,
  };
}

/**
 * Restricts the comparison to exact published observations in the requested
 * window, then rebases each remaining series independently to ₹100 at its
 * first real observation in that window. Missing boundary dates are never
 * interpolated or forward-filled.
 */
export function rebaseFundComparisonModel(
  model: FundComparisonModel,
  visibleStart: string,
  visibleEnd: string,
): FundComparisonModel {
  if (
    !isCalendarDate(visibleStart)
    || !isCalendarDate(visibleEnd)
    || visibleStart > visibleEnd
  ) {
    return {
      dates: [],
      series: [],
      unavailable: model.unavailable,
      minIndex: 100,
      maxIndex: 100,
    };
  }

  const series = model.series.flatMap((source) => {
    const sourcePoints = source.points.filter((point) =>
      point.date >= visibleStart && point.date <= visibleEnd);
    if (!sourcePoints.length) return [];
    const baseNav = sourcePoints[0].nav;
    const points = sourcePoints.flatMap((point) => {
      const indexedValue = safeIndexedValue(point.nav, baseNav);
      return indexedValue === undefined ? [] : [{ ...point, indexedValue }];
    });
    if (!points.length) return [];
    return [{
      ...source,
      baseNav,
      points,
      latestPoint: points.at(-1),
    }];
  });
  const dates = [...new Set(series.flatMap((item) =>
    item.points.map((point) => point.date)))].sort();
  const values = series.flatMap((item) =>
    item.points.map((point) => point.indexedValue));

  return {
    baselineDate: dates[0],
    dates,
    series,
    unavailable: model.unavailable,
    minIndex: values.length ? Math.min(...values) : 100,
    maxIndex: values.length ? Math.max(...values) : 100,
  };
}

export function buildFundComparisonScale(
  model: FundComparisonModel,
): FundComparisonScale {
  const values = model.series
    .flatMap((series) => series.points.map((point) => point.indexedValue))
    .filter(Number.isFinite);
  const rawLow = Math.min(100, ...values);
  const rawHigh = Math.max(100, ...values);
  const padding = Math.max(2, (rawHigh - rawLow) * 0.12);
  const min = rawLow - padding;
  const max = rawHigh + padding;
  const step = (max - min) / 4;
  return {
    min,
    max,
    step,
    ticks: Array.from({ length: 5 }, (_, index) => min + step * index),
  };
}

/**
 * Returns top-to-bottom Y-axis ticks for the normalized comparison. Because
 * every series starts at ₹100, its indexed value maps directly to the same
 * signed percentage change from that baseline (for example, ₹150 is +50%).
 */
export function buildFundComparisonAxisTicks(
  scale: Pick<FundComparisonScale, "min" | "max">,
  divisions = 4,
): FundComparisonAxisTick[] {
  if (
    !Number.isFinite(scale.min)
    || !Number.isFinite(scale.max)
    || scale.max <= scale.min
    || !Number.isInteger(divisions)
    || divisions < 1
    || divisions > 20
  ) return [];
  const span = scale.max - scale.min;
  return Array.from({ length: divisions + 1 }, (_, index) => {
    const value = scale.max - span * index / divisions;
    return { value, percentageChange: value - 100 };
  });
}

/**
 * Keeps a custom horizontal window anchored to calendar dates when the set of
 * compared funds changes and therefore changes the union-date indices.
 */
export function preserveFundComparisonDateRange(
  previousDates: readonly string[],
  previousRange: readonly [number, number],
  nextDates: readonly string[],
): [number, number] {
  if (!nextDates.length) return [0, 0];
  if (nextDates.length === 1) return [0, 0];
  if (!previousDates.length) return [0, nextDates.length - 1];

  const previousLast = previousDates.length - 1;
  const previousStart = Math.max(0, Math.min(previousLast, Math.round(previousRange[0])));
  const previousEnd = Math.max(previousStart, Math.min(previousLast, Math.round(previousRange[1])));
  const startDate = previousDates[previousStart];
  const endDate = previousDates[previousEnd];
  if (!startDate || !endDate) return [0, nextDates.length - 1];

  const nextLast = nextDates.length - 1;
  const firstInside = nextDates.findIndex((date) => date >= startDate);
  const lastInside = nextDates.findLastIndex((date) => date <= endDate);
  let start = firstInside < 0 ? nextLast - 1 : Math.min(firstInside, nextLast - 1);
  let end = lastInside < 0 ? start + 1 : Math.max(start + 1, lastInside);
  if (end > nextLast) {
    end = nextLast;
    start = Math.min(start, end - 1);
  }
  return [Math.max(0, start), Math.max(1, end)];
}

export function fundComparisonTooltipAt(
  model: FundComparisonModel,
  date: string,
  focusedKey?: string,
): FundComparisonTooltipEntry[] {
  return model.series
    .filter((series) => !focusedKey || series.key === focusedKey)
    .map((series) => {
      const point = series.points.find((candidate) => candidate.date === date);
      return {
        key: series.key,
        name: series.name,
        date,
        available: Boolean(point),
        nav: point?.nav,
        indexedValue: point?.indexedValue,
      };
    });
}

export type FundComparisonPointsState = {
  all: boolean;
  keys: ReadonlySet<string>;
};

export type FundComparisonPointsScope = "off" | "all" | "custom";

export function initialFundComparisonPointsState(): FundComparisonPointsState {
  return { all: false, keys: new Set<string>() };
}

export function fundComparisonPointsScope(
  state: FundComparisonPointsState,
): FundComparisonPointsScope {
  if (state.all) return "all";
  return state.keys.size ? "custom" : "off";
}

export function fundComparisonPointsVisibleForFund(
  state: FundComparisonPointsState,
  key: string,
) {
  return state.all || state.keys.has(key);
}

export function toggleAllFundComparisonPoints(
  state: FundComparisonPointsState,
): FundComparisonPointsState {
  if (state.all) return { all: false, keys: new Set<string>() };
  return { all: true, keys: new Set<string>() };
}

export function toggleFundComparisonPointsForFund(
  state: FundComparisonPointsState,
  key: string,
  eligibleKeys: ReadonlySet<string>,
): FundComparisonPointsState {
  if (state.all) {
    const remaining = new Set<string>();
    eligibleKeys.forEach((candidate) => {
      if (candidate !== key) remaining.add(candidate);
    });
    return { all: false, keys: remaining };
  }
  const next = new Set(state.keys);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return { all: false, keys: next };
}

export function toggleFocusedFundComparisonPoints(
  state: FundComparisonPointsState,
  key: string,
): FundComparisonPointsState {
  const onlyThisFund = !state.all && state.keys.size === 1 && state.keys.has(key);
  if (onlyThisFund) {
    const next = new Set(state.keys);
    next.delete(key);
    return { all: false, keys: next };
  }
  return { all: false, keys: new Set([key]) };
}

export function collectFundComparisonInvestmentDates(
  candidates: FundComparisonCandidate[],
): Map<string, string[]> {
  const datesByKey = new Map<string, string[]>();
  candidates.forEach((candidate) => {
    const dates = [...new Set(
      candidate.transactions
        .filter((transaction) => transaction.amount > 0)
        .map((transaction) => transaction.date),
    )].sort();
    if (dates.length) datesByKey.set(candidate.key, dates);
  });
  return datesByKey;
}
