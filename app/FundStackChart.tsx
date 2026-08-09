"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Portfolio } from "./cas-parser";
import {
  CHART_LENS_MAGNIFICATION_STEP,
  CHART_LENS_MAX_MAGNIFICATION,
  CHART_LENS_MIN_MAGNIFICATION,
  DEFAULT_CHART_LENS_STATE,
  type ChartLensState,
} from "./chart-lens";
import FundStackPanel, {
  stackFormatDate,
  stackFundColor,
  stackModeTitle,
} from "./FundStackPanel";
import { formatInr } from "./formatters";
import VerticalScaleControl from "./VerticalScaleControl";
import {
  buildSharedFundStackScale,
  buildFundStackModel,
  maxStackReconciliationDifference,
  rebaseFundStackToPeriodStart,
  stackMetric,
  toggleStackModeSelection,
  type FundStackMode,
  type FundStackPoint,
} from "./fund-stack-service";
import { useRangeWindowDrag } from "./useRangeWindowDrag";
import type { IndexRange } from "./range-window";
import { scaleForVerticalRange, VERTICAL_RANGE_MAX } from "./vertical-range";

const MODES: Array<{ key: FundStackMode; label: string }> = [
  { key: "value", label: "Value" },
  { key: "invested", label: "Invested" },
  { key: "contribution", label: "Contribution" },
  { key: "periodChange", label: "Period change" },
];

const modeTotal = (point: FundStackPoint, mode: FundStackMode) => {
  if (mode === "value") return point.totalValue;
  if (mode === "invested") return point.totalInvested;
  if (mode === "contribution") return point.totalContribution;
  return point.totalPeriodChange ?? 0;
};

type DateSelection = { date: string; mode: FundStackMode };

