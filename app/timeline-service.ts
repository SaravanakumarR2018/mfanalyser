import type {
  ClosedFund,
  FolioHolding,
  FundHolding,
  HistoricalNavPoint,
  TimelinePoint,
} from "./cas-parser";

type TimelineHolding = {
  currentValue: number;
  invested: number;
  units: number;
  navDate: string;
  liveNav?: boolean;
  transactions: FolioHolding["transactions"];
  folioHoldings?: FolioHolding[];
  weeklyNav?: HistoricalNavPoint[];
};

export const weekKey = (date: string) => {
  const value = new Date(`${date}T00:00:00Z`);
  const mondayOffset = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - mondayOffset);
  return value.toISOString().slice(0, 10);
};

export function sampleWeeklyNav(points: HistoricalNavPoint[]) {
  const latestByWeek = new Map<string, HistoricalNavPoint>();
  for (const point of [...points].sort((a, b) => a.date.localeCompare(b.date))) {
    latestByWeek.set(weekKey(point.date), point);
  }
  return [...latestByWeek.values()];
}

const balanceAt = (transactions: FolioHolding["transactions"], date: string) => {
  let balance = 0;
  for (const transaction of transactions) {
    if (transaction.date > date) break;
    balance = transaction.balance;
  }
  return balance;
};

const investedAt = (transactions: FolioHolding["transactions"], date: string) =>
  transactions.reduce(
    (total, transaction) => transaction.date <= date ? total + transaction.amount : total,
    0,
  );

const unitsAt = (holding: TimelineHolding, date: string) => {
  if (holding.folioHoldings?.length) {
    return holding.folioHoldings.reduce(
      (total, folio) => total + balanceAt(folio.transactions, date),
      0,
    );
  }
  return balanceAt(holding.transactions, date);
};

const mergePoint = (points: Map<string, TimelinePoint>, point: TimelinePoint, preferPoint = false) => {
  const existing = points.get(point.date);
  if (!existing) {
    points.set(point.date, point);
    return;
  }
  points.set(point.date, {
    ...(preferPoint ? existing : point),
    ...(preferPoint ? point : existing),
    weekly: Boolean(existing.weekly || point.weekly),
    transaction: Boolean(existing.transaction || point.transaction),
    exact: Boolean(existing.exact || point.exact),
    live: Boolean(existing.live || point.live),
  });
};

