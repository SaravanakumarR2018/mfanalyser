type ChartScalePoint = {
  value: number;
  invested: number;
};

export type ChartScale = {
  min: number;
  max: number;
  step: number;
  ticks: number[];
};

const niceStep = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const fraction = value / magnitude;
  const factor = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  return factor * magnitude;
};

const tidy = (value: number) => Number(value.toPrecision(12));

export function buildChartScale(
  points: ChartScalePoint[],
  includeInvested: boolean,
): ChartScale {
  const values = points
    .flatMap((point) => includeInvested ? [point.value, point.invested] : [point.value])
    .filter(Number.isFinite);
  if (!values.length) return { min: 0, max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };

  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const observedSpan = highest - lowest;
  const padding = observedSpan > 0
    ? observedSpan * 0.12
    : Math.max(Math.abs(highest) * 0.02, 1);
  const paddedMin = Math.max(0, lowest - padding);
  const paddedMax = highest + padding;
  const step = niceStep(Math.max(paddedMax - paddedMin, 1) / 4);
  const min = Math.max(0, Math.floor(paddedMin / step) * step);
  const max = Math.max(min + step, Math.ceil(paddedMax / step) * step);
  const ticks: number[] = [];

  for (let tick = min; tick <= max + step / 2 && ticks.length < 20; tick += step) {
    ticks.push(tidy(tick));
  }

  return { min: tidy(min), max: tidy(max), step: tidy(step), ticks };
}
