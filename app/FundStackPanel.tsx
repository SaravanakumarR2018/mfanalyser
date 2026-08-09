"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  chartLensGeometry,
  lensSourcePoint,
  normalizedChartLensPosition,
  pointIsInsideChartLens,
  type ChartLensState,
} from "./chart-lens";
import { formatInr } from "./formatters";
import {
  annualizedReturnAt,
  findStackFundIndexFromBounds,
  fundValueShare,
  stackBoundsForPoint,
  type FundStackMode,
  type FundStackModel,
  type FundStackPoint,
  type FundStackScale,
} from "./fund-stack-service";

const modeTotal = (point: FundStackPoint, mode: FundStackMode) => {
  if (mode === "value") return point.totalValue;
  if (mode === "invested") return point.totalInvested;
  return point.totalContribution;
};

export const stackModeTitle = (mode: FundStackMode) => {
  if (mode === "value") return "Fund value";
  if (mode === "invested") return "Net invested";
  return "Contribution";
};

export const stackFundColor = (index: number) =>
  `hsl(${Math.round((152 + index * 137.508) % 360)} 56% ${index % 3 === 0 ? 42 : index % 3 === 1 ? 52 : 62}%)`;

export const stackFormatDate = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(`${date}T00:00:00Z`));

const compactDate = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" })
    .format(new Date(`${date}T00:00:00Z`));

const axisMoney = (value: number, step: number) => {
  const absolute = Math.abs(value);
  const formatUnit = (divisor: number, suffix: string) => {
    const unitStep = Math.abs(step / divisor);
    const decimals = unitStep >= 1 ? 0 : unitStep >= 0.1 ? 1 : unitStep >= 0.01 ? 2 : 3;
    return `${value < 0 ? "−" : ""}₹${(absolute / divisor).toFixed(decimals)}${suffix}`;
  };
  if (absolute >= 10_000_000) return formatUnit(10_000_000, "Cr");
  if (absolute >= 100_000) return formatUnit(100_000, "L");
  if (absolute >= 1_000) return formatUnit(1_000, "K");
  return `${value < 0 ? "−" : ""}₹${Math.round(absolute)}`;
};

const chartPadding = (width: number) => ({ left: width < 360 ? 12 : 62, right: 18, top: 28, bottom: 40 });

type StackHover = {
  pointIndex: number;
  point: FundStackPoint;
  fundIndex: number | null;
  viewKey: string;
  x: number;
  y: number;
  tooltipLeft: number;
  insideLens: boolean;
};

type FundStackPanelProps = {
  mode: FundStackMode;
  model: FundStackModel;
  visible: FundStackPoint[];
  visibleTimes: number[];
  selectedDate: string | null;
  scale: FundStackScale;
  lens: ChartLensState;
  viewKey: string;
  onLensMove: (position: { x: number; y: number }) => void;
  onSelectPoint: (date: string, mode: FundStackMode) => void;
};

