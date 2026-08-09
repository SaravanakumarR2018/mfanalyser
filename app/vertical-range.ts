import type { FundStackScale } from "./fund-stack-service";
import type { IndexRange } from "./range-window";

export const VERTICAL_RANGE_MAX = 1_000;
export const MIN_VERTICAL_RANGE = 25;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export function resizeVerticalRange(
  range: IndexRange,
  edge: "lower" | "upper",
  value: number,
): IndexRange {
  const next = clamp(Math.round(value), 0, VERTICAL_RANGE_MAX);
  if (edge === "lower") return [Math.min(next, range[1] - MIN_VERTICAL_RANGE), range[1]];
  return [range[0], Math.max(next, range[0] + MIN_VERTICAL_RANGE)];
}

export function shiftVerticalRangeWindow(range: IndexRange, delta: number): IndexRange {
  const start = clamp(Math.round(range[0]), 0, VERTICAL_RANGE_MAX);
  const end = clamp(Math.max(start, Math.round(range[1])), start, VERTICAL_RANGE_MAX);
  const width = end - start;
  if (width >= VERTICAL_RANGE_MAX) return [0, VERTICAL_RANGE_MAX];
  const movement = Number.isFinite(delta) ? Math.round(delta) : 0;
  const nextStart = clamp(start + movement, 0, VERTICAL_RANGE_MAX - width);
  return [nextStart, nextStart + width];
}

const niceStep = (roughStep: number) => {
  const safe = Math.max(Number.EPSILON, Math.abs(roughStep));
  const magnitude = 10 ** Math.floor(Math.log10(safe));
  const residual = safe / magnitude;
  if (residual >= 5) return 5 * magnitude;
  if (residual >= 2) return 2 * magnitude;
  return magnitude;
};

export function scaleForVerticalRange(
  baseScale: FundStackScale,
  range: IndexRange,
): FundStackScale {
  const lower = clamp(Math.min(range[0], range[1]), 0, VERTICAL_RANGE_MAX - 1);
  const upper = clamp(Math.max(range[0], range[1]), lower + 1, VERTICAL_RANGE_MAX);
  if (lower === 0 && upper === VERTICAL_RANGE_MAX) return baseScale;
  const baseSpan = Math.max(1, baseScale.max - baseScale.min);
  const min = baseScale.min + baseSpan * lower / VERTICAL_RANGE_MAX;
  const max = baseScale.min + baseSpan * upper / VERTICAL_RANGE_MAX;
  const step = niceStep(Math.max(1, max - min) / 5);
  const ticks: number[] = [];
  const firstTick = Math.ceil((min - step * 0.000001) / step) * step;
  for (let value = firstTick; value <= max + step * 0.000001 && ticks.length < 20; value += step) {
    ticks.push(Math.abs(value) < step * 0.000001 ? 0 : value);
  }
  return { min, max, step, ticks };
}
