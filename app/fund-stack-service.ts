import type { ClosedFund, FundHolding, FundTransaction, HistoricalNavPoint, Portfolio } from "./cas-parser";

export type FundStackMode = "value" | "invested" | "contribution" | "periodChange";

export type FundStackFund = {
  key: string;
  name: string;
  category: string;
  closed: boolean;
  transactions: FundTransaction[];
};

export type FundStackValue = {
  fundKey: string;
  value: number;
  invested: number;
  contribution: number;
  periodStartValue?: number;
  periodChange?: number;
  periodCashFlow?: number;
};

export type FundStackPoint = {
  date: string;
  funds: FundStackValue[];
  totalValue: number;
  totalInvested: number;
  totalContribution: number;
  periodStartDate?: string;
  periodStartValue?: number;
  totalPeriodChange?: number;
  totalPeriodCashFlow?: number;
  latest?: boolean;
};

export type FundStackModel = {
  funds: FundStackFund[];
  points: FundStackPoint[];
};

export type PeriodCashFlowStep = {
  date: string;
  amount: number;
  total: number;
};

const STACK_MODE_ORDER: FundStackMode[] = ["value", "invested", "contribution", "periodChange"];

const isoDateTime = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = new Date(`${date}T00:00:00Z`).getTime();
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) return null;
  return time;
};

export function toggleStackModeSelection(selected: FundStackMode[], mode: FundStackMode) {
  if (selected.includes(mode)) {
    return selected.length === 1 ? selected : selected.filter((item) => item !== mode);
  }
  return STACK_MODE_ORDER.filter((item) => item === mode || selected.includes(item));
}

export function annualizedReturnAt(
  transactions: FundTransaction[],
  date: string,
  terminalValue: number,
): number | null {
  const terminalTime = isoDateTime(date);
  if (terminalTime === null) return null;

  const grouped = new Map<number, number>();
  for (const transaction of transactions) {
    if (transaction.date > date || !Number.isFinite(transaction.amount)) continue;
    const time = isoDateTime(transaction.date);
    if (time === null) continue;
    grouped.set(time, (grouped.get(time) ?? 0) - transaction.amount);
  }
  if (Number.isFinite(terminalValue) && Math.abs(terminalValue) > 0.000001) {
    grouped.set(terminalTime, (grouped.get(terminalTime) ?? 0) + terminalValue);
  }

  const flows = [...grouped]
    .map(([time, amount]) => ({ time, amount }))
    .filter((flow) => Math.abs(flow.amount) > 0.000001)
    .sort((left, right) => left.time - right.time);
  if (flows.length < 2 || flows[0].time === flows.at(-1)?.time) return null;
  if (!flows.some((flow) => flow.amount < 0) || !flows.some((flow) => flow.amount > 0)) return null;

  const origin = flows[0].time;
  const npv = (rate: number) => flows.reduce((total, flow) =>
    total + flow.amount / ((1 + rate) ** ((flow.time - origin) / 86_400_000 / 365)), 0);

  let low = -0.999999;
  let high = 1;
  let lowValue = npv(low);
  let highValue = npv(high);
  while (Number.isFinite(highValue) && Math.sign(lowValue) === Math.sign(highValue) && high < 1_000_000) {
    high = high * 2 + 1;
    highValue = npv(high);
  }
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || Math.sign(lowValue) === Math.sign(highValue)) {
    return null;
  }

  for (let iteration = 0; iteration < 160; iteration += 1) {
    const middle = (low + high) / 2;
    const middleValue = npv(middle);
    if (!Number.isFinite(middleValue)) return null;
    if (Math.abs(middleValue) < 0.000001) return middle * 100;
    if (Math.sign(middleValue) === Math.sign(lowValue)) {
      low = middle;
      lowValue = middleValue;
    } else {
      high = middle;
      highValue = middleValue;
    }
  }
  const result = (low + high) / 2 * 100;
  return Number.isFinite(result) ? result : null;
}

export function portfolioAnnualizedReturn(portfolio: {
  valuationDate: string;
  currentValue: number;
  timeline: Array<{ date: string; transactionAmount?: number }>;
  funds: Array<{
    currentValue: number;
    units: number;
    transactions: FundTransaction[];
    folioHoldings?: Array<{
      currentValue: number;
      units: number;
      transactions: FundTransaction[];
    }>;
  }>;
}) {
  const activeSeries = portfolio.funds.flatMap((fund) =>
    fund.folioHoldings?.length ? fund.folioHoldings : [fund]);
  const incomplete = activeSeries.some((holding) =>
    (holding.currentValue > 0.005 || holding.units > 0.000001)
    && !holding.transactions.some((transaction) =>
      isoDateTime(transaction.date) !== null
      && Number.isFinite(transaction.amount)
      && Math.abs(transaction.amount) > 0.000001));
  if (incomplete) return null;

  const transactions = portfolio.timeline
    .filter((point) => Number.isFinite(point.transactionAmount))
    .map<FundTransaction>((point) => ({
      date: point.date,
      amount: point.transactionAmount as number,
      price: 0,
      units: 0,
      balance: 0,
      label: "Portfolio cash flow",
    }));
  return annualizedReturnAt(transactions, portfolio.valuationDate, portfolio.currentValue);
}

