export type ChartLensState = {
  enabled: boolean;
  x: number;
  y: number;
  magnification: number;
  size: number;
};

export type ChartPadding = { left: number; right: number; top: number; bottom: number };
export type ChartLensGeometry = { centerX: number; centerY: number; radius: number };

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export function chartLensGeometry(
  width: number,
  height: number,
  padding: ChartPadding,
  lens: ChartLensState,
): ChartLensGeometry {
  const chartWidth = Math.max(1, width - padding.left - padding.right);
  const chartHeight = Math.max(1, height - padding.top - padding.bottom);
  const radius = Math.max(36, Math.min(lens.size / 2, chartWidth / 2 - 2, chartHeight / 2 - 2));
  const desiredX = padding.left + clamp(lens.x, 0, 1) * chartWidth;
  const desiredY = padding.top + clamp(lens.y, 0, 1) * chartHeight;
  return {
    centerX: clamp(desiredX, padding.left + radius, width - padding.right - radius),
    centerY: clamp(desiredY, padding.top + radius, height - padding.bottom - radius),
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

export function lensSourcePoint(
  x: number,
  y: number,
  geometry: ChartLensGeometry,
  magnification: number,
) {
  const safeMagnification = Math.max(1, magnification);
  return {
    x: geometry.centerX + (x - geometry.centerX) / safeMagnification,
    y: geometry.centerY + (y - geometry.centerY) / safeMagnification,
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
