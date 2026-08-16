export type TooltipPoint = Readonly<{ x: number; y: number }>;

export type FundComparisonTooltipPlacement =
  | "near-above-left"
  | "near-above-right"
  | "near-below-left"
  | "near-below-right"
  | "near-above"
  | "near-below"
  | "near-left"
  | "near-right"
  | "rail-top"
  | "rail-bottom";

export type FundComparisonTooltipLayout = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
  placement: FundComparisonTooltipPlacement;
  anchorX: number;
  anchorY: number;
}>;

type Rectangle = Readonly<{
  left: number;
  right: number;
  top: number;
  bottom: number;
}>;

type PlacementInput = Readonly<{
  anchor: TooltipPoint;
  tooltip: Readonly<{ width: number; height: number }>;
  canvas: Readonly<{ width: number; height: number }>;
  plot: Rectangle;
  series: readonly (readonly TooltipPoint[])[];
  previous?: FundComparisonTooltipLayout;
  gap?: number;
  margin?: number;
  clearance?: number;
}>;

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

const pointInside = (point: TooltipPoint, rectangle: Rectangle) =>
  point.x >= rectangle.left
  && point.x <= rectangle.right
  && point.y >= rectangle.top
  && point.y <= rectangle.bottom;

// Liang-Barsky clipping keeps this deterministic for steep, flat, and
// single-point series without sampling between published observations.
const segmentIntersects = (start: TooltipPoint, end: TooltipPoint, rectangle: Rectangle) => {
  if (pointInside(start, rectangle) || pointInside(end, rectangle)) return true;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let minimum = 0;
  let maximum = 1;
  const boundaries: Array<[number, number]> = [
    [-dx, start.x - rectangle.left],
    [dx, rectangle.right - start.x],
    [-dy, start.y - rectangle.top],
    [dy, rectangle.bottom - start.y],
  ];
  for (const [direction, distance] of boundaries) {
    if (direction === 0) {
      if (distance < 0) return false;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) minimum = Math.max(minimum, ratio);
    else maximum = Math.min(maximum, ratio);
    if (minimum > maximum) return false;
  }
  return true;
};

const collidesWithSeries = (
  rectangle: Rectangle,
  series: PlacementInput["series"],
  clearance: number,
) => {
  const expanded = {
    left: rectangle.left - clearance,
    right: rectangle.right + clearance,
    top: rectangle.top - clearance,
    bottom: rectangle.bottom + clearance,
  };
  return series.some((points) => {
    if (points.length === 1) return pointInside(points[0], expanded);
    let low = 0;
    let high = points.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (points[middle].x < expanded.left) low = middle + 1;
      else high = middle;
    }
    const firstRelevant = Math.max(1, low);
    for (let index = firstRelevant; index < points.length; index += 1) {
      if (points[index - 1].x > expanded.right) break;
      if (segmentIntersects(points[index - 1], points[index], expanded)) return true;
    }
    return false;
  });
};

