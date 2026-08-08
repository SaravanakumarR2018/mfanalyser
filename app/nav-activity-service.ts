import type { FundTransaction, HistoricalNavPoint } from "./cas-parser";

export type NavActivityPoint = {
  date: string;
  nav: number;
  investedAmount: number;
  investmentCount: number;
  transactionAmount: number;
  transactionCount: number;
  transaction?: boolean;
  daily?: boolean;
  latest?: boolean;
  publishedNav?: number;
  transactionNav?: number;
};

export function buildNavPoints(
  transactions: FundTransaction[],
  navHistory: HistoricalNavPoint[] | undefined,
  nav: number,
  navDate: string,
): NavActivityPoint[] {
  const byDate = new Map<string, NavActivityPoint>();
  for (const observation of navHistory ?? []) {
    if (!observation.date || !Number.isFinite(observation.nav) || observation.nav <= 0) continue;
    byDate.set(observation.date, {
      date: observation.date,
      nav: observation.nav,
      investedAmount: 0,
      investmentCount: 0,
      transactionAmount: 0,
      transactionCount: 0,
      daily: true,
      publishedNav: observation.nav,
    });
  }
  for (const transaction of [...transactions].sort((left, right) => left.date.localeCompare(right.date))) {
    if (!transaction.date || transaction.price <= 0) continue;
    const existing = byDate.get(transaction.date);
    const purchase = transaction.amount > 0 && transaction.units > 0 ? transaction.amount : 0;
    byDate.set(transaction.date, {
      date: transaction.date,
      nav: existing?.publishedNav ?? transaction.price,
      investedAmount: (existing?.investedAmount ?? 0) + purchase,
      investmentCount: (existing?.investmentCount ?? 0) + (purchase > 0 ? 1 : 0),
      transactionAmount: (existing?.transactionAmount ?? 0) + transaction.amount,
      transactionCount: (existing?.transactionCount ?? 0) + 1,
      transaction: true,
      daily: existing?.daily,
      publishedNav: existing?.publishedNav,
      transactionNav: transaction.price,
      latest: existing?.latest,
    });
  }

  if (navDate && nav > 0) {
    const existing = byDate.get(navDate);
    byDate.set(navDate, {
      date: navDate,
      nav,
      investedAmount: existing?.investedAmount ?? 0,
      investmentCount: existing?.investmentCount ?? 0,
      transactionAmount: existing?.transactionAmount ?? 0,
      transactionCount: existing?.transactionCount ?? 0,
      transaction: existing?.transaction,
      daily: existing?.daily,
      publishedNav: existing?.publishedNav,
      transactionNav: existing?.transactionNav,
      latest: true,
    });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}