export default function FundStackChart({ portfolio }: { portfolio: Portfolio }) {
  const headingId = useId();
  const model = useMemo(() => buildFundStackModel(portfolio), [portfolio]);
  const [modes, setModes] = useState<FundStackMode[]>(["value"]);
  const [range, setRange] = useState<[number, number]>([0, Math.max(1, model.points.length - 1)]);
  const [selection, setSelection] = useState<DateSelection | null>(null);
  const [verticalRange, setVerticalRange] = useState<IndexRange>([0, VERTICAL_RANGE_MAX]);
  const [lens, setLens] = useState<ChartLensState>(() => ({ ...DEFAULT_CHART_LENS_STATE }));
  const priorPoints = useRef(model.points);
  const rangeWindowDrag = useRangeWindowDrag({
    range,
    setRange,
    totalPoints: model.points.length,
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

  const rawVisible = useMemo(
    () => model.points.slice(range[0], Math.min(model.points.length, range[1] + 1)),
    [model.points, range],
  );
  const visible = useMemo(
    () => rebaseFundStackToPeriodStart(rawVisible, model.funds),
    [model.funds, rawVisible],
  );
  const visibleTimes = useMemo(
    () => visible.map((point) => new Date(`${point.date}T00:00:00Z`).getTime()),
    [visible],
  );
  const baseSharedScale = useMemo(
    () => buildSharedFundStackScale(visible, modes),
    [modes, visible],
  );
  const sharedScale = useMemo(
    () => scaleForVerticalRange(baseSharedScale, verticalRange),
    [baseSharedScale, verticalRange],
  );
  const viewKey = `${range[0]}:${range[1]}:${verticalRange[0]}:${verticalRange[1]}:${lens.enabled}:${lens.x}:${lens.y}:${lens.magnification}:${lens.size}:${visible[0]?.date ?? ""}:${visible.at(-1)?.date ?? ""}`;

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
  const signedMode = selectedMode === "contribution" || selectedMode === "periodChange";
  const positiveRanked = signedMode ? ranked.filter((item) => item.amount >= 0) : ranked;
  const negativeRanked = signedMode
    ? ranked.filter((item) => item.amount < 0).sort((left, right) => left.amount - right.amount)
    : [];
  const selectedTotal = selectedPoint ? modeTotal(selectedPoint, selectedMode) : 0;
  const reconciliationDifference = maxStackReconciliationDifference({ ...model, points: visible });
  const moveLens = useCallback((position: { x: number; y: number }) => {
    setLens((current) => ({ ...current, ...position }));
  }, []);

  const renderRows = (rows: typeof ranked, offset = 0) => {
    const shareBase = signedMode
      ? rows.reduce((total, row) => total + Math.abs(row.amount), 0)
      : Math.abs(selectedTotal);
    return rows.map((item, index) => {
      const share = shareBase ? Math.abs(item.amount) / shareBase * 100 : 0;
      return (
        <div className="stack-ranking-row" key={item.fundKey}>
          <span className="stack-rank">{String(offset + index + 1).padStart(2, "0")}</span>
          <span className="stack-fund"><i style={{ background: stackFundColor(item.index) }} /><span><strong>{item.fund.name}</strong><small>{item.fund.category}{item.fund.closed ? " · Closed" : ""}</small></span></span>
          <span className={item.amount < 0 ? "negative" : signedMode ? "positive" : ""}><strong>{formatInr(item.amount)}</strong><small>{share.toFixed(1)}% of {signedMode ? "this side" : "total"}</small></span>
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
          <div className={`stack-lens-tools${lens.enabled ? " active" : ""}`} aria-label="Synchronized chart magnifier">
            <button type="button" className="stack-lens-toggle" aria-pressed={lens.enabled} onClick={() => setLens((current) => ({ ...current, enabled: !current.enabled }))}><i aria-hidden="true" />Lens</button>
            <label><span>Zoom <b>{lens.magnification.toFixed(1)}×</b></span><input aria-label="Lens magnification" type="range" min={CHART_LENS_MIN_MAGNIFICATION} max={CHART_LENS_MAX_MAGNIFICATION} step={CHART_LENS_MAGNIFICATION_STEP} value={lens.magnification} disabled={!lens.enabled} onChange={(event) => setLens((current) => ({ ...current, magnification: Number(event.target.value) }))} /></label>
            <label><span>Size <b>{lens.size}px</b></span><input aria-label="Lens size" type="range" min="110" max="220" step="10" value={lens.size} disabled={!lens.enabled} onChange={(event) => setLens((current) => ({ ...current, size: Number(event.target.value) }))} /></label>
          </div>
          <div className="periods" aria-label="Stacked chart period">
            <button onClick={() => selectPeriod(12)}>1Y</button><button onClick={() => selectPeriod(24)}>2Y</button><button onClick={() => selectPeriod(36)}>3Y</button><button onClick={() => selectPeriod(60)}>5Y</button><button onClick={() => selectPeriod("all")}>All</button>
          </div>
        </div>
      </div>
      <div className="stack-chart-meta">
        <span>{modes.length} {modes.length === 1 ? "view" : "views"} selected · shared Y-axis</span>
        <span>Y {formatInr(sharedScale.min)}–{formatInr(sharedScale.max)}</span>
        <span>{model.funds.length} funds · all shown</span>
        {modes.includes("periodChange") && visible[0] && <span>Period change and net cash flow start at ₹0 · {stackFormatDate(visible[0].date)}</span>}
        <em>{lens.enabled ? "Drag the lens on any chart · hover inside it for exact details" : "Turn on Lens to inspect thin layers without changing the chart"}</em>
      </div>
      {visible.length > 1 ? (
        <div className="stack-chart-stage">
          <VerticalScaleControl range={verticalRange} scale={sharedScale} setRange={setVerticalRange} />
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
                lens={lens}
                viewKey={viewKey}
                onLensMove={moveLens}
                onSelectPoint={(date, selectedPanelMode) => setSelection({ date, mode: selectedPanelMode })}
              />
            ))}
          </div>
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
            <input aria-label="Stacked chart start" type="range" min={0} max={Math.max(1, model.points.length - 2)} value={range[0]} onChange={(event) => setRange([Math.min(Number(event.target.value), range[1] - 1), range[1]])} />
            <input aria-label="Stacked chart end" type="range" min={1} max={Math.max(1, model.points.length - 1)} value={range[1]} onChange={(event) => setRange([range[0], Math.max(Number(event.target.value), range[0] + 1)])} />
          </div>
        </div>
      )}
      {selectedPoint && (
        <section className="stack-ranking-panel" aria-label={`Fund ranking on ${stackFormatDate(selectedPoint.date)}`}>
          <header><div><span>Selected date</span><strong>{stackFormatDate(selectedPoint.date)}</strong></div><div><span>{stackModeTitle(selectedMode)}</span><strong className={selectedTotal < 0 ? "negative" : ""}>{formatInr(selectedTotal)}</strong></div><button type="button" onClick={() => setSelection(null)} aria-label="Close fund ranking">×</button></header>
          <div className="stack-ranking-scroll" role="region" aria-label={`All funds ranked by ${selectedMode}`}>
            {signedMode && <div className="stack-ranking-group positive">{selectedMode === "periodChange" ? "Positive value change" : "Positive contribution"}</div>}
            {renderRows(positiveRanked)}
            {signedMode && negativeRanked.length > 0 && <div className="stack-ranking-group negative">{selectedMode === "periodChange" ? "Negative value change" : "Negative contribution"}</div>}
            {renderRows(negativeRanked, positiveRanked.length)}
          </div>
          <p>Showing all {model.funds.length} funds · the first eight are visible; scroll for the rest.</p>
        </section>
      )}
      <p className="stack-chart-note"><strong>Reconciled stack:</strong> {portfolio.source === "demo"
        ? "every demo fund is included in a stable order using the illustrative demo allocation."
        : "every active and closed CAS fund is included in a stable order. Historical points appear only when exact same-day NAVs are available for every fund held on that date; missing dates are not estimated."} <strong>Period change</strong> rebases every fund to ₹0 at the left slider date and plots its exact value change from that baseline. The amber <strong>Net cash flow</strong> step-line starts at ₹0 and moves only on exact CAS investments or redemptions after that date, separating money added or withdrawn from market movement. Annualised return is the money-weighted XIRR from exact dated CAS cash flows and the fund value on the hovered date; it is shown as — when it cannot be computed.</p>
    </section>
  );
}
