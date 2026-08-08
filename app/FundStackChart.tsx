"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Portfolio } from "./cas-parser";
import { formatInr } from "./formatters";
import {
  buildFundStackModel,
  maxStackReconciliationDifference,
  stackMetric,
  type FundStackMode,
  type FundStackPoint,
} from "./fund-stack-service";
import { useRangeWindowDrag } from "./useRangeWindowDrag";

const MODES: Array<{ key: FundStackMode; label: string }> = [
  { key: "value", label: "Value" },
  { key: "invested", label: "Invested" },
  { key: "contribution", label: "Contribution" },
];

const modeTotal = (point: FundStackPoint, mode: FundStackMode) => {
  if (mode === "value") return point.totalValue;
  if (mode === "invested") return point.totalInvested;
  return point.totalContribution;
};

const modeTitle = (mode: FundStackMode) => {
  if (mode === "value") return "Total fund value";
  if (mode === "invested") return "Total lifetime net invested";
  return "Net contribution";
};

const fundColor = (index: number) =>
  `hsl(${Math.round((152 + index * 137.508) % 360)} 56% ${index % 3 === 0 ? 42 : index % 3 === 1 ? 52 : 62}%)`;

const formatDate = (date: string) =>
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

export default function FundStackChart({ portfolio }: { portfolio: Portfolio }) {
  const headingId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const model = useMemo(() => buildFundStackModel(portfolio), [portfolio]);
  const [mode, setMode] = useState<FundStackMode>("value");
  const [range, setRange] = useState<[number, number]>([0, Math.max(1, model.points.length - 1)]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const priorPoints = useRef(model.points);
  const rangeWindowDrag = useRangeWindowDrag({ range, setRange, totalPoints: model.points.length });

  useEffect(() => {
    const prior = priorPoints.current;
    if (prior === model.points) return;
    setRange(([start, end]) => {
      if (model.points.length < 2) return [0, Math.max(1, model.points.length - 1)];
      if (start === 0 && end >= prior.length - 1) return [0, model.points.length - 1];
      const startDate = prior[start]?.date;
      const endDate = prior[end]?.date;
      const nextStart = startDate
        ? Math.max(0, model.points.findIndex((point) => point.date >= startDate))
        : 0;
      const nextEnd = endDate
        ? model.points.findLastIndex((point) => point.date <= endDate)
        : model.points.length - 1;
      return [nextStart, Math.max(nextStart + 1, nextEnd)];
    });
    priorPoints.current = model.points;
  }, [model.points]);

  const visible = useMemo(
    () => model.points.slice(range[0], Math.min(model.points.length, range[1] + 1)),
    [model.points, range],
  );

  const selectPeriod = (months: number | "all") => {
    if (months === "all" || model.points.length < 2) {
      setRange([0, Math.max(1, model.points.length - 1)]);
      return;
    }
    const cutoff = new Date(`${model.points.at(-1)?.date}T00:00:00Z`);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
    const start = model.points.findIndex((point) => new Date(`${point.date}T00:00:00Z`) >= cutoff);
    setRange([Math.max(0, start), model.points.length - 1]);
  };

  const pointerToIndex = useCallback((clientX: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !visible.length) return 0;
    const left = rect.width < 640 ? 12 : 72;
    const right = 20;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left - left) / Math.max(1, rect.width - left - right)));
    const first = new Date(`${visible[0].date}T00:00:00Z`).getTime();
    const last = new Date(`${visible.at(-1)?.date}T00:00:00Z`).getTime();
    const target = first + ratio * Math.max(1, last - first);
    return visible.reduce((nearest, point, index) => {
      const time = new Date(`${point.date}T00:00:00Z`).getTime();
      const nearestTime = new Date(`${visible[nearest].date}T00:00:00Z`).getTime();
      return Math.abs(time - target) < Math.abs(nearestTime - target) ? index : nearest;
    }, 0);
  }, [visible]);

  const selectFromKeyboard = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (!visible.length) return;
    if (event.key === "Enter" || event.key === " ") {
      setSelectedDate(selectedDate ?? visible.at(-1)?.date ?? null);
      event.preventDefault();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const current = Math.max(0, visible.findIndex((point) => point.date === selectedDate));
    const next = Math.max(0, Math.min(visible.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1)));
    setSelectedDate(visible[next].date);
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

    const padding = { left: width < 640 ? 12 : 72, right: 20, top: 28, bottom: 40 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const scale = chartScale(visible, mode);
    const span = Math.max(1, scale.max - scale.min);
    const firstTime = new Date(`${visible[0].date}T00:00:00Z`).getTime();
    const lastTime = new Date(`${visible.at(-1)?.date}T00:00:00Z`).getTime();
    const timeSpan = Math.max(1, lastTime - firstTime);
    const xFor = (index: number) => visible.length === 1
      ? padding.left + chartWidth / 2
      : padding.left + ((new Date(`${visible[index].date}T00:00:00Z`).getTime() - firstTime) / timeSpan) * chartWidth;
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
      if (width >= 640) {
        context.fillStyle = "#728078";
        context.textAlign = "right";
        context.fillText(axisMoney(tick, scale.step), padding.left - 11, y);
      }
    }
    context.setLineDash([]);

    const bounds = visible.map((point) => {
      let positive = 0;
      let negative = 0;
      return point.funds.map((fund) => {
        const amount = stackMetric(fund, mode);
        if (amount >= 0) {
          const lower = positive;
          positive += amount;
          return { lower, upper: positive };
        }
        const upper = negative;
        negative += amount;
        return { lower: negative, upper };
      });
    });

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
      context.fillStyle = fundColor(fundIndex);
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

    const labelCount = width < 640 ? 3 : 5;
    context.fillStyle = "#728078";
    context.textAlign = "center";
    for (let label = 0; label < labelCount; label += 1) {
      const target = firstTime + timeSpan * label / Math.max(1, labelCount - 1);
      const nearest = visible.reduce((best, point, index) => {
        const time = new Date(`${point.date}T00:00:00Z`).getTime();
        const bestTime = new Date(`${visible[best].date}T00:00:00Z`).getTime();
        return Math.abs(time - target) < Math.abs(bestTime - target) ? index : best;
      }, 0);
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
  }, [mode, model.funds, selectedDate, visible]);

  useEffect(() => {
    draw();
    const observer = new ResizeObserver(draw);
    if (shellRef.current) observer.observe(shellRef.current);
    return () => observer.disconnect();
  }, [draw]);

  const selectedPoint = selectedDate
    ? visible.find((point) => point.date === selectedDate) ?? null
    : null;
  const ranked = selectedPoint
    ? selectedPoint.funds
      .map((fund, index) => ({ ...fund, fund: model.funds[index], index, amount: stackMetric(fund, mode) }))
      .sort((left, right) => right.amount - left.amount)
    : [];
  const positiveRanked = mode === "contribution" ? ranked.filter((item) => item.amount >= 0) : ranked;
  const negativeRanked = mode === "contribution"
    ? ranked.filter((item) => item.amount < 0).sort((left, right) => left.amount - right.amount)
    : [];
  const selectedTotal = selectedPoint ? modeTotal(selectedPoint, mode) : 0;
  const reconciliationDifference = maxStackReconciliationDifference(model);

  const renderRows = (rows: typeof ranked, offset = 0) => {
    const shareBase = mode === "contribution"
      ? rows.reduce((total, row) => total + Math.abs(row.amount), 0)
      : Math.abs(selectedTotal);
    return rows.map((item, index) => {
      const share = shareBase ? Math.abs(item.amount) / shareBase * 100 : 0;
      return (
        <div className="stack-ranking-row" key={item.fundKey}>
          <span className="stack-rank">{String(offset + index + 1).padStart(2, "0")}</span>
          <span className="stack-fund"><i style={{ background: fundColor(item.index) }} /><span><strong>{item.fund.name}</strong><small>{item.fund.category}{item.fund.closed ? " · Closed" : ""}</small></span></span>
          <span className={item.amount < 0 ? "negative" : mode === "contribution" ? "positive" : ""}><strong>{formatInr(item.amount)}</strong><small>{share.toFixed(1)}% of {mode === "contribution" ? "this side" : "total"}</small></span>
        </div>
      );
    });
  };

  return (
    <section className="fund-stack-card" aria-labelledby={headingId}>
      <div className="stack-chart-head">
        <div><p className="eyebrow">Every fund, one total</p><h2 id={headingId}>Fund contribution over time</h2></div>
        <div className="stack-chart-controls">
          <div className="stack-modes" aria-label="Stacked chart view">
            {MODES.map((item) => <button type="button" key={item.key} className={mode === item.key ? "active" : ""} aria-pressed={mode === item.key} onClick={() => setMode(item.key)}>{item.label}</button>)}
          </div>
          <div className="periods" aria-label="Stacked chart period">
            <button onClick={() => selectPeriod(12)}>1Y</button><button onClick={() => selectPeriod(24)}>2Y</button><button onClick={() => selectPeriod(36)}>3Y</button><button onClick={() => selectPeriod(60)}>5Y</button><button onClick={() => selectPeriod("all")}>All</button>
          </div>
        </div>
      </div>
      <div className="stack-chart-meta">
        <span><i className="stack-total-key" />{modeTitle(mode)}</span>
        <span>{model.funds.length} funds · all shown</span>
        <em>Click any date to open the full ranked list</em>
      </div>
      {visible.length > 1 ? (
        <div ref={shellRef} className="fund-stack-shell">
          <canvas
            ref={canvasRef}
            role="button"
            tabIndex={0}
            onClick={(event) => setSelectedDate(visible[pointerToIndex(event.clientX)]?.date ?? null)}
            onKeyDown={selectFromKeyboard}
            data-mode={mode}
            data-total-points={model.points.length}
            data-visible-points={visible.length}
            data-fund-count={model.funds.length}
            data-reconciliation-difference={reconciliationDifference}
            aria-label={`${modeTitle(mode)} stacked chart showing ${model.funds.length} funds from ${formatDate(visible[0].date)} to ${formatDate(visible.at(-1)?.date ?? visible[0].date)}. Press Enter to select a date, then use arrow keys.`}
          />
        </div>
      ) : <div className="fund-stack-empty">Complete same-day fund values will appear after published NAV history finishes loading.</div>}
      {model.points.length > 1 && (
        <div className="stack-range-control">
          <div className="range-track" aria-label="Visible stacked chart range">
            <div
              className={`range-fill${rangeWindowDrag.movable ? " draggable" : ""}`}
              role="slider"
              aria-label="Move visible stacked chart window"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, model.points.length - (range[1] - range[0] + 1))}
              aria-valuenow={range[0]}
              aria-valuetext={`${formatDate(model.points[range[0]]?.date ?? model.points[0].date)} to ${formatDate(model.points[range[1]]?.date ?? model.points.at(-1)?.date ?? model.points[0].date)}`}
              tabIndex={rangeWindowDrag.movable ? 0 : -1}
              onKeyDown={rangeWindowDrag.onKeyDown}
              onPointerCancel={rangeWindowDrag.onPointerCancel}
              onPointerDown={rangeWindowDrag.onPointerDown}
              onPointerMove={rangeWindowDrag.onPointerMove}
              onPointerUp={rangeWindowDrag.onPointerUp}
              style={{ left: `${range[0] / Math.max(1, model.points.length - 1) * 100}%`, right: `${100 - range[1] / Math.max(1, model.points.length - 1) * 100}%` }}
            />
            <input aria-label="Stacked chart start" type="range" min={0} max={Math.max(1, model.points.length - 2)} value={range[0]} onChange={(event) => setRange([Math.min(Number(event.target.value), range[1] - 1), range[1]])} />
            <input aria-label="Stacked chart end" type="range" min={1} max={Math.max(1, model.points.length - 1)} value={range[1]} onChange={(event) => setRange([range[0], Math.max(Number(event.target.value), range[0] + 1)])} />
          </div>
        </div>
      )}
      {selectedPoint && (
        <section className="stack-ranking-panel" aria-label={`Fund ranking on ${formatDate(selectedPoint.date)}`}>
          <header><div><span>Selected date</span><strong>{formatDate(selectedPoint.date)}</strong></div><div><span>{modeTitle(mode)}</span><strong className={selectedTotal < 0 ? "negative" : ""}>{formatInr(selectedTotal)}</strong></div><button type="button" onClick={() => setSelectedDate(null)} aria-label="Close fund ranking">×</button></header>
          <div className="stack-ranking-scroll" role="region" aria-label={`All funds ranked by ${mode}`}>
            {mode === "contribution" && <div className="stack-ranking-group positive">Positive contribution</div>}
            {renderRows(positiveRanked)}
            {mode === "contribution" && negativeRanked.length > 0 && <div className="stack-ranking-group negative">Negative contribution</div>}
            {renderRows(negativeRanked, positiveRanked.length)}
          </div>
          <p>Showing all {model.funds.length} funds · the first eight are visible; scroll for the rest.</p>
        </section>
      )}
      <p className="stack-chart-note"><strong>Reconciled stack:</strong> {portfolio.source === "demo"
        ? "every demo fund is included in a stable order using the illustrative demo allocation."
        : "every active and closed CAS fund is included in a stable order. Historical points appear only when exact same-day NAVs are available for every fund held on that date; missing dates are not estimated."}</p>
    </section>
  );
}
