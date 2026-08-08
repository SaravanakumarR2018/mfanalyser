"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { FundTransaction, HistoricalNavPoint } from "./cas-parser";
import { buildNavPoints, type NavActivityPoint } from "./nav-activity-service";

type NavActivityChartProps = {
  transactions: FundTransaction[];
  weeklyNav?: HistoricalNavPoint[];
  nav: number;
  navDate: string;
  liveNav?: boolean;
};

const formatDate = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(`${date}T00:00:00Z`));

const compactDate = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" })
    .format(new Date(`${date}T00:00:00Z`));

const formatMoney = (value: number, digits = 0) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

export default function NavActivityChart({ transactions, weeklyNav, nav, navDate, liveNav }: NavActivityChartProps) {
  const titleId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const allPoints = useMemo(
    () => buildNavPoints(transactions, weeklyNav, nav, navDate),
    [nav, navDate, transactions, weeklyNav],
  );
  const [period, setPeriod] = useState<12 | 36 | "all">("all");
  const [hovered, setHovered] = useState<number | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>();

  const points = useMemo(() => {
    if (period === "all" || allPoints.length < 2) return allPoints;
    const cutoff = new Date(`${allPoints.at(-1)?.date}T00:00:00Z`);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - period);
    const filtered = allPoints.filter((point) => new Date(`${point.date}T00:00:00Z`) >= cutoff);
    return filtered.length >= 2 ? filtered : allPoints.slice(-2);
  }, [allPoints, period]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const shell = shellRef.current;
    if (!canvas || !shell || !points.length) return;
    const width = shell.clientWidth;
    const height = 250;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(dpr, dpr);

    const padding = { left: width < 510 ? 12 : 55, right: 17, top: 75, bottom: 32 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const minNav = Math.min(...points.map((point) => point.nav));
    const maxNav = Math.max(...points.map((point) => point.nav));
    const navPadding = Math.max((maxNav - minNav) * 0.18, maxNav * 0.025, 0.5);
    const low = Math.max(0, minNav - navPadding);
    const high = maxNav + navPadding;
    const span = Math.max(0.01, high - low);
    const timeFor = (point: NavActivityPoint) => new Date(`${point.date}T00:00:00Z`).getTime();
    const firstTime = timeFor(points[0]);
    const lastTime = timeFor(points.at(-1) as NavActivityPoint);
    const timeSpan = Math.max(1, lastTime - firstTime);
    const xFor = (index: number) => points.length === 1
      ? padding.left + chartWidth / 2
      : padding.left + ((timeFor(points[index]) - firstTime) / timeSpan) * chartWidth;
    const yFor = (value: number) => padding.top + ((high - value) / span) * chartHeight;

    context.clearRect(0, 0, width, height);
    context.font = "10px Arial, sans-serif";
    context.textBaseline = "middle";
    for (let line = 0; line <= 3; line += 1) {
      const y = padding.top + (chartHeight / 3) * line;
      context.strokeStyle = "rgba(11, 29, 42, 0.09)";
      context.setLineDash([3, 5]);
      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(width - padding.right, y);
      context.stroke();
      context.setLineDash([]);
      if (width >= 510) {
        context.fillStyle = "#7D8A83";
        context.textAlign = "right";
        context.fillText(formatMoney(high - (span / 3) * line, 2), padding.left - 8, y);
      }
    }

    if (points.length > 1) {
      const gradient = context.createLinearGradient(0, padding.top, 0, height - padding.bottom);
      gradient.addColorStop(0, "rgba(91, 219, 150, 0.22)");
      gradient.addColorStop(1, "rgba(91, 219, 150, 0.01)");
      context.beginPath();
      points.forEach((point, index) => {
        if (index === 0) context.moveTo(xFor(index), yFor(point.nav));
        else context.lineTo(xFor(index), yFor(point.nav));
      });
      context.lineTo(xFor(points.length - 1), height - padding.bottom);
      context.lineTo(xFor(0), height - padding.bottom);
      context.closePath();
      context.fillStyle = gradient;
      context.fill();

      context.beginPath();
      points.forEach((point, index) => {
        if (index === 0) context.moveTo(xFor(index), yFor(point.nav));
        else context.lineTo(xFor(index), yFor(point.nav));
      });
      context.strokeStyle = "#1D9D61";
      context.lineWidth = 2.5;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.stroke();
    }

    points.forEach((point, index) => {
      const x = xFor(index);
      const y = yFor(point.nav);
      if (point.weekly || point.latest) {
        context.fillStyle = "#FDFCF7";
        context.strokeStyle = "#1D9D61";
        context.lineWidth = point.latest ? 2.2 : 1;
        context.beginPath();
        context.arc(x, y, point.latest ? 4.5 : 2.1, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      }
      if (point.transaction) {
        context.fillStyle = "#FF715B";
        context.strokeStyle = "#FDFCF7";
        context.lineWidth = 1.2;
        context.beginPath();
        context.moveTo(x, y - 5.5);
        context.lineTo(x + 5.5, y);
        context.lineTo(x, y + 5.5);
        context.lineTo(x - 5.5, y);
        context.closePath();
        context.fill();
        context.stroke();
      }
    });

    const labelCount = width < 510 ? 3 : 4;
    context.fillStyle = "#7D8A83";
    context.textAlign = "center";
    for (let label = 0; label < labelCount; label += 1) {
      const targetTime = firstTime + (timeSpan * label) / Math.max(1, labelCount - 1);
      const nearest = points.reduce((best, point, index) =>
        Math.abs(timeFor(point) - targetTime) < Math.abs(timeFor(points[best]) - targetTime) ? index : best,
      0);
      context.fillText(compactDate(points[nearest].date), xFor(nearest), height - 12);
    }

    if (hovered !== null && points[hovered]) {
      const x = xFor(hovered);
      const y = yFor(points[hovered].nav);
      context.strokeStyle = "rgba(11, 29, 42, 0.22)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, padding.top);
      context.lineTo(x, height - padding.bottom);
      context.stroke();
      context.fillStyle = "#FDFCF7";
      context.strokeStyle = points[hovered].transaction ? "#FF715B" : "#1D9D61";
      context.lineWidth = 2.5;
      context.beginPath();
      context.arc(x, y, 5.5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }, [hovered, points]);

  useEffect(() => {
    draw();
    const observer = new ResizeObserver(draw);
    if (shellRef.current) observer.observe(shellRef.current);
    return () => observer.disconnect();
  }, [draw]);

  const pointerToIndex = (clientX: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !points.length) return 0;
    const left = rect.width < 510 ? 12 : 55;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left - left) / Math.max(1, rect.width - left - 17)));
    const firstTime = new Date(`${points[0].date}T00:00:00Z`).getTime();
    const lastTime = new Date(`${points.at(-1)?.date}T00:00:00Z`).getTime();
    const target = firstTime + ratio * Math.max(1, lastTime - firstTime);
    return points.reduce((best, point, index) => {
      const pointTime = new Date(`${point.date}T00:00:00Z`).getTime();
      const bestTime = new Date(`${points[best].date}T00:00:00Z`).getTime();
      return Math.abs(pointTime - target) < Math.abs(bestTime - target) ? index : best;
    }, 0);
  };

  const positionTooltip = (clientX: number): CSSProperties | undefined => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return undefined;
    const width = 188;
    const left = Math.max(8, Math.min(rect.width - width - 8, clientX - rect.left - width / 2));
    return { position: "absolute", top: "7px", left: `${left}px`, width: `${width}px` };
  };

  const hoverPoint = hovered !== null ? points[hovered] : null;
  const transactionNavSuffix = hoverPoint?.weeklyNav
    && hoverPoint.transactionNav
    && Math.abs(hoverPoint.weeklyNav - hoverPoint.transactionNav) > 0.000001
    ? ` · Tx NAV ${formatMoney(hoverPoint.transactionNav, 4)}`
    : "";
  return (
    <section className="nav-activity-card" aria-labelledby={titleId}>
      <div className="nav-activity-head">
        <div><p className="eyebrow">NAV activity</p><h3 id={titleId}>NAV & investments</h3></div>
        <div className="nav-periods" aria-label="NAV chart period">
          <button className={period === 12 ? "active" : ""} onClick={() => setPeriod(12)}>1Y</button>
          <button className={period === 36 ? "active" : ""} onClick={() => setPeriod(36)}>3Y</button>
          <button className={period === "all" ? "active" : ""} onClick={() => setPeriod("all")}>All</button>
        </div>
      </div>
      <div className="nav-activity-legend">
        <span><i className="nav-line-key" />Actual weekly NAV</span>
        <span><i className="investment-key" />CAS transaction</span>
      </div>
      {points.length ? (
        <div
          className="nav-activity-shell"
          ref={shellRef}
          onPointerMove={(event) => {
            setHovered(pointerToIndex(event.clientX));
            setTooltipStyle(positionTooltip(event.clientX));
          }}
          onPointerLeave={() => { setHovered(null); setTooltipStyle(undefined); }}
        >
          <canvas ref={canvasRef} role="img" aria-label={`Observed NAV and investment dates from ${formatDate(points[0].date)} to ${formatDate(points.at(-1)?.date ?? points[0].date)}`} />
          {hoverPoint && tooltipStyle && (
            <div className="nav-activity-tooltip" style={tooltipStyle}>
              <span className="tooltip-date">
                {formatDate(hoverPoint.date)}
                <span className="tooltip-flags" aria-label={[hoverPoint.transaction && "CAS transaction", hoverPoint.weekly && "Weekly NAV observation", hoverPoint.latest && (liveNav ? "Latest AMFI NAV" : "Statement NAV")].filter(Boolean).join(", ")}>
                  {hoverPoint.transaction && <i className="tooltip-flag transaction" title="CAS transaction">◆</i>}
                  {hoverPoint.weekly && <i className="tooltip-flag weekly" title="Weekly AMFI NAV">●</i>}
                  {hoverPoint.latest && <i className="tooltip-flag live" title={liveNav ? "Latest AMFI NAV" : "Statement NAV"}>{liveNav ? "L" : "S"}</i>}
                </span>
              </span>
              <strong>NAV {formatMoney(hoverPoint.nav, 4)}</strong>
              <small>{hoverPoint.transaction
                ? hoverPoint.investedAmount > 0
                  ? `Purchased ${formatMoney(hoverPoint.investedAmount)}${hoverPoint.transactionCount > 1 ? ` · ${hoverPoint.transactionCount} entries` : ""}${transactionNavSuffix}`
                  : `${hoverPoint.transactionAmount < 0 ? "Redeemed" : "Transaction"} ${formatMoney(Math.abs(hoverPoint.transactionAmount))}${transactionNavSuffix}`
                : "Official weekly NAV"}</small>
            </div>
          )}
        </div>
      ) : <p className="nav-activity-empty">No usable NAV observations were present for this holding.</p>}
      <p className="nav-activity-note">Weekly dots are the last actual AMFI NAV published in each calendar week. Diamonds retain exact CAS transaction dates and amounts. Missing weeks are skipped; connecting lines do not create NAV observations.</p>
    </section>
  );
}
