export type ChartLensState = {
  enabled: boolean;
  x: number;
  y: number;
  magnification: number;
  size: number;
};

export const DEFAULT_CHART_LENS_STATE: ChartLensState = {
  enabled: false,
  x: 0.66,
  y: 0.38,
  magnification: 2.5,
  size: 164,
};

export const CHART_LENS_MIN_MAGNIFICATION = 1.5;
export const CHART_LENS_MAX_MAGNIFICATION = 10;
export const CHART_LENS_MAGNIFICATION_STEP = 0.5;

export type ChartPadding = { left: number; right: number; top: number; bottom: number };
export type ChartLensGeometry = {
  centerX: number;
  centerY: number;
  focusX: number;
  focusY: number;
  radius: number;
};
export type ChartLensMovementBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};
export const CHART_LENS_CONTENT_INSET = 5;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

const lensRadius = (
  width: number,
  height: number,
  padding: ChartPadding,
  lens: ChartLensState,
) => {
  const chartWidth = Math.max(1, width - padding.left - padding.right);
  const chartHeight = Math.max(1, height - padding.top - padding.bottom);
  return Math.max(36, Math.min(lens.size / 2, chartWidth / 2 - 2, chartHeight / 2 - 2));
};

export function chartLensMovementBounds(
  width: number,
  height: number,
  padding: ChartPadding,
  lens: ChartLensState,
): ChartLensMovementBounds {
  const chartWidth = Math.max(1, width - padding.left - padding.right);
  const chartHeight = Math.max(1, height - padding.top - padding.bottom);
  const radius = lensRadius(width, height, padding, lens);
  return {
    minX: -radius / chartWidth,
    maxX: 1 + radius / chartWidth,
    minY: -radius / chartHeight,
    maxY: 1 + radius / chartHeight,
  };
}

export function chartLensGeometry(
  width: number,
  height: number,
  padding: ChartPadding,
  lens: ChartLensState,
): ChartLensGeometry {
  const chartWidth = Math.max(1, width - padding.left - padding.right);
  const chartHeight = Math.max(1, height - padding.top - padding.bottom);
  const radius = lensRadius(width, height, padding, lens);
  const movement = chartLensMovementBounds(width, height, padding, lens);
  const focusX = padding.left + clamp(lens.x, movement.minX, movement.maxX) * chartWidth;
  const focusY = padding.top + clamp(lens.y, movement.minY, movement.maxY) * chartHeight;
  return {
    centerX: focusX,
    centerY: focusY,
    focusX,
    focusY,
    radius,
  };
}

export function pointIsInsideChartLens(
  x: number,
  y: number,
  geometry: ChartLensGeometry,
) {
  return Math.hypot(x - geometry.centerX, y - geometry.centerY) <= geometry.radius;
}

export function insetChartLensGeometry(
  geometry: ChartLensGeometry,
  inset: number,
): ChartLensGeometry {
  return { ...geometry, radius: Math.max(0, geometry.radius - Math.max(0, inset)) };
}

export function lensSourcePoint(
  x: number,
  y: number,
  geometry: ChartLensGeometry,
  magnification: number,
) {
  const safeMagnification = Math.max(1, magnification);
  return {
    x: geometry.focusX + (x - geometry.centerX) / safeMagnification,
    y: geometry.focusY + (y - geometry.centerY) / safeMagnification,
  };
}

export function lensDisplayPoint(
  x: number,
  y: number,
  geometry: ChartLensGeometry,
  magnification: number,
) {
  const safeMagnification = Math.max(1, magnification);
  return {
    x: geometry.centerX + (x - geometry.focusX) * safeMagnification,
    y: geometry.centerY + (y - geometry.focusY) * safeMagnification,
  };
}

export function shiftNormalizedChartLensPosition(
  startX: number,
  startY: number,
  deltaX: number,
  deltaY: number,
  width: number,
  height: number,
  padding: ChartPadding,
  movement: ChartLensMovementBounds,
) {
  const chartWidth = Math.max(1, width - padding.left - padding.right);
  const chartHeight = Math.max(1, height - padding.top - padding.bottom);
  return {
    x: clamp(startX + deltaX / chartWidth, movement.minX, movement.maxX),
    y: clamp(startY + deltaY / chartHeight, movement.minY, movement.maxY),
  };
}

export function normalizedChartLensPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  padding: ChartPadding,
) {
  const chartWidth = Math.max(1, width - padding.left - padding.right);
  const chartHeight = Math.max(1, height - padding.top - padding.bottom);
  return {
    x: clamp((x - padding.left) / chartWidth, 0, 1),
    y: clamp((y - padding.top) / chartHeight, 0, 1),
  };
}
