"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { formatInr } from "./formatters";
import {
  annualizedReturnAt,
  findStackFundIndexFromBounds,
  fundValueShare,
  stackBoundsForPoint,
  stackMetric,
  type FundStackMode,
  type FundStackModel,
  type FundStackPoint,
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

const niceStep = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const fraction = value / magnitude;
  return (fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10) * magnitude;
};

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

const chartScale = (points: FundStackPoint[], mode: FundStackMode) => {
  let highest = 0;
  let lowest = 0;
  for (const point of points) {
    const values = point.funds.map((fund) => stackMetric(fund, mode));
    highest = Math.max(highest, values.filter((value) => value > 0).reduce((total, value) => total + value, 0));
    lowest = Math.min(lowest, values.filter((value) => value < 0).reduce((total, value) => total + value, 0));
  }
  const observedSpan = Math.max(1, highest - lowest);
  const paddedMin = lowest < 0 ? lowest - observedSpan * 0.06 : 0;
  const paddedMax = highest + observedSpan * 0.06;
  const step = niceStep(Math.max(1, paddedMax - paddedMin) / 5);
  const min = lowest < 0 ? Math.floor(paddedMin / step) * step : 0;
  const max = Math.max(step, Math.ceil(paddedMax / step) * step);
  const ticks: number[] = [];
  for (let value = min; value <= max + step / 2 && ticks.length < 20; value += step) ticks.push(value);
  return { min, max, step, ticks };
};

type StackHover = {
  pointIndex: number;
  point: FundStackPoint;
  fundIndex: number | null;
  viewKey: string;
  x: number;
  y: number;
  tooltipLeft: number;
};

type FundStackPanelProps = {
  mode: FundStackMode;
  model: FundStackModel;
  visible: FundStackPoint[];
  visibleTimes: number[];
  selectedDate: string | null;
  viewKey: string;
  onSelectDate: (date: string, mode: FundStackMode) => void;
};

export default function FundStackPanel({
  mode,
  model,
  visible,
  visibleTimes,
  selectedDate,
  viewKey,
  onSelectDate,
}: FundStackPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<StackHover | null>(null);
  const scale = useMemo(() => chartScale(visible, mode), [mode, visible]);
  const bounds = useMemo(
    () => visible.map((point) => stackBoundsForPoint(point, mode)),
    [mode, visible],
  );

  const pointerToIndex = useCallback((clientX: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !visibleTimes.length) return 0;
    const left = rect.width < 360 ? 12 : 62;
    const right = 18;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left - left) / Math.max(1, rect.width - left - right)));
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

  const updateHover = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!visible.length) return;
    const padding = { left: rect.width < 360 ? 12 : 62, right: 18, top: 28, bottom: 40 };
    const chartHeight = rect.height - padding.top - padding.bottom;
    const localY = event.clientY - rect.top;
    if (localY < padding.top || localY > rect.height - padding.bottom) {
      setHover(null);
      return;
    }

    const pointIndex = pointerToIndex(event.clientX);
    const point = visible[pointIndex];
    const span = Math.max(1, scale.max - scale.min);
    const valueAtPointer = scale.max - ((localY - padding.top) / Math.max(1, chartHeight)) * span;
    const pointBounds = bounds[pointIndex] ?? [];
    const matchedIndex = findStackFundIndexFromBounds(pointBounds, valueAtPointer);
    const fundIndex = matchedIndex >= 0 ? matchedIndex : null;
    const fundBounds = fundIndex === null ? null : pointBounds[fundIndex];
    const markerValue = fundBounds ? (fundBounds.lower + fundBounds.upper) / 2 : modeTotal(point, mode);
    const firstTime = visibleTimes[0];
    const lastTime = visibleTimes.at(-1) ?? firstTime;
    const pointTime = visibleTimes[pointIndex];
    const chartWidth = rect.width - padding.left - padding.right;
    const x = visible.length === 1
      ? padding.left + chartWidth / 2
      : padding.left + ((pointTime - firstTime) / Math.max(1, lastTime - firstTime)) * chartWidth;
    const y = padding.top + ((scale.max - markerValue) / span) * chartHeight;
    const tooltipWidth = Math.min(218, rect.width - 16);
    const preferredLeft = x < rect.width / 2 ? x + 14 : x - tooltipWidth - 14;
    const tooltipLeft = Math.max(8, Math.min(rect.width - tooltipWidth - 8, preferredLeft));

    setHover((current) => current
      && current.point === point
      && current.fundIndex === fundIndex
      && current.viewKey === viewKey
      && Math.abs(current.x - x) < 0.5
      && Math.abs(current.y - y) < 0.5
        ? current
        : { pointIndex, point, fundIndex, viewKey, x, y, tooltipLeft });
  }, [bounds, mode, pointerToIndex, scale, viewKey, visible, visibleTimes]);

  const selectFromKeyboard = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (!visible.length) return;
    if (event.key === "Enter" || event.key === " ") {
      const visibleSelection = selectedDate && visible.some((point) => point.date === selectedDate)
        ? selectedDate
        : visible.at(-1)?.date;
      if (visibleSelection) onSelectDate(visibleSelection, mode);
      event.preventDefault();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const current = Math.max(0, visible.findIndex((point) => point.date === selectedDate));
    const next = Math.max(0, Math.min(visible.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1)));
    onSelectDate(visible[next].date, mode);
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
      context.beginPath();
      context.arc(x, yFor(modeTotal(visible[selectedIndex], mode)), 4, 0, Math.PI * 2);
      context.fill();
    }
  }, [bounds, mode, model.funds, scale, selectedDate, visible, visibleTimes]);

  useEffect(() => {
    draw();
    const observer = new ResizeObserver(() => {
      setHover(null);
      draw();
    });
    if (shellRef.current) observer.observe(shellRef.current);
    return () => observer.disconnect();
  }, [draw]);

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
    <article className="fund-stack-panel" data-panel-mode={mode}>
      <header><span><i className="stack-total-key" />{stackModeTitle(mode)}</span><strong className={(latestPoint ? modeTotal(latestPoint, mode) : 0) < 0 ? "negative" : ""}>{latestPoint ? formatInr(modeTotal(latestPoint, mode)) : "—"}</strong></header>
      <div ref={shellRef} className="fund-stack-shell">
        <canvas
          ref={canvasRef}
          role="button"
          tabIndex={0}
          onClick={(event) => {
            const date = visible[pointerToIndex(event.clientX)]?.date;
            if (date) onSelectDate(date, mode);
          }}
          onKeyDown={selectFromKeyboard}
          onPointerMove={updateHover}
          onPointerLeave={() => setHover(null)}
          data-mode={mode}
          data-visible-points={visible.length}
          data-fund-count={model.funds.length}
          data-hovered-date={hoveredPoint?.date ?? ""}
          data-hovered-fund={hoveredFund?.key ?? ""}
          aria-label={`${stackModeTitle(mode)} stacked chart showing ${model.funds.length} funds from ${stackFormatDate(visible[0].date)} to ${stackFormatDate(visible.at(-1)?.date ?? visible[0].date)}. Press Enter to select a date, then use arrow keys.`}
        />
        {activeHover && hoveredPoint && (
          <>
            <span className="stack-hover-guide" style={{ left: `${activeHover.x}px` }} />
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
