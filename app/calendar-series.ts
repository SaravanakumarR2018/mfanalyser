const DAY_MS = 24 * 60 * 60 * 1000;

export type CalendarCarry = {
  carried?: boolean;
  carriedFrom?: string;
};

const dateTime = (date: string) => {
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date
    ? time
    : null;
};

/**
 * Adds display-only calendar dates between observations. The source series is
 * never changed: each inserted point is an explicit carry of the last complete
 * observation, not a published NAV or a newly calculated valuation.
 */
export function fillCalendarDays<T extends { date: string }>(points: readonly T[]): Array<T & CalendarCarry> {
  if (points.length < 2) return points.map((point) => ({ ...point }));

  const result: Array<T & CalendarCarry> = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    result.push({ ...point });
    const next = points[index + 1];
    if (!next) continue;
    const start = dateTime(point.date);
    const end = dateTime(next.date);
    if (start === null || end === null || end <= start) continue;
    for (let time = start + DAY_MS; time < end; time += DAY_MS) {
      result.push({
        ...point,
        date: new Date(time).toISOString().slice(0, 10),
        daily: undefined,
        exact: undefined,
        live: undefined,
        latest: undefined,
        transaction: undefined,
        transactionAmount: undefined,
        transactionCount: undefined,
        investedAmount: 0,
        investmentCount: 0,
        carried: true,
        carriedFrom: point.date,
      } as T & CalendarCarry);
    }
  }
  return result;
}
