export const MINIMUM_HISTORY_DATE = "2010-01-01";
export const FULL_HISTORY_START_DATE = "1900-01-01";

export const historyRange = (from: string, to: string): [string, string] => [
  from < MINIMUM_HISTORY_DATE ? MINIMUM_HISTORY_DATE : from,
  to,
];

export const fullHistoryRange = (to: string): [string, string] => [
  FULL_HISTORY_START_DATE,
  to,
];

export const mirrorDateToIso = (value: string) => {
  const match = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
};
