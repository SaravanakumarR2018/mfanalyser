export const INDIA_INFLATION_INDICATOR = "FP.CPI.TOTL.ZG";
export const INDIA_INFLATION_START_YEAR = 1990;
export const INDIA_INFLATION_POINT_LIMIT = 30;

export type IndiaInflationPoint = {
  year: number;
  value: number;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null
);

export const buildIndiaInflationUrl = (currentYear = new Date().getUTCFullYear()) => {
  if (!Number.isInteger(currentYear) || currentYear < INDIA_INFLATION_START_YEAR || currentYear > 2100) {
    throw new Error("A valid current year is required for the inflation request.");
  }
  const query = new URLSearchParams({
    format: "json",
    date: `${INDIA_INFLATION_START_YEAR}:${currentYear}`,
    per_page: "100",
  });
  return `https://api.worldbank.org/v2/country/IND/indicator/${INDIA_INFLATION_INDICATOR}?${query}`;
};

export const parseIndiaInflationResponse = (payload: unknown): IndiaInflationPoint[] => {
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) {
    throw new Error("The inflation data service returned an unexpected response.");
  }

  const observations = new Map<number, number>();
  for (const row of payload[1]) {
    if (!isRecord(row) || row.countryiso3code !== "IND" || !isRecord(row.indicator)) continue;
    if (row.indicator.id !== INDIA_INFLATION_INDICATOR || typeof row.date !== "string") continue;
    const year = Number(row.date);
    const value = row.value;
    if (!Number.isInteger(year) || year < INDIA_INFLATION_START_YEAR || year > 2100) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < -100 || value > 100) continue;
    observations.set(year, value);
  }

  const points = [...observations]
    .sort(([left], [right]) => left - right)
    .map(([year, value]) => ({ year, value }))
    .slice(-INDIA_INFLATION_POINT_LIMIT);
  if (points.length < 2) throw new Error("India inflation history is currently unavailable.");
  return points;
};

export const loadIndiaInflation = async ({
  signal,
  currentYear,
  fetcher = fetch,
}: {
  signal?: AbortSignal;
  currentYear?: number;
  fetcher?: FetchLike;
} = {}) => {
  const response = await fetcher(buildIndiaInflationUrl(currentYear), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("India inflation history could not be loaded.");
  return parseIndiaInflationResponse(await response.json());
};
