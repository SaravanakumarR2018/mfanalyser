export type AllocationInput = {
  key: string;
  label: string;
  value: number;
};

export type AllocationSlice = AllocationInput & {
  percentage: number;
  startAngle: number;
  endAngle: number;
  midAngle: number;
};

export type DonutTooltipDirection = "right" | "left" | "bottom" | "top";

export type DonutTooltipPlacement = {
  direction: DonutTooltipDirection;
  left: number;
  top: number;
};

type Rectangle = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const safePositive = (value: number) => Number.isFinite(value) && value > 0;

export function buildAllocationSlices(
  items: readonly AllocationInput[],
): AllocationSlice[] {
  const eligible = items.filter((item) => item.key && item.label && safePositive(item.value));
  const total = eligible.reduce((sum, item) => sum + item.value, 0);
  if (!safePositive(total)) return [];

  let cursor = 0;
  return eligible.map((item, index) => {
    const percentage = item.value / total * 100;
    const startAngle = cursor * 3.6;
    cursor += percentage;
    const endAngle = index === eligible.length - 1 ? 360 : cursor * 3.6;
    return {
      ...item,
      percentage,
      startAngle,
      endAngle,
      midAngle: startAngle + (endAngle - startAngle) / 2,
    };
  });
}

const polarPoint = (radius: number, angle: number) => {
  const radians = (angle - 90) * Math.PI / 180;
  return {
    x: 90 + radius * Math.cos(radians),
    y: 90 + radius * Math.sin(radians),
  };
};

export function allocationSlicePath(
  slice: Pick<AllocationSlice, "startAngle" | "endAngle">,
  outerRadius = 76,
  innerRadius = 48,
  gapDegrees = 0.9,
) {
  const span = Math.max(0, slice.endAngle - slice.startAngle);
  if (!Number.isFinite(span) || span <= 0) return "";
  const gap = Math.min(Math.max(0, gapDegrees), Math.max(0, span - 0.02));
  const start = slice.startAngle + gap / 2;
  const end = slice.endAngle - gap / 2;
  const outerStart = polarPoint(outerRadius, start);
  const outerEnd = polarPoint(outerRadius, end);
  const innerEnd = polarPoint(innerRadius, end);
  const innerStart = polarPoint(innerRadius, start);
  const largeArc = end - start > 180 ? 1 : 0;

  return [
    `M ${outerStart.x.toFixed(4)} ${outerStart.y.toFixed(4)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x.toFixed(4)} ${outerEnd.y.toFixed(4)}`,
    `L ${innerEnd.x.toFixed(4)} ${innerEnd.y.toFixed(4)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x.toFixed(4)} ${innerStart.y.toFixed(4)}`,
    "Z",
  ].join(" ");
}

export function allocationSliceOffset(midAngle: number, distance = 5) {
  const radians = (midAngle - 90) * Math.PI / 180;
  return {
    x: Math.cos(radians) * distance,
    y: Math.sin(radians) * distance,
  };
}

export function placeDonutTooltip({
  donut,
  tooltip,
  viewport,
  midAngle,
  gap = 14,
  margin = 8,
}: {
  donut: Rectangle;
  tooltip: Pick<Rectangle, "width" | "height">;
  viewport: { width: number; height: number };
  midAngle: number;
  gap?: number;
  margin?: number;
}): DonutTooltipPlacement {
  const safeGap = Number.isFinite(gap) ? Math.max(0, gap) : 14;
  const safeMargin = Number.isFinite(margin) ? Math.max(0, margin) : 8;
  const centerX = donut.left + donut.width / 2;
  const centerY = donut.top + donut.height / 2;
  const maxLeft = Math.max(safeMargin, viewport.width - safeMargin - tooltip.width);
  const maxTop = Math.max(safeMargin, viewport.height - safeMargin - tooltip.height);
  const clampLeft = (left: number) => Math.min(maxLeft, Math.max(safeMargin, left));
  const clampTop = (top: number) => Math.min(maxTop, Math.max(safeMargin, top));
  const candidates: Record<DonutTooltipDirection, DonutTooltipPlacement> = {
    right: {
      direction: "right",
      left: donut.left + donut.width + safeGap,
      top: clampTop(centerY - tooltip.height / 2),
    },
    left: {
      direction: "left",
      left: donut.left - safeGap - tooltip.width,
      top: clampTop(centerY - tooltip.height / 2),
    },
    bottom: {
      direction: "bottom",
      left: clampLeft(centerX - tooltip.width / 2),
      top: donut.top + donut.height + safeGap,
    },
    top: {
      direction: "top",
      left: clampLeft(centerX - tooltip.width / 2),
      top: donut.top - safeGap - tooltip.height,
    },
  };
  const radians = (midAngle - 90) * Math.PI / 180;
  const x = Number.isFinite(radians) ? Math.cos(radians) : 1;
  const y = Number.isFinite(radians) ? Math.sin(radians) : 0;
  const scores: Record<DonutTooltipDirection, number> = {
    right: x,
    left: -x,
    bottom: y,
    top: -y,
  };
  const directions = (Object.keys(candidates) as DonutTooltipDirection[])
    .sort((left, right) => scores[right] - scores[left]);
  const fits = (candidate: DonutTooltipPlacement) => (
    candidate.left >= safeMargin
    && candidate.top >= safeMargin
    && candidate.left + tooltip.width <= viewport.width - safeMargin
    && candidate.top + tooltip.height <= viewport.height - safeMargin
  );
  const fitting = directions.find((direction) => fits(candidates[direction]));
  if (fitting) return candidates[fitting];

  const visibleArea = (candidate: DonutTooltipPlacement) => {
    const visibleWidth = Math.max(0, Math.min(candidate.left + tooltip.width, viewport.width) - Math.max(candidate.left, 0));
    const visibleHeight = Math.max(0, Math.min(candidate.top + tooltip.height, viewport.height) - Math.max(candidate.top, 0));
    return visibleWidth * visibleHeight;
  };
  const best = directions
    .map((direction) => candidates[direction])
    .sort((left, right) => visibleArea(right) - visibleArea(left))[0];
  return best.direction === "right" || best.direction === "left"
    ? { ...best, top: clampTop(best.top) }
    : { ...best, left: clampLeft(best.left) };
}
