"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { TimelinePoint } from "./cas-parser";
import { buildChartScale } from "./chart-scale";
import { formatInr } from "./formatters";
import { useRangeWindowDrag } from "./useRangeWindowDrag";

type PortfolioChartProps = {
  points: TimelinePoint[];
  eyebrow?: string;
  title?: string;
  valueLabel?: string;
  note?: string;
  compact?: boolean;
  showBelowCost?: boolean;
};

const axisMoney = (value: number, step: number) => {
  const absolute = Math.abs(value);
  const formatUnit = (divisor: number, suffix: string) => {
    const unitStep = Math.abs(step / divisor);
    const decimals = unitStep >= 1 ? 0 : unitStep >= 0.1 ? 1 : unitStep >= 0.01 ? 2 : 3;
    return `₹${(value / divisor).toFixed(decimals)}${suffix}`;
  };
  if (absolute >= 10_000_000) return formatUnit(10_000_000, "Cr");
  if (absolute >= 100_000) return formatUnit(100_000, "L");
  if (absolute >= 1_000) return formatUnit(1_000, "K");
  return `₹${Math.round(value)}`;
};

const fullMoney = (value: number) => formatInr(value);

const prettyDate = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00Z`));

const fullDate = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00Z`));

export default function PortfolioChart({
  points,
  eyebrow = "Portfolio journey",
  title = "Value over time",
  valueLabel = "Portfolio value",
  note = "daily points use actual published AMFI NAV observations. CAS transaction dates remain exact, and missing dates are skipped rather than estimated.",
  compact = false,
  showBelowCost = false,
}: PortfolioChartProps) {
  const headingId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<[number, number]>([0, Math.max(1, points.length - 1)]);
  const [hovered, setHovered] = useState<number | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>();
  const [animate, setAnimate] = useState(0);
  const [showInvested, setShowInvested] = useState(true);
  const previousPoints = useRef(points);
  const rangeWindowDrag = useRangeWindowDrag({ range, setRange, totalPoints: points.length });

  useEffect(() => {
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const next = Math.min(1, (now - started) / 720);
      setAnimate(1 - Math.pow(1 - next, 3));
      if (next < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const prior = previousPoints.current;
    if (prior === points) return;
    setRange(([start, end]) => {
      if (points.length < 2) return [0, Math.max(1, points.length - 1)];
      if (start === 0 && end >= prior.length - 1) return [0, points.length - 1];
      const startDate = prior[start]?.date;
      const endDate = prior[end]?.date;
      const nextStart = startDate
        ? Math.max(0, points.findIndex((point) => point.date >= startDate))
        : 0;
      const nextEndCandidate = endDate
        ? points.findLastIndex((point) => point.date <= endDate)
        : points.length - 1;
      return [nextStart, Math.max(nextStart + 1, nextEndCandidate)];
    });
    previousPoints.current = points;
    setHovered(null);
    setTooltipStyle(undefined);
  }, [points]);

  const visible = useMemo(
    () => points.slice(range[0], Math.min(points.length, range[1] + 1)),
    [points, range],
  );

  const zoom = useCallback(
    (direction: "in" | "out") => {
      setRange(([start, end]) => {
        const current = end - start + 1;
        const minimum = Math.min(6, points.length);
        const target = direction === "in" ? Math.max(minimum, Math.floor(current * 0.72)) : Math.min(points.length, Math.ceil(current * 1.38));
        const center = (start + end) / 2;
        let nextStart = Math.round(center - target / 2);
        let nextEnd = nextStart + target - 1;
        if (nextStart < 0) {
          nextEnd -= nextStart;
          nextStart = 0;
        }
        if (nextEnd >= points.length) {
          nextStart -= nextEnd - points.length + 1;
          nextEnd = points.length - 1;
        }
        return [Math.max(0, nextStart), Math.max(1, Math.min(points.length - 1, nextEnd))];
      });
    },
    [points.length],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const shell = shellRef.current;
    if (!canvas || !shell || visible.length < 2) return;
    const width = shell.clientWidth;
    const height = compact ? 278 : 360;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(dpr, dpr);

    const padding = { left: width < 560 ? 10 : 64, right: 18, top: 92, bottom: 38 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const scale = buildChartScale(visible, showInvested);
    const { max, min } = scale;
    const span = Math.max(1, max - min);
    const timeFor = (point: TimelinePoint) => new Date(`${point.date}T00:00:00Z`).getTime();
    const firstTime = timeFor(visible[0]);
    const timeSpan = Math.max(1, timeFor(visible.at(-1) as TimelinePoint) - firstTime);
    const xFor = (index: number) => padding.left + ((timeFor(visible[index]) - firstTime) / timeSpan) * chartWidth;
    const yFor = (value: number) => padding.top + ((max - value) / span) * chartHeight;

    context.clearRect(0, 0, width, height);
    context.font = "11px Arial, sans-serif";
    context.textBaseline = "middle";
    [...scale.ticks].reverse().forEach((tick) => {
      const y = padding.top + ((max - tick) / span) * chartHeight;
      context.strokeStyle = "rgba(11, 29, 42, 0.09)";
      context.lineWidth = 1;
      context.setLineDash([3, 6]);
      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(width - padding.right, y);
      context.stroke();
      context.setLineDash([]);
      if (width >= 560) {
        context.fillStyle = "#728078";
        context.textAlign = "right";
        context.fillText(axisMoney(tick, scale.step), padding.left - 12, y);
      }
    });

    const areaGradient = context.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    areaGradient.addColorStop(0, "rgba(91, 219, 150, 0.26)");
    areaGradient.addColorStop(1, "rgba(91, 219, 150, 0.01)");
    context.beginPath();
    visible.forEach((point, index) => {
      const x = xFor(index);
      const y = yFor(point.value);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.lineTo(xFor(visible.length - 1), height - padding.bottom);
    context.lineTo(xFor(0), height - padding.bottom);
    context.closePath();
    context.fillStyle = areaGradient;
    context.fill();

    const drawLine = (field: "value" | "invested", color: string, dashed = false) => {
      context.save();
      context.beginPath();
      context.rect(padding.left, padding.top, chartWidth * animate, chartHeight + 4);
      context.clip();
      context.beginPath();
      visible.forEach((point, index) => {
        const x = xFor(index);
        const y = yFor(point[field]);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = color;
      context.lineWidth = field === "value" ? 3 : 2;
      context.lineJoin = "round";
      context.lineCap = "round";
      if (dashed) context.setLineDash([6, 6]);
      context.stroke();
      context.restore();
    };
    if (showInvested) drawLine("invested", "#95A099", true);
    drawLine("value", "#1D9D61");

    if (showBelowCost && showInvested) {
      context.save();
      context.strokeStyle = "#D65E4B";
      context.lineWidth = 3.4;
      context.lineJoin = "round";
      context.lineCap = "round";
      for (let index = 1; index < visible.length; index += 1) {
        const previous = visible[index - 1];
        const current = visible[index];
        const previousGap = previous.value - previous.invested;
        const currentGap = current.value - current.invested;
        if (previousGap >= 0 && currentGap >= 0) continue;

        let startRatio = 0;
        let endRatio = 1;
        const crossingRatio = previousGap === currentGap ? 0 : -previousGap / (currentGap - previousGap);
        if (previousGap >= 0) startRatio = Math.max(0, Math.min(1, crossingRatio));
        if (currentGap >= 0) endRatio = Math.max(0, Math.min(1, crossingRatio));
        const startX = xFor(index - 1) + (xFor(index) - xFor(index - 1)) * startRatio;
        const endX = xFor(index - 1) + (xFor(index) - xFor(index - 1)) * endRatio;
        const startValue = previous.value + (current.value - previous.value) * startRatio;
        const endValue = previous.value + (current.value - previous.value) * endRatio;
        context.beginPath();
        context.moveTo(startX, yFor(startValue));
        context.lineTo(endX, yFor(endValue));
        context.stroke();
      }
      context.restore();
    }

    const drawDiamond = (x: number, y: number, size: number) => {
      context.beginPath();
      context.moveTo(x, y - size);
      context.lineTo(x + size, y);
      context.lineTo(x, y + size);
      context.lineTo(x - size, y);
      context.closePath();
    };

    visible.forEach((point, index) => {
      if (!point.transaction || (point.transactionAmount ?? 0) <= 0) return;
      const x = xFor(index);
      const y = yFor(point.value);
      context.fillStyle = "#087A4B";
      context.strokeStyle = "#F8F6EF";
      context.lineWidth = 1.4;
      drawDiamond(x, y, 4.5);
      context.fill();
      context.stroke();
    });

    const labelCount = width < 560 ? 3 : 5;
    context.fillStyle = "#728078";
    context.textAlign = "center";
    for (let index = 0; index < labelCount; index += 1) {
      const targetTime = firstTime + (timeSpan * index) / Math.max(1, labelCount - 1);
      const pointIndex = visible.reduce((nearest, point, pointIndex) =>
        Math.abs(timeFor(point) - targetTime) < Math.abs(timeFor(visible[nearest]) - targetTime) ? pointIndex : nearest,
      0);
      context.fillText(prettyDate(visible[pointIndex].date), xFor(pointIndex), height - 15);
    }

    if (hovered !== null && visible[hovered]) {
      const x = xFor(hovered);
      const y = yFor(visible[hovered].value);
      context.strokeStyle = "rgba(11, 29, 42, 0.24)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, padding.top);
      context.lineTo(x, height - padding.bottom);
      context.stroke();
      if (visible[hovered].transaction && (visible[hovered].transactionAmount ?? 0) > 0) {
        context.fillStyle = "#087A4B";
        context.strokeStyle = "#F8F6EF";
        context.lineWidth = 1.8;
        drawDiamond(x, y, 7);
        context.fill();
        context.stroke();
      } else {
        context.fillStyle = "#F8F6EF";
        context.strokeStyle = "#1D9D61";
        context.lineWidth = 3;
        context.beginPath();
        context.arc(x, y, 5.5, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      }
    }
  }, [animate, compact, hovered, showBelowCost, showInvested, visible]);

  useEffect(() => {
    draw();
    const observer = new ResizeObserver(draw);
    if (shellRef.current) observer.observe(shellRef.current);
    return () => observer.disconnect();
  }, [draw]);

  const selectPeriod = (months: number | "all") => {
    if (months === "all") {
      setRange([0, points.length - 1]);
      return;
    }
    const cutoff = new Date(`${points.at(-1)?.date ?? ""}T00:00:00Z`);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
    const start = Math.max(0, points.findIndex((point) => new Date(`${point.date}T00:00:00Z`) >= cutoff));
    setRange([start, points.length - 1]);
  };

  const pointerToIndex = (clientX: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const left = rect.width < 560 ? 10 : 64;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left - left) / Math.max(1, rect.width - left - 18)));
    const first = new Date(`${visible[0]?.date}T00:00:00Z`).getTime();
    const last = new Date(`${visible.at(-1)?.date}T00:00:00Z`).getTime();
    const target = first + ratio * Math.max(1, last - first);
    return visible.reduce((nearest, point, index) => {
      const distance = Math.abs(new Date(`${point.date}T00:00:00Z`).getTime() - target);
      const nearestDistance = Math.abs(new Date(`${visible[nearest].date}T00:00:00Z`).getTime() - target);
      return distance < nearestDistance ? index : nearest;
    }, 0);
  };

  const hoverPoint = hovered !== null ? visible[hovered] : null;
  const positionTooltip = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const rect = canvas.getBoundingClientRect();
    const tooltipWidth = compact ? 168 : 184;
    const left = Math.max(8, Math.min(rect.width - tooltipWidth - 8, clientX - rect.left - tooltipWidth / 2));
    return {
      position: "absolute" as const,
      left: `${left}px`,
      top: "8px",
      width: `${tooltipWidth}px`,
      transform: "none",
    };
  };

  return (
    <section className={`chart-card ${compact ? "fund-journey-card" : ""}`} aria-labelledby={headingId}>
      <div className="chart-head">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2 id={headingId}>{title}</h2>
        </div>
        <div className="chart-actions" aria-label="Chart controls">
          <div className="periods" aria-label="Time period">
            <button onClick={() => selectPeriod(12)}>1Y</button>
            <button onClick={() => selectPeriod(24)}>2Y</button>
            <button onClick={() => selectPeriod(36)}>3Y</button>
            <button onClick={() => selectPeriod(60)}>5Y</button>
            <button onClick={() => selectPeriod("all")}>All</button>
          </div>
          <div className="zoom-controls">
            <button onClick={() => zoom("out")} aria-label="Zoom out">−</button>
            <button onClick={() => zoom("in")} aria-label="Zoom in">+</button>
          </div>
        </div>
      </div>
      <div className="chart-legend">
        <span><i className="legend-dot value" />{valueLabel}</span>
        <button
          type="button"
          className={`chart-series-toggle${showInvested ? " active" : ""}`}
          aria-pressed={showInvested}
          aria-label={`${showInvested ? "Hide" : "Show"} net invested line`}
          title={`${showInvested ? "Hide" : "Show"} net invested line`}
          onClick={() => setShowInvested((current) => !current)}
        >
          <i className="legend-line" />
          <b>Net invested</b>
          <em aria-hidden="true"><i /></em>
        </button>
        <span><i className="legend-line daily" />Daily NAV values</span>
        <span><i className="legend-point transaction" />CAS investment</span>
        {showBelowCost && showInvested && <span><i className="legend-line below" />Below invested</span>}
        <span className="chart-hint">Drag the highlighted range to move the timeline</span>
      </div>
      <div
        ref={shellRef}
        className="chart-shell"
        onPointerDown={(event) => {
          if (event.pointerType !== "touch") return;
          setHovered(pointerToIndex(event.clientX));
          setTooltipStyle(positionTooltip(event.clientX));
        }}
        onPointerMove={(event) => {
          setHovered(pointerToIndex(event.clientX));
          setTooltipStyle(positionTooltip(event.clientX));
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "touch") return;
          setHovered(null);
          setTooltipStyle(undefined);
        }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          data-total-points={points.length}
          data-visible-points={visible.length}
          data-daily-points={points.filter((point) => point.daily).length}
          data-transaction-points={points.filter((point) => point.transaction).length}
          data-investment-points={points.filter((point) => point.transaction && (point.transactionAmount ?? 0) > 0).length}
          data-show-invested={showInvested}
          aria-label={`${valueLabel} chart from ${prettyDate(visible[0]?.date ?? points[0]?.date)} to ${prettyDate(visible.at(-1)?.date ?? points.at(-1)?.date)}`}
        />
        {hoverPoint && tooltipStyle && (
          <div className="chart-tooltip" style={tooltipStyle}>
            <span className="tooltip-date">
              {fullDate(hoverPoint.date)}
              <span className="tooltip-flags" aria-label={[hoverPoint.transaction && (hoverPoint.transactionAmount ?? 0) > 0 && "CAS investment", hoverPoint.daily && "Daily NAV observation", hoverPoint.live && "Latest AMFI NAV", hoverPoint.exact && "Statement value"].filter(Boolean).join(", ")}>
                {hoverPoint.transaction && (hoverPoint.transactionAmount ?? 0) > 0 && <i className="tooltip-flag transaction" title="CAS investment">◆</i>}
                {hoverPoint.daily && <i className="tooltip-flag daily" title="Daily AMFI NAV">●</i>}
                {hoverPoint.live && <i className="tooltip-flag live" title="Latest AMFI NAV">L</i>}
                {hoverPoint.exact && !hoverPoint.live && <i className="tooltip-flag exact" title="Statement value">S</i>}
              </span>
            </span>
            <strong>{fullMoney(hoverPoint.value)}</strong>
            {showInvested
              ? <small>Invested {fullMoney(hoverPoint.invested)}{hoverPoint.nav ? ` · NAV ${hoverPoint.nav.toFixed(4)}` : ""}</small>
              : hoverPoint.nav && <small>NAV {hoverPoint.nav.toFixed(4)}</small>}
            <small>{hoverPoint.transaction
              ? `Transaction ${(hoverPoint.transactionAmount ?? 0) >= 0 ? "+" : "−"}${fullMoney(Math.abs(hoverPoint.transactionAmount ?? 0))}${(hoverPoint.transactionCount ?? 0) > 1 ? ` · ${hoverPoint.transactionCount} entries` : ""}`
              : hoverPoint.daily ? "Official daily valuation" : "Observed portfolio value"}</small>
          </div>
        )}
      </div>
      <div className="range-track" aria-label="Visible chart range">
        <div
          className={`range-fill${rangeWindowDrag.movable ? " draggable" : ""}`}
          role="slider"
          aria-label="Move visible chart window"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, points.length - (range[1] - range[0] + 1))}
          aria-valuenow={range[0]}
          aria-valuetext={`${fullDate(points[range[0]]?.date ?? points[0]?.date)} to ${fullDate(points[range[1]]?.date ?? points.at(-1)?.date)}`}
          tabIndex={rangeWindowDrag.movable ? 0 : -1}
          title={rangeWindowDrag.movable ? "Drag to move the selected timeframe" : undefined}
          onKeyDown={rangeWindowDrag.onKeyDown}
          onPointerCancel={rangeWindowDrag.onPointerCancel}
          onPointerDown={rangeWindowDrag.onPointerDown}
          onPointerMove={rangeWindowDrag.onPointerMove}
          onPointerUp={rangeWindowDrag.onPointerUp}
          style={{ left: `${(range[0] / Math.max(1, points.length - 1)) * 100}%`, right: `${100 - (range[1] / Math.max(1, points.length - 1)) * 100}%` }}
        />
        <input
          aria-label="Chart start"
          type="range"
          min={0}
          max={Math.max(1, points.length - 2)}
          value={range[0]}
          onChange={(event) => setRange([Math.min(Number(event.target.value), range[1] - 1), range[1]])}
        />
        <input
          aria-label="Chart end"
          type="range"
          min={1}
          max={Math.max(1, points.length - 1)}
          value={range[1]}
          onChange={(event) => setRange([range[0], Math.max(Number(event.target.value), range[0] + 1)])}
        />
      </div>
      <p className="chart-note"><strong>How this is calculated:</strong> {note}</p>
    </section>
  );
}
