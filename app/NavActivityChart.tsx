"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { FundTransaction, HistoricalNavPoint } from "./cas-parser";
import { formatInr } from "./formatters";
import { buildNavPoints, type NavActivityPoint } from "./nav-activity-service";
import { loadFullSchemeNavHistory } from "./nav-service";
import { useResponsiveCanvasRedraw } from "./useResponsiveCanvasRedraw";
import { useRangeWindowDrag } from "./useRangeWindowDrag";

type NavActivityChartProps = {
  transactions: FundTransaction[];
  navHistory?: HistoricalNavPoint[];
  nav: number;
  navDate: string;
  liveNav?: boolean;
  schemeCode?: string;
};

type NavHistoryScope = "journey" | "full";

type FullHistoryResult = {
  key: string;
  loading?: boolean;
  points?: HistoricalNavPoint[];
  error?: string;
};

const formatDate = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(`${date}T00:00:00Z`));

const compactDate = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" })
    .format(new Date(`${date}T00:00:00Z`));

const formatMoney = formatInr;

export default function NavActivityChart({
  transactions,
  navHistory,
  nav,
  navDate,
  liveNav,
  schemeCode,
}: NavActivityChartProps) {
  const titleId = useId();
  const scopeStatusId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const fullHistoryRequest = useRef<AbortController | null>(null);
  const [historyScope, setHistoryScope] = useState<NavHistoryScope>("journey");
  const [fullHistoryResult, setFullHistoryResult] = useState<FullHistoryResult>();
  const historyKey = `${schemeCode ?? "unmatched"}:${navDate}`;
  const currentFullHistory = fullHistoryResult?.key === historyKey ? fullHistoryResult : undefined;
  const firstTransactionDate = useMemo(
    () => transactions.map((transaction) => transaction.date).filter(Boolean).sort()[0],
    [transactions],
  );
  const journeyHistory = useMemo(
    () => navHistory?.filter((point) => !firstTransactionDate || point.date >= firstTransactionDate),
    [firstTransactionDate, navHistory],
  );
  const displayedHistory = historyScope === "full" && currentFullHistory?.points
    ? currentFullHistory.points
    : journeyHistory;
  const displayedScope = historyScope === "full" && currentFullHistory?.points ? "full" : "journey";
  const allPoints = useMemo(
    () => buildNavPoints(transactions, displayedHistory, nav, navDate),
    [displayedHistory, nav, navDate, transactions],
  );
  const [period, setPeriod] = useState<12 | 36 | "all" | null>("all");
  const [range, setRange] = useState<[number, number]>([0, Math.max(1, allPoints.length - 1)]);
  const [hovered, setHovered] = useState<number | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>();
  const previousPoints = useRef(allPoints);
  const clearSelectedPeriod = useCallback(() => setPeriod(null), []);
  const rangeWindowDrag = useRangeWindowDrag({
    range,
    setRange,
    totalPoints: allPoints.length,
    onMoveStart: clearSelectedPeriod,
  });

  useEffect(() => () => fullHistoryRequest.current?.abort(), [historyKey]);

  useEffect(() => {
    const prior = previousPoints.current;
    if (prior === allPoints) return;
    setRange(([start, end]) => {
      if (allPoints.length < 2) return [0, Math.max(1, allPoints.length - 1)];
      if (start === 0 && end >= prior.length - 1) return [0, allPoints.length - 1];
      const startDate = prior[start]?.date;
      const endDate = prior[end]?.date;
      const nextStart = startDate
        ? Math.max(0, allPoints.findIndex((point) => point.date >= startDate))
        : 0;
      const nextEndCandidate = endDate
        ? allPoints.findLastIndex((point) => point.date <= endDate)
        : allPoints.length - 1;
      return [nextStart, Math.max(nextStart + 1, nextEndCandidate)];
    });
    previousPoints.current = allPoints;
    setHovered(null);
    setTooltipStyle(undefined);
  }, [allPoints]);

  const points = useMemo(
    () => allPoints.slice(range[0], Math.min(allPoints.length, range[1] + 1)),
    [allPoints, range],
  );

  const selectPeriod = (months: 12 | 36 | "all") => {
    setPeriod(months);
    if (months === "all" || allPoints.length < 2) {
      setRange([0, Math.max(1, allPoints.length - 1)]);
      return;
    }
    const cutoff = new Date(`${allPoints.at(-1)?.date}T00:00:00Z`);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
    const firstInPeriod = allPoints.findIndex(
      (point) => new Date(`${point.date}T00:00:00Z`) >= cutoff,
    );
    setRange([Math.max(0, firstInPeriod), allPoints.length - 1]);
  };

  const resetVisibleHistory = () => {
    setPeriod("all");
    setRange([0, Math.max(1, allPoints.length - 1)]);
    setHovered(null);
    setTooltipStyle(undefined);
  };

  const requestFullHistory = async () => {
    if (!schemeCode || currentFullHistory?.loading) return;
    fullHistoryRequest.current?.abort();
    const controller = new AbortController();
    fullHistoryRequest.current = controller;
    setFullHistoryResult({ key: historyKey, loading: true });
    try {
      const points = await loadFullSchemeNavHistory(
        schemeCode,
        navDate,
        liveNav ? nav : undefined,
        liveNav ? navDate : undefined,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setFullHistoryResult({ key: historyKey, points });
      }
    } catch {
      if (!controller.signal.aborted) {
        setFullHistoryResult({
          key: historyKey,
          error: "Full published NAV history could not be loaded. Your current view is unchanged.",
        });
      }
    } finally {
      if (fullHistoryRequest.current === controller) fullHistoryRequest.current = null;
    }
  };

  const selectHistoryScope = (scope: NavHistoryScope) => {
    setHistoryScope(scope);
    resetVisibleHistory();
    if (scope === "full" && !currentFullHistory?.points && !currentFullHistory?.loading) {
      void requestFullHistory();
    }
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const shell = shellRef.current;
    if (!canvas || !shell || !points.length) return;
    const width = shell.clientWidth;
    if (width < 2) return;
    const height = 250;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(dpr, dpr);

    const padding = { left: width < 510 ? 12 : 55, right: 17, top: 94, bottom: 32 };
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
      if (point.investedAmount > 0) {
        context.fillStyle = "#087A4B";
        context.strokeStyle = "#FDFCF7";
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(x, y - 5.8);
        context.lineTo(x + 5.8, y);
        context.lineTo(x, y + 5.8);
        context.lineTo(x - 5.8, y);
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
      if (points[hovered].investedAmount > 0) {
        context.fillStyle = "#087A4B";
        context.strokeStyle = "#FDFCF7";
        context.lineWidth = 1.8;
        context.beginPath();
        context.moveTo(x, y - 7);
        context.lineTo(x + 7, y);
        context.lineTo(x, y + 7);
        context.lineTo(x - 7, y);
        context.closePath();
        context.fill();
        context.stroke();
      } else {
        context.fillStyle = "#FDFCF7";
        context.strokeStyle = "#1D9D61";
        context.lineWidth = 2.5;
        context.beginPath();
        context.arc(x, y, 5.5, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      }
    }
  }, [hovered, points]);

  useResponsiveCanvasRedraw(shellRef, draw);

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
    const width = Math.min(236, Math.max(176, rect.width - 16));
    const left = Math.max(8, Math.min(rect.width - width - 8, clientX - rect.left - width / 2));
    return { position: "absolute", top: "7px", left: `${left}px`, width: `${width}px` };
  };

  const hoverPoint = hovered !== null ? points[hovered] : null;
  const transactionNavSuffix = hoverPoint?.publishedNav
    && hoverPoint.transactionNav
    && Math.abs(hoverPoint.publishedNav - hoverPoint.transactionNav) > 0.000001
    ? ` · Tx NAV ${formatMoney(hoverPoint.transactionNav, 4)}`
    : "";
  return (
    <section className="nav-activity-card" aria-labelledby={titleId}>
      <div className="nav-activity-head">
        <div><p className="eyebrow">NAV activity</p><h3 id={titleId}>NAV & investments</h3></div>
        <div className="nav-periods" aria-label="NAV chart period">
          <button className={period === 12 ? "active" : ""} onClick={() => selectPeriod(12)}>1Y</button>
          <button className={period === 36 ? "active" : ""} onClick={() => selectPeriod(36)}>3Y</button>
          <button className={period === "all" ? "active" : ""} onClick={() => selectPeriod("all")}>All</button>
        </div>
      </div>
      <div className="nav-activity-legend">
        <span><i className="nav-line-key" />Actual daily NAV</span>
        <span><i className="investment-key" />CAS investment</span>
        <button
          type="button"
          className={`chart-series-toggle nav-history-toggle${historyScope === "full" ? " active" : ""}`}
          aria-pressed={historyScope === "full"}
          aria-label={`${historyScope === "full" ? "Hide" : "Show"} full fund history`}
          aria-describedby={historyScope === "full" ? scopeStatusId : undefined}
          disabled={!schemeCode}
          title={schemeCode
            ? `${historyScope === "full" ? "Hide" : "Show"} full fund history`
            : "Available after an official AMFI scheme match"}
          onClick={() => selectHistoryScope(historyScope === "full" ? "journey" : "full")}
        >
          <i className="nav-full-history-key" aria-hidden="true" />
          <b>Full fund history</b>
          <em aria-hidden="true"><i /></em>
        </button>
      </div>
      {historyScope === "full" && (
        <p
          id={scopeStatusId}
          className={`nav-scope-status${currentFullHistory?.error && historyScope === "full" ? " error" : ""}`}
          role="status"
          aria-live="polite"
          aria-busy={historyScope === "full" && Boolean(currentFullHistory?.loading)}
        >
          {historyScope === "full" && currentFullHistory?.loading ? (
            <><i className="nav-scope-spinner" aria-hidden="true" />Loading full published history · current chart stays visible</>
          ) : historyScope === "full" && currentFullHistory?.error ? (
            <><span>{currentFullHistory.error}</span><button type="button" onClick={() => void requestFullHistory()}>Retry</button></>
          ) : displayedScope === "full" && currentFullHistory?.points ? (
            <>Full history · earliest published NAV {formatDate(currentFullHistory.points[0].date)} · {currentFullHistory.points.length.toLocaleString("en-IN")} observations</>
          ) : null}
        </p>
      )}
      {points.length ? (
        <div
          className="nav-activity-shell"
          ref={shellRef}
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
            data-history-scope={displayedScope}
            data-requested-history-scope={historyScope}
            data-series-start={allPoints[0]?.date}
            data-total-points={allPoints.length}
            data-visible-points={points.length}
            data-daily-points={allPoints.filter((point) => point.daily).length}
            data-transaction-points={allPoints.filter((point) => point.transaction).length}
            data-investment-points={allPoints.filter((point) => point.investedAmount > 0).length}
            aria-label={`Observed NAV and investment dates from ${formatDate(points[0].date)} to ${formatDate(points.at(-1)?.date ?? points[0].date)}`}
          />
          {hoverPoint && tooltipStyle && (
            <div className="nav-activity-tooltip" style={tooltipStyle}>
              <span className="tooltip-date">
                {formatDate(hoverPoint.date)}
                <span className="tooltip-flags" aria-label={[hoverPoint.investedAmount > 0 && "CAS investment", hoverPoint.daily && "Daily NAV observation", hoverPoint.latest && (liveNav ? "Latest AMFI NAV" : "Statement NAV")].filter(Boolean).join(", ")}>
                  {hoverPoint.investedAmount > 0 && <i className="tooltip-flag transaction" title="CAS investment">◆</i>}
                  {hoverPoint.daily && <i className="tooltip-flag daily" title="Daily AMFI NAV">●</i>}
                  {hoverPoint.latest && <i className="tooltip-flag live" title={liveNav ? "Latest AMFI NAV" : "Statement NAV"}>{liveNav ? "L" : "S"}</i>}
                </span>
              </span>
              <strong>NAV {formatMoney(hoverPoint.nav, 4)}</strong>
              <small className="nav-tooltip-detail">
                <span>{hoverPoint.transaction
                  ? hoverPoint.investedAmount > 0
                    ? `Purchased ${formatMoney(hoverPoint.investedAmount)}`
                    : `${hoverPoint.transactionAmount < 0 ? "Redeemed" : "Transaction"} ${formatMoney(Math.abs(hoverPoint.transactionAmount))}`
                  : "Official daily NAV"}</span>
                {hoverPoint.transactionCount > 1 && <span>{hoverPoint.transactionCount} entries</span>}
                {transactionNavSuffix && <span>{transactionNavSuffix.replace(" · ", "")}</span>}
              </small>
            </div>
          )}
        </div>
      ) : <p className="nav-activity-empty">No usable NAV observations were present for this holding.</p>}
      {allPoints.length > 1 && (
        <div className="nav-range-control">
          <div className="nav-range-dates" aria-live="polite">
            <span>{formatDate(points[0]?.date ?? allPoints[0].date)}</span>
            <span>{formatDate(points.at(-1)?.date ?? allPoints.at(-1)?.date ?? allPoints[0].date)}</span>
          </div>
          <div className="range-track nav-range-track" aria-label="Visible NAV chart range">
            <div
              className={`range-fill${rangeWindowDrag.movable ? " draggable" : ""}`}
              role="slider"
              aria-label="Move visible NAV chart window"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, allPoints.length - (range[1] - range[0] + 1))}
              aria-valuenow={range[0]}
              aria-valuetext={`${formatDate(allPoints[range[0]]?.date ?? allPoints[0].date)} to ${formatDate(allPoints[range[1]]?.date ?? allPoints.at(-1)?.date ?? allPoints[0].date)}`}
              tabIndex={rangeWindowDrag.movable ? 0 : -1}
              title={rangeWindowDrag.movable ? "Drag to move the selected timeframe" : undefined}
              onKeyDown={rangeWindowDrag.onKeyDown}
              onPointerCancel={rangeWindowDrag.onPointerCancel}
              onPointerDown={rangeWindowDrag.onPointerDown}
              onPointerMove={rangeWindowDrag.onPointerMove}
              onPointerUp={rangeWindowDrag.onPointerUp}
              style={{
                left: `${(range[0] / Math.max(1, allPoints.length - 1)) * 100}%`,
                right: `${100 - (range[1] / Math.max(1, allPoints.length - 1)) * 100}%`,
              }}
            />
            <input
              aria-label="NAV chart start"
              type="range"
              min={0}
              max={Math.max(1, allPoints.length - 2)}
              value={range[0]}
              onChange={(event) => {
                setPeriod(null);
                setRange([Math.min(Number(event.target.value), range[1] - 1), range[1]]);
              }}
            />
            <input
              aria-label="NAV chart end"
              type="range"
              min={1}
              max={Math.max(1, allPoints.length - 1)}
              value={range[1]}
              onChange={(event) => {
                setPeriod(null);
                setRange([range[0], Math.max(Number(event.target.value), range[0] + 1)]);
              }}
            />
          </div>
        </div>
      )}
      <p className="nav-activity-note">{displayedScope === "full" ? "Full fund history starts at the earliest published NAV returned for this scheme. " : "Your journey starts with the first investment recorded in the CAS. "}The line follows actual AMFI NAV publication dates. Green diamonds retain exact CAS purchase dates and invested amounts. Missing dates are skipped; connecting lines do not create NAV observations.</p>
    </section>
  );
}