export default function FundStackPanel({
  mode,
  model,
  visible,
  visibleTimes,
  selectedDate,
  scale,
  lens,
  viewKey,
  onLensMove,
  onSelectPoint,
}: FundStackPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lensCanvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);
  const latestLensDrawRef = useRef<() => void>(() => undefined);
  const suppressClickRef = useRef(false);
  const [hover, setHover] = useState<StackHover | null>(null);
  const [dragging, setDragging] = useState(false);
  const bounds = useMemo(
    () => visible.map((point) => stackBoundsForPoint(point, mode)),
    [mode, visible],
  );

  const pointerToIndex = useCallback((localX: number, width: number) => {
    if (!visibleTimes.length) return 0;
    const padding = chartPadding(width);
    const ratio = Math.max(0, Math.min(1, (localX - padding.left) / Math.max(1, width - padding.left - padding.right)));
    const first = visibleTimes[0];
    const last = visibleTimes.at(-1) ?? first;
    const target = first + ratio * Math.max(1, last - first);
    let low = 0;
    let high = visibleTimes.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (visibleTimes[middle] < target) low = middle + 1;
      else high = middle;
    }
    if (low <= 0) return 0;
    if (low >= visibleTimes.length) return visibleTimes.length - 1;
    return target - visibleTimes[low - 1] <= visibleTimes[low] - target ? low - 1 : low;
  }, [visibleTimes]);

  const resolvePointer = useCallback((clientX: number, clientY: number, rect: DOMRect) => {
    const padding = chartPadding(rect.width);
    const raw = { x: clientX - rect.left, y: clientY - rect.top };
    const geometry = chartLensGeometry(rect.width, rect.height, padding, lens);
    const insideLens = lens.enabled && pointIsInsideChartLens(raw.x, raw.y, geometry);
    const source = insideLens
      ? lensSourcePoint(raw.x, raw.y, geometry, lens.magnification)
      : raw;
    return { raw, source, insideLens, geometry, padding };
  }, [lens]);

  const updateHover = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!visible.length) return;
    const resolved = resolvePointer(event.clientX, event.clientY, rect);
    const { padding } = resolved;
    const chartHeight = rect.height - padding.top - padding.bottom;
    if (resolved.raw.y < padding.top || resolved.raw.y > rect.height - padding.bottom) {
      setHover(null);
      return;
    }

    const pointIndex = pointerToIndex(resolved.source.x, rect.width);
    const point = visible[pointIndex];
    const span = Math.max(1, scale.max - scale.min);
    const valueAtPointer = scale.max - ((resolved.source.y - padding.top) / Math.max(1, chartHeight)) * span;
    const pointBounds = bounds[pointIndex] ?? [];
    const matchedIndex = findStackFundIndexFromBounds(pointBounds, valueAtPointer);
    const fundIndex = matchedIndex >= 0 ? matchedIndex : null;
    const fundBounds = fundIndex === null ? null : pointBounds[fundIndex];
    const rawMarkerValue = fundBounds ? (fundBounds.lower + fundBounds.upper) / 2 : modeTotal(point, mode);
    const markerValue = Math.max(scale.min, Math.min(scale.max, rawMarkerValue));
    const firstTime = visibleTimes[0];
    const lastTime = visibleTimes.at(-1) ?? firstTime;
    const pointTime = visibleTimes[pointIndex];
    const chartWidth = rect.width - padding.left - padding.right;
    const sourceX = visible.length === 1
      ? padding.left + chartWidth / 2
      : padding.left + ((pointTime - firstTime) / Math.max(1, lastTime - firstTime)) * chartWidth;
    const sourceY = padding.top + ((scale.max - markerValue) / span) * chartHeight;
    const x = resolved.insideLens ? resolved.raw.x : sourceX;
    const y = resolved.insideLens ? resolved.raw.y : sourceY;
    const tooltipWidth = Math.min(218, rect.width - 16);
    const preferredLeft = x < rect.width / 2 ? x + 14 : x - tooltipWidth - 14;
    const tooltipLeft = Math.max(8, Math.min(rect.width - tooltipWidth - 8, preferredLeft));

    setHover((current) => current
      && current.point === point
      && current.fundIndex === fundIndex
      && current.viewKey === viewKey
      && current.insideLens === resolved.insideLens
      && Math.abs(current.x - x) < 0.5
      && Math.abs(current.y - y) < 0.5
        ? current
        : { pointIndex, point, fundIndex, viewKey, x, y, tooltipLeft, insideLens: resolved.insideLens });
  }, [bounds, mode, pointerToIndex, resolvePointer, scale, viewKey, visible, visibleTimes]);

  const selectFromKeyboard = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (!visible.length) return;
    if (event.key === "Enter" || event.key === " ") {
      const visibleSelection = selectedDate && visible.some((point) => point.date === selectedDate)
        ? selectedDate
        : visible.at(-1)?.date;
      if (visibleSelection) onSelectPoint(visibleSelection, mode);
      event.preventDefault();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const current = Math.max(0, visible.findIndex((point) => point.date === selectedDate));
    const next = Math.max(0, Math.min(visible.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1)));
    onSelectPoint(visible[next].date, mode);
    event.preventDefault();
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const shell = shellRef.current;
    if (!canvas || !shell || !visible.length) return;
    const width = shell.clientWidth;
    const height = 390;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(dpr, dpr);

    const padding = { left: width < 360 ? 12 : 62, right: 18, top: 28, bottom: 40 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const span = Math.max(1, scale.max - scale.min);
    const firstTime = visibleTimes[0];
    const lastTime = visibleTimes.at(-1) ?? firstTime;
    const timeSpan = Math.max(1, lastTime - firstTime);
    const xFor = (index: number) => visible.length === 1
      ? padding.left + chartWidth / 2
      : padding.left + ((visibleTimes[index] - firstTime) / timeSpan) * chartWidth;
    const yFor = (value: number) => padding.top + ((scale.max - value) / span) * chartHeight;

    context.clearRect(0, 0, width, height);
    context.font = "10px Arial, sans-serif";
    context.textBaseline = "middle";
    for (const tick of scale.ticks) {
      const y = yFor(tick);
      context.strokeStyle = tick === 0 ? "rgba(11, 29, 42, 0.22)" : "rgba(11, 29, 42, 0.08)";
      context.lineWidth = tick === 0 ? 1.2 : 1;
      context.setLineDash(tick === 0 ? [] : [3, 6]);
      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(width - padding.right, y);
      context.stroke();
      if (width >= 360) {
        context.fillStyle = "#728078";
        context.textAlign = "right";
        context.fillText(axisMoney(tick, scale.step), padding.left - 9, y);
      }
    }
    context.setLineDash([]);

    context.save();
    context.beginPath();
    context.rect(padding.left, padding.top, chartWidth, chartHeight);
    context.clip();

    model.funds.forEach((fund, fundIndex) => {
      context.beginPath();
      visible.forEach((point, pointIndex) => {
        const x = xFor(pointIndex);
        const y = yFor(bounds[pointIndex][fundIndex]?.upper ?? 0);
        if (pointIndex === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      for (let pointIndex = visible.length - 1; pointIndex >= 0; pointIndex -= 1) {
        context.lineTo(xFor(pointIndex), yFor(bounds[pointIndex][fundIndex]?.lower ?? 0));
      }
      context.closePath();
      context.fillStyle = stackFundColor(fundIndex);
      context.globalAlpha = 0.82;
      context.fill();
      context.globalAlpha = 1;
      context.strokeStyle = "rgba(253,252,247,.42)";
      context.lineWidth = 0.65;
      context.stroke();
    });

    context.beginPath();
    visible.forEach((point, index) => {
      const y = yFor(modeTotal(point, mode));
      if (index === 0) context.moveTo(xFor(index), y);
      else context.lineTo(xFor(index), y);
    });
    context.strokeStyle = "rgba(11,29,42,.72)";
    context.lineWidth = 1.6;
    context.setLineDash(mode === "contribution" ? [5, 4] : []);
    context.stroke();
    context.setLineDash([]);
    context.restore();

    const labelCount = width < 500 ? 3 : 5;
    context.fillStyle = "#728078";
    context.textAlign = "center";
    for (let label = 0; label < labelCount; label += 1) {
      const target = firstTime + timeSpan * label / Math.max(1, labelCount - 1);
      const nearest = visibleTimes.reduce((best, time, index) =>
        Math.abs(time - target) < Math.abs(visibleTimes[best] - target) ? index : best, 0);
      context.fillText(compactDate(visible[nearest].date), xFor(nearest), height - 14);
    }

    const selectedIndex = visible.findIndex((point) => point.date === selectedDate);
    if (selectedIndex >= 0) {
      const x = xFor(selectedIndex);
      context.strokeStyle = "rgba(11,29,42,.68)";
      context.lineWidth = 1.3;
      context.beginPath();
      context.moveTo(x, padding.top);
      context.lineTo(x, height - padding.bottom);
      context.stroke();
      context.fillStyle = "#0B1D2A";
      const markerY = yFor(modeTotal(visible[selectedIndex], mode));
      if (markerY >= padding.top && markerY <= height - padding.bottom) {
        context.beginPath();
        context.arc(x, markerY, 4, 0, Math.PI * 2);
        context.fill();
      }
    }
  }, [bounds, mode, model.funds, scale, selectedDate, visible, visibleTimes]);

  const drawLens = useCallback(() => {
    const baseCanvas = canvasRef.current;
    const lensCanvas = lensCanvasRef.current;
    const shell = shellRef.current;
    if (!baseCanvas || !lensCanvas || !shell) return;
    const width = shell.clientWidth;
    const height = 390;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    lensCanvas.width = width * dpr;
    lensCanvas.height = height * dpr;
    lensCanvas.style.width = `${width}px`;
    lensCanvas.style.height = `${height}px`;
    const context = lensCanvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!lens.enabled || !visible.length) return;

    const geometry = chartLensGeometry(width, height, chartPadding(width), lens);
    const sourceRadius = geometry.radius / Math.max(1, lens.magnification);
    const destinationSize = geometry.radius * 2;
    const destinationLeft = geometry.centerX - geometry.radius;
    const destinationTop = geometry.centerY - geometry.radius;

    context.save();
    context.shadowColor = "rgba(11, 29, 42, 0.24)";
    context.shadowBlur = 18;
    context.shadowOffsetY = 5;
    context.fillStyle = "#fff";
    context.beginPath();
    context.arc(geometry.centerX, geometry.centerY, geometry.radius, 0, Math.PI * 2);
    context.fill();
    context.restore();

    context.save();
    context.beginPath();
    context.arc(geometry.centerX, geometry.centerY, geometry.radius - 2, 0, Math.PI * 2);
    context.clip();
    context.drawImage(
      baseCanvas,
      (geometry.centerX - sourceRadius) * dpr,
      (geometry.centerY - sourceRadius) * dpr,
      sourceRadius * 2 * dpr,
      sourceRadius * 2 * dpr,
      destinationLeft,
      destinationTop,
      destinationSize,
      destinationSize,
    );
    const sheen = context.createLinearGradient(destinationLeft, destinationTop, geometry.centerX, geometry.centerY);
    sheen.addColorStop(0, "rgba(255,255,255,.18)");
    sheen.addColorStop(0.55, "rgba(255,255,255,0)");
    context.fillStyle = sheen;
    context.fillRect(destinationLeft, destinationTop, destinationSize, destinationSize);
    context.restore();

    context.strokeStyle = dragging ? "#087A4B" : "rgba(11, 29, 42, .72)";
    context.lineWidth = dragging ? 3 : 2;
    context.beginPath();
    context.arc(geometry.centerX, geometry.centerY, geometry.radius - 1.5, 0, Math.PI * 2);
    context.stroke();

    context.fillStyle = dragging ? "#087A4B" : "#0B1D2A";
    context.beginPath();
    context.roundRect(geometry.centerX - 20, geometry.centerY + geometry.radius - 7, 40, 13, 7);
    context.fill();
    context.strokeStyle = "rgba(255,255,255,.72)";
    context.lineWidth = 1;
    for (let offset = -6; offset <= 6; offset += 6) {
      context.beginPath();
      context.moveTo(geometry.centerX + offset, geometry.centerY + geometry.radius - 3);
      context.lineTo(geometry.centerX + offset, geometry.centerY + geometry.radius + 2);
      context.stroke();
    }
  }, [dragging, lens, visible.length]);

  useEffect(() => {
    latestLensDrawRef.current = drawLens;
    drawLens();
  }, [drawLens]);

  useEffect(() => {
    draw();
    requestAnimationFrame(() => latestLensDrawRef.current());
    const observer = new ResizeObserver(() => {
      setHover(null);
      draw();
      requestAnimationFrame(() => latestLensDrawRef.current());
    });
    if (shellRef.current) observer.observe(shellRef.current);
    return () => observer.disconnect();
  }, [draw]);

  const lensPositionForPointer = useCallback((
    event: ReactPointerEvent<HTMLCanvasElement>,
    offsetX = 0,
    offsetY = 0,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return normalizedChartLensPosition(
      event.clientX - rect.left - offsetX,
      event.clientY - rect.top - offsetY,
      rect.width,
      rect.height,
      chartPadding(rect.width),
    );
  }, []);

  const beginLensDrag = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!lens.enabled || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const resolved = resolvePointer(event.clientX, event.clientY, rect);
    if (!resolved.insideLens) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: resolved.raw.x - resolved.geometry.centerX,
      offsetY: resolved.raw.y - resolved.geometry.centerY,
      moved: false,
    };
    suppressClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.style.cursor = "grabbing";
    setDragging(true);
    event.preventDefault();
  }, [lens.enabled, resolvePointer]);

  const movePointer = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3) drag.moved = true;
      onLensMove(lensPositionForPointer(event, drag.offsetX, drag.offsetY));
      setHover(null);
      event.preventDefault();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const resolved = resolvePointer(event.clientX, event.clientY, rect);
    event.currentTarget.style.cursor = resolved.insideLens ? "grab" : "crosshair";
    updateHover(event);
  }, [lensPositionForPointer, onLensMove, resolvePointer, updateHover]);

  const finishLensDrag = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    event.currentTarget.style.cursor = "grab";
    setDragging(false);
  }, []);

  const selectFromPointer = useCallback((event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const resolved = resolvePointer(event.clientX, event.clientY, rect);
    const pointIndex = pointerToIndex(resolved.source.x, rect.width);
    const date = visible[pointIndex]?.date;
    if (date) onSelectPoint(date, mode);
  }, [mode, onSelectPoint, pointerToIndex, resolvePointer, visible]);

  const activeHover = hover
    && hover.viewKey === viewKey
    && visible[hover.pointIndex] === hover.point
      ? hover
      : null;
  const hoveredPoint = activeHover?.point ?? null;
  const hoveredFundValue = hoveredPoint && activeHover?.fundIndex !== null
    ? hoveredPoint.funds[activeHover.fundIndex] ?? null
    : null;
  const hoveredFund = activeHover?.fundIndex !== null && activeHover?.fundIndex !== undefined
    ? model.funds[activeHover.fundIndex] ?? null
    : null;
  const hoveredShare = hoveredPoint && activeHover?.fundIndex !== null && activeHover?.fundIndex !== undefined
    ? fundValueShare(hoveredPoint, activeHover.fundIndex)
    : 0;
  const annualizedReturn = hoveredPoint && hoveredFund && hoveredFundValue
    ? annualizedReturnAt(hoveredFund.transactions, hoveredPoint.date, hoveredFundValue.value)
    : null;
  const latestPoint = visible.at(-1);

  return (
    <article className={`fund-stack-panel${lens.enabled ? " lens-active" : ""}${dragging ? " lens-dragging" : ""}`} data-panel-mode={mode} data-lens-enabled={lens.enabled} data-lens-x={lens.x.toFixed(4)} data-lens-y={lens.y.toFixed(4)} data-lens-magnification={lens.magnification} data-lens-size={lens.size}>
      <header><span><i className="stack-total-key" />{stackModeTitle(mode)}</span><strong className={(latestPoint ? modeTotal(latestPoint, mode) : 0) < 0 ? "negative" : ""}>{latestPoint ? formatInr(modeTotal(latestPoint, mode)) : "—"}</strong></header>
      <div ref={shellRef} className="fund-stack-shell">
        <canvas
          ref={canvasRef}
          className="stack-base-canvas"
          role="button"
          tabIndex={0}
          onClick={selectFromPointer}
          onKeyDown={selectFromKeyboard}
          onPointerDown={beginLensDrag}
          onPointerMove={movePointer}
          onPointerUp={finishLensDrag}
          onPointerCancel={finishLensDrag}
          onPointerLeave={(event) => {
            if (!dragRef.current) setHover(null);
            if (!dragRef.current) event.currentTarget.style.cursor = "crosshair";
          }}
          data-mode={mode}
          data-visible-points={visible.length}
          data-fund-count={model.funds.length}
          data-axis-min={scale.min}
          data-axis-max={scale.max}
          data-axis-step={scale.step}
          data-hovered-date={hoveredPoint?.date ?? ""}
          data-hovered-fund={hoveredFund?.key ?? ""}
          aria-label={`${stackModeTitle(mode)} stacked chart showing ${model.funds.length} funds from ${stackFormatDate(visible[0].date)} to ${stackFormatDate(visible.at(-1)?.date ?? visible[0].date)}. Hover for exact values, drag the circular lens to inspect thin layers, press Enter to select a date, or use left and right arrows for dates.`}
        />
        <canvas ref={lensCanvasRef} className="stack-lens-canvas" aria-hidden="true" />
        {activeHover && hoveredPoint && (
          <>
            {!activeHover.insideLens && <span className="stack-hover-guide" style={{ left: `${activeHover.x}px` }} />}
            <i className="stack-hover-marker" style={{ left: `${activeHover.x}px`, top: `${activeHover.y}px`, background: hoveredFund ? stackFundColor(activeHover.fundIndex ?? 0) : "#0B1D2A" }} />
            <div className="stack-hover-tooltip" role="status" data-fund-key={hoveredFund?.key ?? "portfolio-total"} data-date={hoveredPoint.date} style={{ left: `${activeHover.tooltipLeft}px` }}>
              <span className="stack-tooltip-date">{stackFormatDate(hoveredPoint.date)}</span>
              <strong>{hoveredFund?.name ?? "Portfolio total"}</strong>
              {hoveredFund && hoveredFundValue ? (
                <>
                  <small>{hoveredFund.category}{hoveredFund.closed ? " · Closed" : ""}</small>
                  <div><span>Fund value</span><b>{formatInr(hoveredFundValue.value)}</b></div>
                  <div><span>Net invested</span><b>{formatInr(hoveredFundValue.invested)}</b></div>
                  <div><span>Contribution</span><b className={hoveredFundValue.contribution < 0 ? "negative" : "positive"}>{formatInr(hoveredFundValue.contribution)}</b></div>
                  <div><span>Annualised return</span><b className={annualizedReturn !== null && annualizedReturn < 0 ? "negative" : annualizedReturn !== null ? "positive" : ""}>{annualizedReturn === null ? "—" : `${annualizedReturn.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% p.a.`}</b></div>
                  <footer><b>{hoveredShare.toFixed(2)}% of portfolio</b><span>Total {formatInr(hoveredPoint.totalValue)}</span></footer>
                </>
              ) : (
                <>
                  <div><span>Portfolio value</span><b>{formatInr(hoveredPoint.totalValue)}</b></div>
                  <div><span>Net invested</span><b>{formatInr(hoveredPoint.totalInvested)}</b></div>
                  <div><span>Contribution</span><b className={hoveredPoint.totalContribution < 0 ? "negative" : "positive"}>{formatInr(hoveredPoint.totalContribution)}</b></div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </article>
  );
}