export const placeFundComparisonTooltip = ({
  anchor,
  tooltip,
  canvas,
  plot,
  series,
  previous,
  gap = 12,
  margin = 6,
  clearance = 5,
}: PlacementInput): FundComparisonTooltipLayout => {
  const safeWidth = clamp(
    Number.isFinite(tooltip.width) ? tooltip.width : 1,
    1,
    Math.max(1, canvas.width - margin * 2),
  );
  const safeHeight = clamp(
    Number.isFinite(tooltip.height) ? tooltip.height : 1,
    1,
    Math.max(1, canvas.height - margin * 2),
  );
  const safeAnchor = {
    x: clamp(Number.isFinite(anchor.x) ? anchor.x : plot.left, 0, canvas.width),
    y: clamp(Number.isFinite(anchor.y) ? anchor.y : plot.top, 0, canvas.height),
  };
  const preferRight = safeAnchor.x <= (plot.left + plot.right) / 2;
  const preferBelow = safeAnchor.y <= (plot.top + plot.bottom) / 2;
  const horizontal = preferRight
    ? (["right", "left"] as const)
    : (["left", "right"] as const);
  const vertical = preferBelow
    ? (["below", "above"] as const)
    : (["above", "below"] as const);
  const rawCandidates: Array<{
    left: number;
    top: number;
    placement: FundComparisonTooltipPlacement;
  }> = [];

  if (previous?.placement.startsWith("near-")) {
    rawCandidates.push({
      left: safeAnchor.x + previous.left - previous.anchorX,
      top: safeAnchor.y + previous.top - previous.anchorY,
      placement: previous.placement,
    });
  }

  const horizontalDirection = preferRight ? 1 : -1;
  const verticalDirection = preferBelow ? 1 : -1;
  const horizontalOffsets = Array.from(
    { length: 9 },
    (_, index) => index * Math.max(18, safeWidth / 5),
  );
  const verticalOffsets = Array.from(
    { length: 7 },
    (_, index) => index * Math.max(16, safeHeight / 2),
  );

  for (const verticalSide of vertical) {
    for (const offset of horizontalOffsets) {
      for (const direction of offset === 0
        ? [horizontalDirection]
        : [horizontalDirection, -horizontalDirection]) {
        rawCandidates.push({
          left: safeAnchor.x - safeWidth / 2 + direction * offset,
          top: verticalSide === "below"
            ? safeAnchor.y + gap
            : safeAnchor.y - safeHeight - gap,
          placement: `near-${verticalSide}`,
        });
      }
    }
  }
  for (const horizontalSide of horizontal) {
    for (const offset of verticalOffsets) {
      for (const direction of offset === 0
        ? [verticalDirection]
        : [verticalDirection, -verticalDirection]) {
        rawCandidates.push({
          left: horizontalSide === "right"
            ? safeAnchor.x + gap
            : safeAnchor.x - safeWidth - gap,
          top: safeAnchor.y - safeHeight / 2 + direction * offset,
          placement: `near-${horizontalSide}`,
        });
      }
    }
  }
  for (const verticalSide of vertical) {
    for (const horizontalSide of horizontal) {
      rawCandidates.push({
        left: horizontalSide === "right"
          ? safeAnchor.x + gap
          : safeAnchor.x - safeWidth - gap,
        top: verticalSide === "below"
          ? safeAnchor.y + gap
          : safeAnchor.y - safeHeight - gap,
        placement: `near-${verticalSide}-${horizontalSide}`,
      });
    }
  }
  const seen = new Set<string>();
  for (const raw of rawCandidates) {
    const left = clamp(raw.left, margin, canvas.width - safeWidth - margin);
    const top = clamp(raw.top, margin, canvas.height - safeHeight - margin);
    const key = `${left}:${top}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rectangle = { left, top, right: left + safeWidth, bottom: top + safeHeight };
    if (rectangle.bottom <= plot.top || rectangle.top >= plot.bottom) continue;
    if (!collidesWithSeries(rectangle, series, clearance)) {
      return {
        left,
        top,
        width: safeWidth,
        height: safeHeight,
        placement: raw.placement,
        anchorX: safeAnchor.x,
        anchorY: safeAnchor.y,
      };
    }
  }

  const railLeft = clamp(
    safeAnchor.x - safeWidth / 2,
    margin,
    canvas.width - safeWidth - margin,
  );
  const topRail = Math.max(margin, plot.top - safeHeight - clearance);
  const bottomRail = Math.min(canvas.height - safeHeight - margin, plot.bottom + clearance);
  const topDistance = Math.abs(safeAnchor.y - (topRail + safeHeight / 2));
  const bottomDistance = Math.abs(safeAnchor.y - (bottomRail + safeHeight / 2));
  const bottomAvailable = bottomRail >= plot.bottom + clearance;
  const railHysteresis = Math.max(36, safeHeight * 0.75);
  const useBottom = bottomAvailable && (previous?.placement === "rail-bottom"
    ? bottomDistance <= topDistance + railHysteresis
    : previous?.placement === "rail-top"
      ? bottomDistance + railHysteresis < topDistance
      : bottomDistance < topDistance);
  return {
    left: railLeft,
    top: useBottom ? bottomRail : topRail,
    width: safeWidth,
    height: safeHeight,
    placement: useBottom ? "rail-bottom" : "rail-top",
    anchorX: safeAnchor.x,
    anchorY: safeAnchor.y,
  };
};
