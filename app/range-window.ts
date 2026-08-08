export type IndexRange = [number, number];

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export function shiftRangeWindow(
  range: IndexRange,
  delta: number,
  totalPoints: number,
): IndexRange {
  const maxIndex = Math.max(0, totalPoints - 1);
  if (maxIndex === 0) return [0, 0];

  const start = clamp(Math.round(range[0]), 0, maxIndex);
  const end = clamp(Math.max(start, Math.round(range[1])), start, maxIndex);
  const width = end - start;
  if (width >= maxIndex) return [0, maxIndex];

  const movement = Number.isFinite(delta) ? Math.round(delta) : 0;
  const nextStart = clamp(start + movement, 0, maxIndex - width);
  return [nextStart, nextStart + width];
}
