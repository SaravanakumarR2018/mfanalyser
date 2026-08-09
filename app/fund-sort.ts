export type FundSortKey = "invested" | "value" | "gain" | "return";
export type FundSortDirection = "asc" | "desc";
export type FundSort = { key: FundSortKey; direction: FundSortDirection };

type SortableFund = {
  name: string;
  invested: number;
  currentValue: number;
};

export const DEFAULT_FUND_SORT: FundSort = { key: "value", direction: "desc" };

export function nextFundSort(current: FundSort, key: FundSortKey): FundSort {
  return {
    key,
    direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
  };
}

export function fundSortValue(fund: SortableFund, key: FundSortKey) {
  const gain = fund.currentValue - fund.invested;
  if (key === "invested") return fund.invested;
  if (key === "value") return fund.currentValue;
  if (key === "gain") return gain;
  return fund.invested ? gain / fund.invested * 100 : 0;
}

export function sortFunds<T extends SortableFund>(funds: readonly T[], sort: FundSort): T[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  return funds
    .map((fund, index) => ({ fund, index }))
    .sort((left, right) => {
      const difference = fundSortValue(left.fund, sort.key) - fundSortValue(right.fund, sort.key);
      if (difference !== 0) return difference * direction;
      const nameDifference = left.fund.name.localeCompare(right.fund.name);
      return nameDifference || left.index - right.index;
    })
    .map(({ fund }) => fund);
}