export function portfolioAbsoluteReturn(invested: number, wealthCreated: number) {
  if (!Number.isFinite(invested) || invested <= 0 || !Number.isFinite(wealthCreated)) return null;
  const result = wealthCreated / invested * 100;
  return Number.isFinite(result) ? result : null;
}

const approximatelyEqual = (left: number, right: number) =>
  Math.abs(left - right) <= Math.max(0.001, Math.abs(right) * 0.000001);

const groupTransactions = (transactions: FundTransaction[]) => {
  const grouped = new Map<string, FundTransaction[]>();
  for (const transaction of [...transactions].sort((left, right) => left.date.localeCompare(right.date))) {
    const key = transaction.holdingKey ?? "holding";
    grouped.set(key, [...(grouped.get(key) ?? []), transaction]);
  }
  return [...grouped.values()];
};

const balanceAt = (transactions: FundTransaction[], date: string) => {
  let balance = 0;
  for (const transaction of transactions) {
    if (transaction.date > date) break;
    balance = transaction.balance;
  }
  return balance;
};

const investedAt = (transactions: FundTransaction[], date: string) =>
  transactions.reduce(
    (total, transaction) => transaction.date <= date ? total + transaction.amount : total,
    0,
  );

type PreparedFund = {
  key: string;
  currentValue: number;
  currentInvested: number;
  navHistory?: HistoricalNavPoint[];
  groups: FundTransaction[][];
  transactions: FundTransaction[];
  navByDate: Map<string, number>;
  transactionNavByDate: Map<string, number>;
  reconstructable: boolean;
};

const prepareFund = (fund: FundHolding): PreparedFund => {
  const transactions = [...fund.transactions].sort((left, right) => left.date.localeCompare(right.date));
  const groups = groupTransactions(transactions);
  const closingUnits = groups.reduce(
    (total, group) => total + (group.at(-1)?.balance ?? 0),
    0,
  );
  const transactionNavByDate = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.price > 0) transactionNavByDate.set(transaction.date, transaction.price);
  }
  return {
    key: fund.key,
    currentValue: fund.currentValue,
    currentInvested: fund.invested,
    navHistory: fund.navHistory,
    groups,
    transactions,
    navByDate: new Map((fund.navHistory ?? []).map((point) => [point.date, point.nav])),
    transactionNavByDate,
    reconstructable: groups.length > 0 && approximatelyEqual(closingUnits, fund.units),
  };
};

const prepareClosedFund = (fund: ClosedFund): PreparedFund => {
  const transactions = [...fund.transactions].sort((left, right) => left.date.localeCompare(right.date));
  const groups = groupTransactions(transactions);
  const closingUnits = groups.reduce(
    (total, group) => total + (group.at(-1)?.balance ?? 0),
    0,
  );
  const transactionNavByDate = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.price > 0) transactionNavByDate.set(transaction.date, transaction.price);
  }
  const currentInvested = transactions.reduce((total, transaction) => total + transaction.amount, 0);
  return {
    key: fund.key,
    currentValue: 0,
    currentInvested,
    navHistory: fund.navHistory,
    groups,
    transactions,
    navByDate: new Map((fund.navHistory ?? []).map((point) => [point.date, point.nav])),
    transactionNavByDate,
    reconstructable: groups.length > 0 && approximatelyEqual(closingUnits, 0),
  };
};

const snapshotAt = (
  prepared: PreparedFund,
  date: string,
  valuationDate: string,
): FundStackValue | null => {
  const { groups, transactions } = prepared;
  if (date === valuationDate) {
    return {
      fundKey: prepared.key,
      value: prepared.currentValue,
      invested: prepared.currentInvested,
      contribution: prepared.currentValue - prepared.currentInvested,
    };
  }
  if (!prepared.reconstructable) return null;

  const units = groups.reduce((total, group) => total + balanceAt(group, date), 0);
  const invested = investedAt(transactions, date);
  if (units <= 0.001) {
    return { fundKey: prepared.key, value: 0, invested, contribution: -invested };
  }
  const nav = prepared.navByDate.get(date) ?? prepared.transactionNavByDate.get(date);
  if (!nav || !Number.isFinite(nav)) return null;
  const value = Math.max(0, units * nav);
  return { fundKey: prepared.key, value, invested, contribution: value - invested };
};

