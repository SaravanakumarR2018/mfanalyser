export const MINIMUM_HISTORY_DATE = "2010-01-01";

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

export const historyRanges = (from: string, to: string) => {
  const ranges: Array<[string, string]> = [];
  let start = from < MINIMUM_HISTORY_DATE ? MINIMUM_HISTORY_DATE : from;
  while (start <= to) {
    const oneYearLater = addUtcYears(start, 1);
    const candidateEnd = addUtcDays(oneYearLater, -1);
    const end = candidateEnd < to ? candidateEnd : to;
    ranges.push([start, end]);
    start = addUtcDays(end, 1);
  }
  return ranges;
};
