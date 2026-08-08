import type {
  ClosedFund,
  FolioHolding,
  FundHolding,
  FundTransaction,
  HistoricalNavPoint,
  TimelinePoint,
} from "./cas-parser";

type TimelineHolding = {
  currentValue: number;
  invested: number;
  units: number;
  nav: number;
  navDate: string;
  liveNav?: boolean;
  navHistory?: HistoricalNavPoint[];
  transactions: FundTransaction[];
  folioHoldings?: FolioHolding[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizePublishedNav(points: HistoricalNavPoint[]) {
  const navByDate = new Map<string, HistoricalNavPoint>();
  for (const point of points) {
    if (!ISO_DATE.test(point.date) || !Number.isFinite(point.nav) || point.nav <= 0) continue;
    navByDate.set(point.date, point);
  }
  return [...navByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

const sortedTransactions = (transactions: FundTransaction[]) =>
  [...transactions]
    .filter((transaction) => ISO_DATE.test(transaction.date))
    .sort((left, right) => left.date.localeCompare(right.date));

const balanceAt = (transactions: FundTransaction[], date: string) => {
  let balance = 0;
  for (const transaction of transactions) {
    if (transaction.date > date) break;
    balance = transaction.balance;
  }
  return balance;
};

const approximatelyEqual = (left: number, right: number) =>
  Math.abs(left - right) <= Math.max(0.001, Math.abs(right) * 0.000001);

const groupTransactions = (transactions: FundTransaction[]) => {
  const grouped = new Map<string, FundTransaction[]>();
  for (const transaction of sortedTransactions(transactions)) {
    const key = transaction.holdingKey ?? "holding";
    grouped.set(key, [...(grouped.get(key) ?? []), transaction]);
  }
  return [...grouped.values()];
};

const balanceGroupsFor = (holding: Pick<TimelineHolding, "transactions" | "folioHoldings">) =>
  holding.folioHoldings?.length
    ? holding.folioHoldings.map((folio) => sortedTransactions(folio.transactions))
    : groupTransactions(holding.transactions);

const unitsForDate = (groups: FundTransaction[][], date: string) =>
  groups.reduce((total, transactions) => total + balanceAt(transactions, date), 0);

const canReconstructHolding = (holding: TimelineHolding) => {
  if (holding.folioHoldings?.length) {
    return holding.folioHoldings.every((folio) => {
      const transactions = sortedTransactions(folio.transactions);
      return transactions.length > 0
        && approximatelyEqual(transactions.at(-1)?.balance ?? 0, folio.units);
    });
  }
  const groups = groupTransactions(holding.transactions);
  if (!groups.length) return false;
  const closingUnits = groups.reduce(
    (total, transactions) => total + (transactions.at(-1)?.balance ?? 0),
    0,
  );
  return approximatelyEqual(closingUnits, holding.units);
};

const investedAt = (transactions: FundTransaction[], date: string) =>
  transactions.reduce(
    (total, transaction) => transaction.date <= date ? total + transaction.amount : total,
    0,
  );

const transactionSummary = (transactions: FundTransaction[], date: string) => {
  const sameDay = transactions.filter((transaction) => transaction.date === date);
  return {
    amount: sameDay.reduce((total, transaction) => total + transaction.amount, 0),
    count: sameDay.length,
    nav: sameDay.findLast((transaction) => transaction.price > 0)?.price,
  };
};

const mergePoint = (points: Map<string, TimelinePoint>, incoming: TimelinePoint) => {
  const existing = points.get(incoming.date);
  if (!existing) {
    points.set(incoming.date, incoming);
    return;
  }
  points.set(incoming.date, {
    ...existing,
    ...incoming,
    daily: Boolean(existing.daily || incoming.daily),
    transaction: Boolean(existing.transaction || incoming.transaction),
    exact: Boolean(existing.exact || incoming.exact),
    live: Boolean(existing.live || incoming.live),
    nav: incoming.nav ?? existing.nav,
    transactionAmount: incoming.transactionAmount ?? existing.transactionAmount,
    transactionCount: incoming.transactionCount ?? existing.transactionCount,
  });
};

export function buildHoldingTimeline(holding: TimelineHolding): TimelinePoint[] {
  const transactions = sortedTransactions(holding.transactions);
  const balanceGroups = balanceGroupsFor(holding);
  const transactionDates = [...new Set(transactions.map((transaction) => transaction.date))].sort();
  const points = new Map<string, TimelinePoint>();

  for (const date of transactionDates) {
    const summary = transactionSummary(transactions, date);
    const units = unitsForDate(balanceGroups, date);
    if (!summary.nav || units < -0.001) continue;
    mergePoint(points, {
      date,
      invested: Math.max(0, investedAt(transactions, date)),
      value: Math.max(0, units * summary.nav),
      nav: summary.nav,
      transaction: true,
      transactionAmount: summary.amount,
      transactionCount: summary.count,
    });
  }

  for (const observation of canReconstructHolding(holding) ? holding.navHistory ?? [] : []) {
    const units = unitsForDate(balanceGroups, observation.date);
    if (units <= 0 && !transactionDates.includes(observation.date)) continue;
    const summary = transactionSummary(transactions, observation.date);
    mergePoint(points, {
      date: observation.date,
      invested: Math.max(0, investedAt(transactions, observation.date)),
      value: Math.max(0, units * observation.nav),
      nav: observation.nav,
      daily: true,
      transaction: summary.count > 0,
      transactionAmount: summary.count ? summary.amount : undefined,
      transactionCount: summary.count || undefined,
    });
  }

  const endpointSummary = transactionSummary(transactions, holding.navDate);
  mergePoint(points, {
    date: holding.navDate,
    invested: holding.invested,
    value: holding.currentValue,
    nav: holding.nav,
    exact: !holding.liveNav,
    live: holding.liveNav,
    transaction: endpointSummary.count > 0,
    transactionAmount: endpointSummary.count ? endpointSummary.amount : undefined,
    transactionCount: endpointSummary.count || undefined,
    daily: (holding.navHistory ?? []).some((point) => point.date === holding.navDate),
  });

  const timeline = [...points.values()]
    .filter((point) => Number.isFinite(point.value) && Number.isFinite(point.invested))
    .sort((left, right) => left.date.localeCompare(right.date));
  if (timeline.length === 1) {
    const start = new Date(`${holding.navDate}T00:00:00Z`);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    timeline.unshift({ date: start.toISOString().slice(0, 10), invested: 0, value: 0 });
  }
  return timeline;
}

type PortfolioSeries = {
  navHistory?: HistoricalNavPoint[];
  transactions: FundTransaction[];
  folioHoldings?: FolioHolding[];
};

export function addDailyPortfolioPoints(
  baseTimeline: TimelinePoint[],
  funds: FundHolding[],
  closedFunds: ClosedFund[],
): TimelinePoint[] {
  if (funds.some((fund) => fund.units > 0 && !canReconstructHolding(fund))) {
    return baseTimeline;
  }
  const series: PortfolioSeries[] = [
    ...funds.map((fund) => ({
      navHistory: fund.navHistory,
      transactions: sortedTransactions(fund.transactions),
      folioHoldings: fund.folioHoldings,
    })),
    ...closedFunds.map((fund) => ({
      navHistory: fund.navHistory,
      transactions: sortedTransactions(fund.transactions),
    })),
  ];
  const allTransactions = sortedTransactions(series.flatMap((item) => item.transactions));
  const dates = new Set<string>();
  const seriesWithNav = series.map((item) => ({
    ...item,
    balanceGroups: balanceGroupsFor(item),
    navByDate: new Map((item.navHistory ?? []).map((observation) => [observation.date, observation.nav])),
  }));
  for (const item of series) {
    for (const observation of item.navHistory ?? []) dates.add(observation.date);
  }

  const points = new Map<string, TimelinePoint>();
  for (const base of baseTimeline) {
    const summary = transactionSummary(allTransactions, base.date);
    mergePoint(points, {
      ...base,
      transaction: Boolean(base.transaction || summary.count),
      transactionAmount: summary.count ? summary.amount : base.transactionAmount,
      transactionCount: summary.count || base.transactionCount,
    });
  }

  for (const date of [...dates].sort()) {
    let value = 0;
    let hasUnits = false;
    let complete = true;
    for (const item of seriesWithNav) {
      const observedNav = item.navByDate.get(date);
      const units = unitsForDate(item.balanceGroups, date);
      if (units <= 0) continue;
      hasUnits = true;
      if (!observedNav) {
        complete = false;
        break;
      }
      value += units * observedNav;
    }
    if (!hasUnits || !complete) continue;
    const summary = transactionSummary(allTransactions, date);
    const existing = points.get(date);
    mergePoint(points, {
      date,
      invested: existing?.exact || existing?.live
        ? existing.invested
        : Math.max(0, investedAt(allTransactions, date)),
      value: existing?.exact || existing?.live ? existing.value : Math.max(0, value),
      daily: true,
      transaction: summary.count > 0,
      transactionAmount: summary.count ? summary.amount : undefined,
      transactionCount: summary.count || undefined,
    });
  }

  return [...points.values()]
    .filter((point) => Number.isFinite(point.value) && Number.isFinite(point.invested))
    .sort((left, right) => left.date.localeCompare(right.date));
}
