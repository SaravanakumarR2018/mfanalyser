"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Portfolio } from "./cas-parser";
import FundStackPanel, {
  stackFormatDate,
  stackFundColor,
  stackModeTitle,
} from "./FundStackPanel";
import { formatInr } from "./formatters";
import {
  buildSharedFundStackScale,
  buildFundStackModel,
  maxStackReconciliationDifference,
  magnifyFundStackPoints,
  magnifyFundStackScale,
  magnifiedFundStackWindow,
  shiftMagnifiedFundStackFocus,
  stackMetric,
  toggleStackModeSelection,
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

type DateSelection = { date: string; mode: FundStackMode };
type StackFocus = { date: string; value: number };
type ZoomFactor = 1 | 2 | 4;

export default function FundStackChart({ portfolio }: { portfolio: Portfolio }) {
  const headingId = useId();
  const model = useMemo(() => buildFundStackModel(portfolio), [portfolio]);
  const [modes, setModes] = useState<FundStackMode[]>(["value"]);
  const [range, setRange] = useState<[number, number]>([0, Math.max(1, model.points.length - 1)]);
  const [selection, setSelection] = useState<DateSelection | null>(null);
  const [zoomFactor, setZoomFactor] = useState<ZoomFactor>(1);
  const [focus, setFocus] = useState<StackFocus | null>(null);
  const priorPoints = useRef(model.points);
  const rangeWindowDrag = useRangeWindowDrag({
    range,
    setRange,
    totalPoints: model.points.length,
    onMoveStart: () => {
      setZoomFactor(1);
      setFocus(null);
    },
  });

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

  const baseVisible = useMemo(
    () => model.points.slice(range[0], Math.min(model.points.length, range[1] + 1)),
    [model.points, range],
  );
  const baseScale = useMemo(
    () => buildSharedFundStackScale(baseVisible, modes),
    [baseVisible, modes],
  );
  const defaultFocus = useMemo<StackFocus>(() => ({
    date: baseVisible[Math.floor(baseVisible.length / 2)]?.date ?? "",
    value: (baseScale.min + baseScale.max) / 2,
  }), [baseScale.max, baseScale.min, baseVisible]);
  const activeFocus = focus && baseVisible.some((point) => point.date === focus.date)
    ? focus
    : defaultFocus;
  const visible = useMemo(
    () => magnifyFundStackPoints(baseVisible, activeFocus.date, zoomFactor),
    [activeFocus.date, baseVisible, zoomFactor],
  );
  const visibleTimes = useMemo(
    () => visible.map((point) => new Date(`${point.date}T00:00:00Z`).getTime()),
    [visible],
  );
  const sharedScale = useMemo(
    () => magnifyFundStackScale(baseScale, activeFocus.value, zoomFactor),
    [activeFocus.value, baseScale, zoomFactor],
  );
  const viewKey = `${range[0]}:${range[1]}:${zoomFactor}:${activeFocus.value}:${visible[0]?.date ?? ""}:${visible.at(-1)?.date ?? ""}`;
  const focusWindow = magnifiedFundStackWindow(baseVisible, activeFocus.date, zoomFactor);

  const resetFocus = () => {
    setZoomFactor(1);
    setFocus(null);
  };

  const chooseZoom = (factor: ZoomFactor) => {
    if (factor === 1) {
      resetFocus();
      return;
    }
    setZoomFactor(factor);
    const selectedDate = selection && baseVisible.some((point) => point.date === selection.date)
      ? selection.date
      : activeFocus.date;
    setFocus({ date: selectedDate, value: activeFocus.value });
  };

  const moveFocus = (direction: -1 | 1) => {
    setFocus({
      date: shiftMagnifiedFundStackFocus(baseVisible, activeFocus.date, zoomFactor, direction),
      value: activeFocus.value,
    });
    setSelection(null);
  };

  const selectPeriod = (months: number | "all") => {
    resetFocus();
    if (months === "all" || model.points.length < 2) {
      setRange([0, Math.max(1, model.points.length - 1)]);
      return;
    }
    const cutoff = new Date(`${model.points.at(-1)?.date}T00:00:00Z`);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
    const start = model.points.findIndex((point) => new Date(`${point.date}T00:00:00Z`) >= cutoff);
    setRange([Math.max(0, start), model.points.length - 1]);
  };

  const toggleMode = (mode: FundStackMode) => {
    const next = toggleStackModeSelection(modes, mode);
    if (next === modes) return;
    setModes(next);
    if (selection && !next.includes(selection.mode)) setSelection(null);
  };

  const selectedMode = selection?.mode ?? modes[0];
  const selectedPoint = selection
    ? visible.find((point) => point.date === selection.date) ?? null
    : null;
  const ranked = selectedPoint
    ? selectedPoint.funds
      .map((fund, index) => ({ ...fund, fund: model.funds[index], index, amount: stackMetric(fund, selectedMode) }))
      .sort((left, right) => right.amount - left.amount)
    : [];
  const positiveRanked = selectedMode === "contribution" ? ranked.filter((item) => item.amount >= 0) : ranked;
  const negativeRanked = selectedMode === "contribution"
    ? ranked.filter((item) => item.amount < 0).sort((left, right) => left.amount - right.amount)
    : [];
  const selectedTotal = selectedPoint ? modeTotal(selectedPoint, selectedMode) : 0;
  const reconciliationDifference = maxStackReconciliationDifference(model);

  const renderRows = (rows: typeof ranked, offset = 0) => {
    const shareBase = selectedMode === "contribution"
      ? rows.reduce((total, row) => total + Math.abs(row.amount), 0)
      : Math.abs(selectedTotal);
    return rows.map((item, index) => {
      const share = shareBase ? Math.abs(item.amount) / shareBase * 100 : 0;
      return (
        <div className="stack-ranking-row" key={item.fundKey}>
          <span className="stack-rank">{String(offset + index + 1).padStart(2, "0")}</span>
          <span className="stack-fund"><i style={{ background: stackFundColor(item.index) }} /><span><strong>{item.fund.name}</strong><small>{item.fund.category}{item.fund.closed ? " · Closed" : ""}</small></span></span>
          <span className={item.amount < 0 ? "negative" : selectedMode === "contribution" ? "positive" : ""}><strong>{formatInr(item.amount)}</strong><small>{share.toFixed(1)}% of {selectedMode === "contribution" ? "this side" : "total"}</small></span>
        </div>
      );
    });
  };

  return (
    <section className="fund-stack-card" aria-labelledby={headingId} data-reconciliation-difference={reconciliationDifference}>
      <div className="stack-chart-head">
        <div><p className="eyebrow">Every fund, one total</p><h2 id={headingId}>Fund contribution over time</h2></div>
        <div className="stack-chart-controls">
          <div className="stack-modes" aria-label="Choose one or more stacked chart views">
            {MODES.map((item) => {
              const active = modes.includes(item.key);
              return <button type="button" key={item.key} className={active ? "active" : ""} aria-pressed={active} onClick={() => toggleMode(item.key)}><i aria-hidden="true">{active ? "✓" : "+"}</i>{item.label}</button>;
            })}
          </div>
          <div className="stack-zoom-tools" aria-label="Linked chart magnification">
            <span className="stack-zoom-label"><i aria-hidden="true" />Focus</span>
            {([1, 2, 4] as ZoomFactor[]).map((factor) => <button type="button" key={factor} className={zoomFactor === factor ? "active" : ""} aria-pressed={zoomFactor === factor} onClick={() => chooseZoom(factor)}>{factor}×</button>)}
          </div>
          <div className="periods" aria-label="Stacked chart period">
            <button onClick={() => selectPeriod(12)}>1Y</button><button onClick={() => selectPeriod(24)}>2Y</button><button onClick={() => selectPeriod(36)}>3Y</button><button onClick={() => selectPeriod(60)}>5Y</button><button onClick={() => selectPeriod("all")}>All</button>
          </div>
        </div>
      </div>
      <div className="stack-chart-meta">
        <span>{modes.length} {modes.length === 1 ? "view" : "views"} selected · shared Y-axis</span>
        <span>{model.funds.length} funds · all shown</span>
        <em>{zoomFactor > 1 ? "Click any chart layer to reposition the linked focus" : "Hover for exact details · choose 2× or 4× to inspect thin layers"}</em>
      </div>
      {zoomFactor > 1 && visible.length > 1 && (
        <div className="stack-focus-status" role="status">
          <button type="button" onClick={() => moveFocus(-1)} disabled={focusWindow.start === 0} aria-label="Move linked focus earlier">‹</button>
          <i aria-hidden="true" />
          <span><strong>{zoomFactor}× linked focus</strong><small>{stackFormatDate(visible[0].date)}–{stackFormatDate(visible.at(-1)?.date ?? visible[0].date)} · shared {formatInr(sharedScale.min)} to {formatInr(sharedScale.max)}</small></span>
          <button type="button" onClick={() => moveFocus(1)} disabled={focusWindow.end === baseVisible.length} aria-label="Move linked focus later">›</button>
          <button type="button" className="stack-focus-reset" onClick={resetFocus}>Reset</button>
        </div>
      )}
      {visible.length > 1 ? (
        <div className={`fund-stack-panels panels-${modes.length}`}>
          {modes.map((mode) => (
            <FundStackPanel
              key={mode}
              mode={mode}
              model={model}
              visible={visible}
              visibleTimes={visibleTimes}
              selectedDate={selection?.date ?? null}
              scale={sharedScale}
              zoomFactor={zoomFactor}
              viewKey={viewKey}
              onMoveVerticalFocus={(value) => setFocus({ date: activeFocus.date, value })}
              onSelectPoint={(date, selectedPanelMode, focusValue) => {
                setSelection({ date, mode: selectedPanelMode });
                if (zoomFactor > 1) setFocus({ date, value: focusValue ?? activeFocus.value });
              }}
            />
          ))}
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
              aria-valuetext={`${stackFormatDate(model.points[range[0]]?.date ?? model.points[0].date)} to ${stackFormatDate(model.points[range[1]]?.date ?? model.points.at(-1)?.date ?? model.points[0].date)}`}
              tabIndex={rangeWindowDrag.movable ? 0 : -1}
              onKeyDown={rangeWindowDrag.onKeyDown}
              onPointerCancel={rangeWindowDrag.onPointerCancel}
              onPointerDown={rangeWindowDrag.onPointerDown}
              onPointerMove={rangeWindowDrag.onPointerMove}
              onPointerUp={rangeWindowDrag.onPointerUp}
              style={{ left: `${range[0] / Math.max(1, model.points.length - 1) * 100}%`, right: `${100 - range[1] / Math.max(1, model.points.length - 1) * 100}%` }}
            />
            <input aria-label="Stacked chart start" type="range" min={0} max={Math.max(1, model.points.length - 2)} value={range[0]} onChange={(event) => { resetFocus(); setRange([Math.min(Number(event.target.value), range[1] - 1), range[1]]); }} />
            <input aria-label="Stacked chart end" type="range" min={1} max={Math.max(1, model.points.length - 1)} value={range[1]} onChange={(event) => { resetFocus(); setRange([range[0], Math.max(Number(event.target.value), range[0] + 1)]); }} />
          </div>
        </div>
      )}
      {selectedPoint && (
        <section className="stack-ranking-panel" aria-label={`Fund ranking on ${stackFormatDate(selectedPoint.date)}`}>
          <header><div><span>Selected date</span><strong>{stackFormatDate(selectedPoint.date)}</strong></div><div><span>{stackModeTitle(selectedMode)}</span><strong className={selectedTotal < 0 ? "negative" : ""}>{formatInr(selectedTotal)}</strong></div><button type="button" onClick={() => setSelection(null)} aria-label="Close fund ranking">×</button></header>
          <div className="stack-ranking-scroll" role="region" aria-label={`All funds ranked by ${selectedMode}`}>
            {selectedMode === "contribution" && <div className="stack-ranking-group positive">Positive contribution</div>}
            {renderRows(positiveRanked)}
            {selectedMode === "contribution" && negativeRanked.length > 0 && <div className="stack-ranking-group negative">Negative contribution</div>}
            {renderRows(negativeRanked, positiveRanked.length)}
          </div>
          <p>Showing all {model.funds.length} funds · the first eight are visible; scroll for the rest.</p>
        </section>
      )}
      <p className="stack-chart-note"><strong>Reconciled stack:</strong> {portfolio.source === "demo"
        ? "every demo fund is included in a stable order using the illustrative demo allocation."
        : "every active and closed CAS fund is included in a stable order. Historical points appear only when exact same-day NAVs are available for every fund held on that date; missing dates are not estimated."} Annualised return is the money-weighted XIRR from exact dated CAS cash flows and the fund value on the hovered date; it is shown as — when it cannot be computed.</p>
    </section>
  );
}