const totalPoint = (date: string, funds: FundStackValue[], latest = false): FundStackPoint => {
  const totalValue = funds.reduce((total, fund) => total + fund.value, 0);
  const totalInvested = funds.reduce((total, fund) => total + fund.invested, 0);
  return {
    date,
    funds,
    totalValue,
    totalInvested,
    totalContribution: funds.reduce((total, fund) => total + fund.contribution, 0),
    latest,
  };
};

const buildDemoPoints = (portfolio: Portfolio) => {
  const totalCurrentValue = portfolio.funds.reduce((total, fund) => total + fund.currentValue, 0);
  const totalCurrentInvested = portfolio.funds.reduce((total, fund) => total + fund.invested, 0);
  return portfolio.timeline.map((point) => totalPoint(
    point.date,
    [
      ...portfolio.funds.map((fund) => {
      const value = totalCurrentValue ? point.value * fund.currentValue / totalCurrentValue : 0;
      const invested = totalCurrentInvested ? point.invested * fund.invested / totalCurrentInvested : 0;
      return { fundKey: fund.key, value, invested, contribution: value - invested };
      }),
      ...portfolio.closedFunds.map((fund) => {
        const realized = point.date >= fund.closedDate ? fund.realizedGain : 0;
        return { fundKey: fund.key, value: 0, invested: -realized, contribution: realized };
      }),
    ],
    point.date === portfolio.valuationDate,
  ));
};

export function buildFundStackModel(portfolio: Portfolio): FundStackModel {
  const funds = [
    ...portfolio.funds.map(({ key, name, category, transactions }) => ({ key, name, category, closed: false, transactions })),
    ...portfolio.closedFunds.map(({ key, name, category, transactions }) => ({ key, name, category, closed: true, transactions })),
  ];
  if (!funds.length) return { funds, points: [] };
  if (portfolio.source === "demo") return { funds, points: buildDemoPoints(portfolio) };

  const prepared = [
    ...portfolio.funds.map(prepareFund),
    ...portfolio.closedFunds.map(prepareClosedFund),
  ];
  const dates = new Set<string>([portfolio.valuationDate]);
  for (const item of prepared) {
    for (const point of item.navHistory ?? []) dates.add(point.date);
    for (const transaction of item.transactions) dates.add(transaction.date);
  }

  const points: FundStackPoint[] = [];
  for (const date of [...dates].sort()) {
    const snapshots = prepared.map((fund) => snapshotAt(fund, date, portfolio.valuationDate));
    if (snapshots.some((snapshot) => !snapshot)) continue;
    points.push(totalPoint(
      date,
      snapshots as FundStackValue[],
      date === portfolio.valuationDate,
    ));
  }

  return { funds, points };
}

export function rebaseFundStackToPeriodStart(
  points: FundStackPoint[],
  fundDefinitions: FundStackFund[] = [],
): FundStackPoint[] {
  const periodStart = points[0];
  if (!periodStart) return [];
  const startValues = new Map(periodStart.funds.map((fund) => [fund.fundKey, fund.value]));
  const cashFlowByFundAndDate = new Map<string, Map<string, number>>();
  for (const fund of fundDefinitions) {
    const transactions = fund.transactions
      .filter((transaction) =>
        transaction.date > periodStart.date
        && isoDateTime(transaction.date) !== null
        && Number.isFinite(transaction.amount))
      .sort((left, right) => left.date.localeCompare(right.date));
    let transactionIndex = 0;
    let total = 0;
    const byDate = new Map<string, number>();
    for (const point of points) {
      while (transactionIndex < transactions.length && transactions[transactionIndex].date <= point.date) {
        total += transactions[transactionIndex].amount;
        transactionIndex += 1;
      }
      byDate.set(point.date, total);
    }
    cashFlowByFundAndDate.set(fund.key, byDate);
  }

  return points.map((point) => {
    const funds = point.funds.map((fund) => {
      const periodStartValue = startValues.get(fund.fundKey) ?? 0;
      const periodCashFlow = cashFlowByFundAndDate.get(fund.fundKey)?.get(point.date) ?? 0;
      return {
        ...fund,
        periodStartValue,
        periodChange: fund.value - periodStartValue,
        periodCashFlow,
      };
    });
    return {
      ...point,
      funds,
      periodStartDate: periodStart.date,
      periodStartValue: periodStart.totalValue,
      totalPeriodChange: funds.reduce((total, fund) => total + (fund.periodChange ?? 0), 0),
      totalPeriodCashFlow: funds.reduce((total, fund) => total + (fund.periodCashFlow ?? 0), 0),
    };
  });
}