export function buildHoldingTimeline(holding: TimelineHolding): TimelinePoint[] {
  const transactions = [...holding.transactions]
    .filter((transaction) => transaction.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const transactionDates = new Set(transactions.map((transaction) => transaction.date));
  const points = new Map<string, TimelinePoint>();

  for (const date of [...transactionDates].sort()) {
    const sameDay = transactions.filter((transaction) => transaction.date === date);
    const transactionNav = sameDay.at(-1)?.price ?? 0;
    mergePoint(points, {
      date,
      invested: Math.max(0, investedAt(transactions, date)),
      value: Math.max(0, unitsAt(holding, date) * transactionNav),
      transaction: true,
    });
  }

  for (const observation of holding.weeklyNav ?? []) {
    const units = unitsAt(holding, observation.date);
    if (units <= 0 && !transactionDates.has(observation.date)) continue;
    mergePoint(points, {
      date: observation.date,
      invested: Math.max(0, investedAt(transactions, observation.date)),
      value: Math.max(0, units * observation.nav),
      weekly: true,
      transaction: transactionDates.has(observation.date),
    }, true);
  }

  mergePoint(points, {
    date: holding.navDate,
    invested: holding.invested,
    value: holding.currentValue,
    exact: !holding.liveNav,
    live: holding.liveNav,
    transaction: transactionDates.has(holding.navDate),
    weekly: (holding.weeklyNav ?? []).some((point) => point.date === holding.navDate),
  }, true);

  const timeline = [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (timeline.length === 1) {
    const start = new Date(`${holding.navDate}T00:00:00Z`);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    timeline.unshift({ date: start.toISOString().slice(0, 10), invested: 0, value: 0 });
  }
  return timeline;
}

type ValuedSeries = {
  weeklyNav?: HistoricalNavPoint[];
  transactions: FolioHolding["transactions"];
  folioHoldings?: FolioHolding[];
};

const seriesUnitsAt = (series: ValuedSeries, date: string) => {
  if (series.folioHoldings?.length) {
    return series.folioHoldings.reduce(
      (total, folio) => total + balanceAt(folio.transactions, date),
      0,
    );
  }
  const grouped = new Map<string, FolioHolding["transactions"]>();
  for (const transaction of series.transactions) {
    const key = transaction.holdingKey ?? "holding";
    grouped.set(key, [...(grouped.get(key) ?? []), transaction]);
  }
  if (grouped.size > 1) {
    return [...grouped.values()].reduce(
      (total, transactions) => total + balanceAt(transactions, date),
      0,
    );
  }
  return balanceAt(series.transactions, date);
};

const navForWeek = (series: ValuedSeries, week: string, date: string) => {
  const sameWeek = series.weeklyNav?.find((point) => weekKey(point.date) === week);
  if (sameWeek) return sameWeek.nav;
  let latest: HistoricalNavPoint | undefined;
  for (const point of series.weeklyNav ?? []) {
    if (point.date > date) break;
    latest = point;
  }
  return latest?.nav;
};

export function addWeeklyPortfolioPoints(
  baseTimeline: TimelinePoint[],
  funds: FundHolding[],
  closedFunds: ClosedFund[],
): TimelinePoint[] {
  const series: ValuedSeries[] = [
    ...funds.map((fund) => ({
      weeklyNav: fund.weeklyNav,
      transactions: [...fund.transactions].sort((a, b) => a.date.localeCompare(b.date)),
      folioHoldings: fund.folioHoldings.map((folio) => ({
        ...folio,
        transactions: [...folio.transactions].sort((a, b) => a.date.localeCompare(b.date)),
      })),
    })),
    ...closedFunds.map((fund) => ({
      weeklyNav: fund.weeklyNav,
      transactions: [...fund.transactions].sort((a, b) => a.date.localeCompare(b.date)),
    })),
  ];
  const allTransactions = series
    .flatMap((item) => item.transactions)
    .sort((a, b) => a.date.localeCompare(b.date));
  const transactionDates = new Set(allTransactions.map((transaction) => transaction.date));
  const weekDates = new Map<string, string>();
  for (const item of series) {
    for (const observation of item.weeklyNav ?? []) {
      const week = weekKey(observation.date);
      const existing = weekDates.get(week);
      if (!existing || observation.date > existing) weekDates.set(week, observation.date);
    }
  }

  const points = new Map<string, TimelinePoint>();
  for (const base of baseTimeline) {
    mergePoint(points, {
      ...base,
      transaction: Boolean(base.transaction || transactionDates.has(base.date)),
    }, true);
  }

  for (const [week, date] of [...weekDates].sort((a, b) => a[1].localeCompare(b[1]))) {
    let value = 0;
    let hasValue = false;
    let complete = true;
    for (const item of series) {
      const units = seriesUnitsAt(item, date);
      const nav = navForWeek(item, week, date);
      if (units > 0 && nav) {
        value += units * nav;
        hasValue = true;
      } else if (units > 0) {
        complete = false;
      }
    }
    if (!hasValue || !complete) continue;
    const invested = allTransactions.reduce(
      (total, transaction) => transaction.date <= date ? total + transaction.amount : total,
      0,
    );
    const existing = points.get(date);
    mergePoint(points, {
      date,
      invested: Math.max(0, invested),
      value: Math.max(0, value),
      weekly: true,
      transaction: transactionDates.has(date),
    }, !existing?.exact && !existing?.live);
  }

  return [...points.values()]
    .filter((point) => Number.isFinite(point.value) && Number.isFinite(point.invested))
    .sort((a, b) => a.date.localeCompare(b.date));
}