export function buildPeriodCashFlowSteps(
  funds: FundStackFund[],
  periodStartDate: string,
  periodEndDate: string,
): PeriodCashFlowStep[] {
  const grouped = new Map<string, number>();
  for (const fund of funds) {
    for (const transaction of fund.transactions) {
      if (
        transaction.date <= periodStartDate
        || transaction.date > periodEndDate
        || isoDateTime(transaction.date) === null
        || !Number.isFinite(transaction.amount)
      ) continue;
      grouped.set(transaction.date, (grouped.get(transaction.date) ?? 0) + transaction.amount);
    }
  }

  let total = 0;
  return [...grouped]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, amount]) => {
      total += amount;
      return { date, amount, total };
    });
}

export const stackMetric = (point: FundStackValue, mode: FundStackMode) => {
  if (mode === "periodChange") return point.periodChange ?? 0;
  return point[mode];
};

export type FundStackBound = { lower: number; upper: number };
export type FundStackScale = { min: number; max: number; step: number; ticks: number[] };

const niceStackStep = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const fraction = value / magnitude;
  return (fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10) * magnitude;
};

export function stackBoundsForPoint(point: FundStackPoint, mode: FundStackMode): FundStackBound[] {
  let positive = 0;
  let negative = 0;
  return point.funds.map((fund) => {
    const amount = stackMetric(fund, mode);
    if (amount >= 0) {
      const lower = positive;
      positive += amount;
      return { lower, upper: positive };
    }
    const upper = negative;
    negative += amount;
    return { lower: negative, upper };
  });
}

export function buildSharedFundStackScale(
  points: FundStackPoint[],
  modes: FundStackMode[],
): FundStackScale {
  let highest = 0;
  let lowest = 0;
  for (const mode of modes) {
    for (const point of points) {
      for (const bound of stackBoundsForPoint(point, mode)) {
        highest = Math.max(highest, bound.upper);
        lowest = Math.min(lowest, bound.lower);
      }
      if (mode === "periodChange" && Number.isFinite(point.totalPeriodCashFlow)) {
        highest = Math.max(highest, point.totalPeriodCashFlow ?? 0);
        lowest = Math.min(lowest, point.totalPeriodCashFlow ?? 0);
      }
    }
  }
  const observedSpan = Math.max(1, highest - lowest);
  const paddedMin = lowest < 0 ? lowest - observedSpan * 0.06 : 0;
  const paddedMax = highest + observedSpan * 0.06;
  const step = niceStackStep(Math.max(1, paddedMax - paddedMin) / 5);
  const min = lowest < 0 ? Math.floor(paddedMin / step) * step : 0;
  const max = Math.max(step, Math.ceil(paddedMax / step) * step);
  const ticks: number[] = [];
  for (let value = min; value <= max + step / 2 && ticks.length < 20; value += step) ticks.push(value);
  return { min, max, step, ticks };
}

export function findStackFundIndex(point: FundStackPoint, mode: FundStackMode, value: number) {
  return findStackFundIndexFromBounds(stackBoundsForPoint(point, mode), value);
}

export function findStackFundIndexFromBounds(bounds: FundStackBound[], value: number) {
  return bounds.findIndex((bound) =>
    bound.upper - bound.lower > 0.000001
      && value >= bound.lower
      && value <= bound.upper);
}

export function fundValueShare(point: FundStackPoint, fundIndex: number) {
  if (!point.totalValue || !point.funds[fundIndex]) return 0;
  return point.funds[fundIndex].value / point.totalValue * 100;
}

export function maxStackReconciliationDifference(model: FundStackModel) {
  return model.points.reduce((largest, point) => {
    const valueDifference = Math.abs(
      point.totalValue - point.funds.reduce((total, fund) => total + fund.value, 0),
    );
    const investedDifference = Math.abs(
      point.totalInvested - point.funds.reduce((total, fund) => total + fund.invested, 0),
    );
    const contributionDifference = Math.abs(
      point.totalContribution - point.funds.reduce((total, fund) => total + fund.contribution, 0),
    );
    const periodChangeDifference = point.totalPeriodChange === undefined
      ? 0
      : Math.abs(
        point.totalPeriodChange
        - point.funds.reduce((total, fund) => total + (fund.periodChange ?? 0), 0),
      );
    const periodPortfolioDifference = point.totalPeriodChange === undefined || point.periodStartValue === undefined
      ? 0
      : Math.abs(point.totalPeriodChange - (point.totalValue - point.periodStartValue));
    const periodCashFlowDifference = point.totalPeriodCashFlow === undefined
      ? 0
      : Math.abs(
        point.totalPeriodCashFlow
        - point.funds.reduce((total, fund) => total + (fund.periodCashFlow ?? 0), 0),
      );
    return Math.max(
      largest,
      valueDifference,
      investedDifference,
      contributionDifference,
      periodChangeDifference,
      periodPortfolioDifference,
      periodCashFlowDifference,
    );
  }, 0);
}
