"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { HistoricalNavPoint, Portfolio } from "./cas-parser";
import {
  buildFundComparisonAxisTicks,
  buildFundComparisonCandidates,
  buildFundComparisonModel,
  buildFundComparisonScale,
  fundComparisonLineWidth,
  fundComparisonTooltipAt,
  preserveFundComparisonDateRange,
  rebaseFundComparisonModel,
  shouldStartFundComparisonHistoryLoad,
  type FundComparisonCandidate,
} from "./fund-comparison-service";
import {
  placeFundComparisonTooltip,
  type FundComparisonTooltipLayout,
} from "./fund-comparison-tooltip";
import { stackFundColor } from "./FundStackPanel";
import { formatInr } from "./formatters";
import { loadFundComparisonHistories } from "./nav-service";
import type { IndexRange } from "./range-window";
import { useRangeWindowDrag } from "./useRangeWindowDrag";
import { useResponsiveCanvasRedraw } from "./useResponsiveCanvasRedraw";
import VerticalScaleControl from "./VerticalScaleControl";
import { scaleForVerticalRange, VERTICAL_RANGE_MAX } from "./vertical-range";

type ComparisonPeriod = 12 | 36 | 60 | 96 | 120 | "all" | null;
type LoadPhase = "queued" | "loading" | "ready" | "partial" | "error";

type DrawnSeries = {
  key: string;
  points: Array<{ x: number; y: number; date: string }>;
};

type PlotGeometry = {
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  firstTime: number;
  lastTime: number;
  low: number;
  high: number;
};

const fullDate = (date: string) => new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
}).format(new Date(`${date}T00:00:00Z`));

const compactDate = (date: string) => new Intl.DateTimeFormat("en-IN", {
  month: "short",
  year: "2-digit",
}).format(new Date(`${date}T00:00:00Z`));

const indexedMoney = (value: number) => `₹${value.toLocaleString("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const compactAxisNumber = (value: number) => Math.abs(value) >= 10_000
  ? new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
  : value.toLocaleString("en-IN", { maximumFractionDigits: 1 });

const axisMoneyLabel = (value: number) => `₹${compactAxisNumber(value)}`;

const axisPercentageLabel = (value: number) => {
  const displayValue = Math.abs(value) < 0.05 ? 0 : value;
  const sign = displayValue > 0 ? "+" : displayValue < 0 ? "−" : "";
  return `${sign}${compactAxisNumber(Math.abs(displayValue))}%`;
};

const toTime = (date: string) => new Date(`${date}T00:00:00Z`).getTime();

const comparisonChartGeometry = (compact: boolean) => compact
  ? { height: 409, top: 84, bottom: 83 }
  : { height: 422, top: 75, bottom: 75 };

const distanceToSegment = (
  x: number,
  y: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(x - start.x, y - start.y);
  const ratio = Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared));
  return Math.hypot(x - (start.x + ratio * dx), y - (start.y + ratio * dy));
};

const distanceToSeries = (
  x: number,
  y: number,
  points: DrawnSeries["points"],
) => {
  if (!points.length) return Number.POSITIVE_INFINITY;
  if (points.length === 1) return Math.hypot(x - points[0].x, y - points[0].y);
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].x < x) low = middle + 1;
    else high = middle;
  }
  const right = Math.max(1, Math.min(points.length - 1, low));
  const left = right - 1;
  return distanceToSegment(x, y, points[left], points[right]);
};

export default function FundComparisonChart({ portfolio }: { portfolio: Portfolio }) {
  const headingId = useId();
  const pickerId = useId();
  const noteId = useId();
  const liveId = useId();
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const allFundsCheckboxRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const loadTriggeredRef = useRef(false);
  const drawnSeriesRef = useRef<DrawnSeries[]>([]);
  const plotGeometryRef = useRef<PlotGeometry | null>(null);
  const tooltipLayoutRef = useRef<FundComparisonTooltipLayout>();

  const candidates = useMemo(() => buildFundComparisonCandidates(portfolio), [portfolio]);
  const eligible = useMemo(
    () => candidates.filter((candidate) => Boolean(candidate.schemeCode)),
    [candidates],
  );
  const eligibleSignature = useMemo(
    () => `${portfolio.valuationDate}:${eligible.map((candidate) => `${candidate.key}:${candidate.schemeCode}`).join("|")}`,
    [eligible, portfolio.valuationDate],
  );
  const priorEligibleSignature = useRef(eligibleSignature);
  const candidateIndex = useMemo(
    () => new Map(candidates.map((candidate, index) => [candidate.key, index])),
    [candidates],
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(eligible.map((candidate) => candidate.key)),
  );
  const [historyByKey, setHistoryByKey] = useState<Map<string, HistoricalNavPoint[]>>(new Map());
  const [failedKeys, setFailedKeys] = useState<Set<string>>(new Set());
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("queued");
  const [loadProgress, setLoadProgress] = useState({ completed: 0, total: eligible.length });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusedFundKey, setFocusedFundKey] = useState<string | null>(null);
  const [period, setPeriod] = useState<ComparisonPeriod>("all");
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [verticalRange, setVerticalRange] = useState<IndexRange>([0, VERTICAL_RANGE_MAX]);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [hoveredFundKey, setHoveredFundKey] = useState<string | null>(null);
  const [tooltipLayout, setTooltipLayout] = useState<FundComparisonTooltipLayout>();
  const [keyboardAnnouncement, setKeyboardAnnouncement] = useState("");
  useEffect(() => {
    if (!allFundsCheckboxRef.current) return;
    allFundsCheckboxRef.current.indeterminate = selectedKeys.size > 0
      && selectedKeys.size < eligible.length;
  }, [eligible.length, selectedKeys]);

  const model = useMemo(
    () => buildFundComparisonModel(
      eligible,
      historyByKey,
      selectedKeys,
      portfolio.valuationDate,
    ),
    [eligible, historyByKey, portfolio.valuationDate, selectedKeys],
  );
  const priorModelDatesRef = useRef<readonly string[]>(model.dates);

  const rangeWindowDrag = useRangeWindowDrag({
    range,
    setRange,
    totalPoints: model.dates.length,
    onMoveStart: () => {
      setPeriod(null);
      setHoverDate(null);
      setHoveredFundKey(null);
      tooltipLayoutRef.current = undefined;
      setTooltipLayout(undefined);
    },
  });

  const visibleDates = useMemo(
    () => model.dates.slice(range[0], Math.min(model.dates.length, range[1] + 1)),
    [model.dates, range],
  );
  const visibleStart = visibleDates[0];
  const visibleEnd = visibleDates.at(-1);
  const visibleModel = useMemo(
    () => visibleStart && visibleEnd
      ? rebaseFundComparisonModel(model, visibleStart, visibleEnd)
      : rebaseFundComparisonModel(model, "", ""),
    [model, visibleEnd, visibleStart],
  );
  const baseVerticalScale = useMemo(
    () => buildFundComparisonScale(visibleModel),
    [visibleModel],
  );
  const verticalScale = useMemo(
    () => scaleForVerticalRange(baseVerticalScale, verticalRange),
    [baseVerticalScale, verticalRange],
  );
  const axisTicks = useMemo(
    () => buildFundComparisonAxisTicks(verticalScale),
    [verticalScale],
  );
  const activeFocusedFundKey = focusedFundKey
    && selectedKeys.has(focusedFundKey)
    && visibleModel.series.some((series) => series.key === focusedFundKey)
    ? focusedFundKey
    : null;
  const activeHoveredFundKey = hoveredFundKey
    && selectedKeys.has(hoveredFundKey)
    && visibleModel.series.some((series) => series.key === hoveredFundKey)
    ? hoveredFundKey
    : null;
  const emphasizedFundKey = activeFocusedFundKey ?? activeHoveredFundKey;
  const emphasisMode = activeFocusedFundKey
    ? "focus"
    : activeHoveredFundKey
      ? "hover"
      : "none";

  const colorFor = useCallback(
    (key: string) => stackFundColor(candidateIndex.get(key) ?? 0),
    [candidateIndex],
  );

  const filteredCandidates = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("en-IN");
    if (!normalized) return candidates;
    return candidates.filter((candidate) =>
      `${candidate.name} ${candidate.category} ${candidate.isin}`.toLocaleLowerCase("en-IN").includes(normalized));
  }, [candidates, query]);
  const activeCandidates = filteredCandidates.filter((candidate) => candidate.active);
  const closedCandidates = filteredCandidates.filter((candidate) => candidate.closed && !candidate.active);
  const historyLoadReady = shouldStartFundComparisonHistoryLoad(
    portfolio.navHistoryLoading,
    eligible.length,
  );

  const requestHistories = useCallback(async (targets: FundComparisonCandidate[]) => {
    if (!targets.length) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    const sequence = ++requestSequenceRef.current;
    requestRef.current = controller;
    setLoadPhase("loading");
    setLoadProgress({ completed: 0, total: targets.length });
    try {
      const result = await loadFundComparisonHistories(
        targets,
        portfolio.valuationDate,
        controller.signal,
        (progress) => {
          if (requestSequenceRef.current === sequence && !controller.signal.aborted) {
            setLoadProgress(progress);
          }
        },
      );
      if (requestSequenceRef.current !== sequence || controller.signal.aborted) return;
      setHistoryByKey((current) => {
        const merged = new Map(current);
        result.historyByKey.forEach((points, key) => merged.set(key, points));
        return merged;
      });
      setFailedKeys((current) => {
        const next = new Set(current);
        targets.forEach((target) => next.delete(target.key));
        result.failures.forEach((_message, key) => next.add(key));
        return next;
      });
      setLoadProgress({ completed: result.completed, total: result.total });
      setLoadPhase(result.failures.size
        ? (historyByKey.size || result.historyByKey.size ? "partial" : "error")
        : "ready");
    } catch {
      if (controller.signal.aborted || requestSequenceRef.current !== sequence) return;
      setFailedKeys((current) => new Set([...current, ...targets.map((target) => target.key)]));
      setLoadPhase("error");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [historyByKey.size, portfolio.valuationDate]);

  const retryFailed = useCallback(() => {
    const targets = eligible.filter((candidate) => failedKeys.has(candidate.key));
    void requestHistories(targets.length ? targets : eligible);
  }, [eligible, failedKeys, requestHistories]);

  useEffect(() => {
    if (priorEligibleSignature.current === eligibleSignature) return;
    priorEligibleSignature.current = eligibleSignature;
    requestRef.current?.abort();
    requestSequenceRef.current += 1;
    loadTriggeredRef.current = false;
    setSelectedKeys(new Set(eligible.map((candidate) => candidate.key)));
    setHistoryByKey(new Map());
    setFailedKeys(new Set());
    setLoadPhase("queued");
    setLoadProgress({ completed: 0, total: eligible.length });
    setFocusedFundKey(null);
    setHoverDate(null);
    setHoveredFundKey(null);
    tooltipLayoutRef.current = undefined;
    setTooltipLayout(undefined);
    setPeriod("all");
    setVerticalRange([0, VERTICAL_RANGE_MAX]);
  }, [eligible, eligibleSignature]);

  useEffect(() => {
    if (!historyLoadReady || loadTriggeredRef.current) return;
    loadTriggeredRef.current = true;
    void requestHistories(eligible);
  }, [eligible, historyLoadReady, requestHistories]);

  useEffect(() => () => {
    requestSequenceRef.current += 1;
    requestRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    const closeFromOutside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
        setQuery("");
      }
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPickerOpen(false);
      setQuery("");
      pickerTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [pickerOpen]);

  const setPeriodRange = useCallback((nextPeriod: Exclude<ComparisonPeriod, null>) => {
    setPeriod(nextPeriod);
    setFocusedFundKey(null);
    setHoverDate(null);
    setHoveredFundKey(null);
    tooltipLayoutRef.current = undefined;
    setTooltipLayout(undefined);
    if (nextPeriod === "all" || model.dates.length < 2) {
      setRange([0, Math.max(0, model.dates.length - 1)]);
      return;
    }
    const cutoff = new Date(`${model.dates.at(-1)}T00:00:00Z`);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - nextPeriod);
    const first = model.dates.findIndex((date) => toTime(date) >= cutoff.getTime());
    setRange([Math.max(0, first), model.dates.length - 1]);
  }, [model.dates]);

  useEffect(() => {
    const previousDates = priorModelDatesRef.current;
    if (model.dates.length) priorModelDatesRef.current = model.dates;
    const timer = globalThis.setTimeout(() => {
      if (!model.dates.length) {
        setHoverDate(null);
        return;
      }
      if (period === null) {
        setRange((current) => preserveFundComparisonDateRange(
          previousDates,
          current,
          model.dates,
        ));
      } else if (period === "all") {
        setRange([0, model.dates.length - 1]);
      } else {
        const cutoff = new Date(`${model.dates.at(-1)}T00:00:00Z`);
        cutoff.setUTCMonth(cutoff.getUTCMonth() - period);
        const first = model.dates.findIndex((date) => toTime(date) >= cutoff.getTime());
        setRange([Math.max(0, first), model.dates.length - 1]);
      }
      setHoverDate(null);
      setHoveredFundKey(null);
      tooltipLayoutRef.current = undefined;
      setTooltipLayout(undefined);
    }, 0);
    return () => globalThis.clearTimeout(timer);
  }, [model.dates, period]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const shell = shellRef.current;
    if (!canvas || !shell || !visibleStart || !visibleEnd || !visibleModel.series.length) {
      drawnSeriesRef.current = [];
      plotGeometryRef.current = null;
      return;
    }
    const width = shell.clientWidth;
    if (width < 2) return;
    const chartGeometry = comparisonChartGeometry(window.innerWidth <= 768);
    const height = chartGeometry.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(dpr, dpr);
    context.clearRect(0, 0, width, height);

    const horizontalAxisPadding = width < 520 ? 43 : 60;
    const padding = {
      left: horizontalAxisPadding,
      right: horizontalAxisPadding,
      top: chartGeometry.top,
      bottom: chartGeometry.bottom,
    };
    canvas.dataset.plotLeft = String(padding.left);
    canvas.dataset.plotRight = String(width - padding.right);
    canvas.dataset.plotTop = String(padding.top);
    canvas.dataset.plotBottom = String(padding.bottom);
    const chartWidth = Math.max(1, width - padding.left - padding.right);
    const chartHeight = Math.max(1, height - padding.top - padding.bottom);
    const firstTime = toTime(visibleStart);
    const lastTime = toTime(visibleEnd);
    const timeSpan = Math.max(1, lastTime - firstTime);
    const low = verticalScale.min;
    const high = verticalScale.max;
    const valueSpan = Math.max(1, high - low);
    const xForDate = (date: string) => padding.left + (toTime(date) - firstTime) / timeSpan * chartWidth;
    const yForValue = (value: number) => padding.top + (high - value) / valueSpan * chartHeight;
    plotGeometryRef.current = {
      height,
      left: padding.left,
      right: padding.right,
      top: padding.top,
      bottom: padding.bottom,
      firstTime,
      lastTime,
      low,
      high,
    };

    context.textBaseline = "middle";
    axisTicks.forEach(({ value, percentageChange }) => {
      const y = yForValue(value);
      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(width - padding.right, y);
      context.strokeStyle = Math.abs(value - 100) < valueSpan / 10
        ? "rgba(29,157,97,.22)"
        : "rgba(11,29,42,.085)";
      context.setLineDash(Math.abs(value - 100) < valueSpan / 10 ? [] : [3, 5]);
      context.lineWidth = 1;
      context.stroke();
      context.setLineDash([]);
      const labelOffset = width < 520 ? 5 : 8;
      const moneyLabel = axisMoneyLabel(value);
      const percentageLabel = axisPercentageLabel(percentageChange);
      for (const side of ["left", "right"] as const) {
        const x = side === "left"
          ? padding.left - labelOffset
          : width - padding.right + labelOffset;
        context.textAlign = side === "left" ? "right" : "left";
        context.fillStyle = "#53635B";
        context.font = `${width < 520 ? 7.2 : 8.3}px Arial, sans-serif`;
        context.fillText(moneyLabel, x, y - 5);
        context.fillStyle = Math.abs(percentageChange) < 0.05 ? "#087A4B" : "#738078";
        context.font = `600 ${width < 520 ? 6.5 : 7.4}px Arial, sans-serif`;
        context.fillText(percentageLabel, x, y + 5);
      }
    });

    const baselineY = yForValue(100);
    context.beginPath();
    context.moveTo(padding.left, baselineY);
    context.lineTo(width - padding.right, baselineY);
    context.strokeStyle = "rgba(29,157,97,.4)";
    context.setLineDash([2, 4]);
    context.stroke();
    context.setLineDash([]);

    const geometries: DrawnSeries[] = [];
    for (const series of visibleModel.series) {
      const geometry = series.points.map((point) => ({
        x: xForDate(point.date),
        y: yForValue(point.indexedValue),
        date: point.date,
      }));
      geometries.push({ key: series.key, points: geometry });
      const dimmed = Boolean(emphasizedFundKey && emphasizedFundKey !== series.key);
      context.beginPath();
      geometry.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      context.strokeStyle = colorFor(series.key);
      context.globalAlpha = dimmed ? 0.12 : emphasizedFundKey === series.key ? 1 : 0.82;
      context.lineWidth = fundComparisonLineWidth(
        dimmed ? "dimmed" : emphasizedFundKey === series.key ? "emphasized" : "resting",
      );
      context.lineJoin = "round";
      context.lineCap = "round";
      context.stroke();
      if (geometry.length === 1) {
        context.beginPath();
        context.arc(geometry[0].x, geometry[0].y, 3, 0, Math.PI * 2);
        context.fillStyle = colorFor(series.key);
        context.fill();
      }

      context.globalAlpha = 1;
    }
    drawnSeriesRef.current = geometries;

    const labelCount = width < 520 ? 3 : 5;
    context.font = "9px Arial, sans-serif";
    context.fillStyle = "#7D8A83";
    context.textAlign = "center";
    for (let label = 0; label < labelCount; label += 1) {
      const time = firstTime + timeSpan * label / Math.max(1, labelCount - 1);
      const nearestDate = visibleDates.reduce((nearest, date) =>
        Math.abs(toTime(date) - time) < Math.abs(toTime(nearest) - time) ? date : nearest,
      visibleDates[0]);
      context.fillText(compactDate(nearestDate), xForDate(nearestDate), height - 13);
    }

    if (hoverDate && hoveredFundKey) {
      const row = fundComparisonTooltipAt(visibleModel, hoverDate, hoveredFundKey)[0];
      if (row?.available && row.indexedValue !== undefined) {
        const x = xForDate(row.date);
        const y = yForValue(row.indexedValue);
        context.save();
        context.beginPath();
        context.moveTo(x, padding.top);
        context.lineTo(x, height - padding.bottom);
        context.strokeStyle = colorFor(row.key);
        context.globalAlpha = activeFocusedFundKey === row.key ? 0.34 : 0.22;
        context.lineWidth = 1;
        context.setLineDash([3, 4]);
        context.stroke();
        context.restore();
        context.beginPath();
        context.arc(x, y, activeFocusedFundKey === row.key ? 5.5 : 4.5, 0, Math.PI * 2);
        context.fillStyle = "#FDFCF7";
        context.strokeStyle = colorFor(row.key);
        context.lineWidth = activeFocusedFundKey === row.key ? 3 : 2.2;
        context.fill();
        context.stroke();
      }
    }
  }, [activeFocusedFundKey, axisTicks, colorFor, emphasizedFundKey, hoverDate, hoveredFundKey, verticalScale, visibleDates, visibleEnd, visibleModel, visibleStart]);

  useResponsiveCanvasRedraw(shellRef, draw);

  const clearHover = useCallback(() => {
    setHoverDate(null);
    setHoveredFundKey(null);
    tooltipLayoutRef.current = undefined;
    setTooltipLayout(undefined);
  }, []);

  const inspectFundAtClientX = useCallback((fundKey: string, clientX: number, keyboard = false) => {
    const canvas = canvasRef.current;
    const drawn = drawnSeriesRef.current.find((series) => series.key === fundKey);
    if (!canvas || !drawn?.points.length) return;
    const bounds = canvas.getBoundingClientRect();
    const localX = clientX - bounds.left;
    const point = drawn.points.reduce((nearest, candidate) =>
      Math.abs(candidate.x - localX) < Math.abs(nearest.x - localX) ? candidate : nearest,
    drawn.points[0]);
    const plot = plotGeometryRef.current;
    if (!plot) return;
    const compact = bounds.width < 520;
    const layout = placeFundComparisonTooltip({
      anchor: point,
      tooltip: {
        width: Math.min(compact ? 204 : 240, Math.max(1, bounds.width - 12)),
        height: compact ? 72 : 64,
      },
      canvas: { width: bounds.width, height: plot.height },
      plot: {
        left: plot.left,
        right: bounds.width - plot.right,
        top: plot.top,
        bottom: plot.height - plot.bottom,
      },
      series: drawnSeriesRef.current.map((series) => series.points),
      previous: tooltipLayoutRef.current,
    });
    setHoveredFundKey(fundKey);
    setHoverDate(point.date);
    tooltipLayoutRef.current = layout;
    setTooltipLayout(layout);
    if (keyboard) {
      const row = fundComparisonTooltipAt(visibleModel, point.date, fundKey)[0];
      if (row?.nav !== undefined && row.indexedValue !== undefined) {
        setKeyboardAnnouncement(`${row.name}, ${fullDate(point.date)}. NAV ${formatInr(row.nav, 4)}. ₹100 grew to ${indexedMoney(row.indexedValue)}.`);
      }
    }
  }, [visibleModel]);

  const onCanvasPointerMove = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const plot = plotGeometryRef.current;
    const insidePlot = plot
      && x >= plot.left
      && x <= bounds.width - plot.right
      && y >= plot.top
      && y <= plot.height - plot.bottom;
    if (!insidePlot) {
      clearHover();
      return;
    }
    if (activeFocusedFundKey) {
      const focused = drawnSeriesRef.current.find((series) => series.key === activeFocusedFundKey);
      const firstPoint = focused?.points[0];
      const lastPoint = focused?.points.at(-1);
      if (!focused || !firstPoint || !lastPoint || x < firstPoint.x || x > lastPoint.x) {
        clearHover();
        return;
      }
      inspectFundAtClientX(focused.key, event.clientX);
      return;
    }
    let nearest: DrawnSeries | undefined;
    let nearestDistance = 12;
    for (const series of drawnSeriesRef.current) {
      const distance = distanceToSeries(x, y, series.points);
      if (distance <= nearestDistance) {
        nearest = series;
        nearestDistance = distance;
      }
    }
    if (!nearest) {
      clearHover();
      return;
    }
    inspectFundAtClientX(nearest.key, event.clientX);
  }, [activeFocusedFundKey, clearHover, inspectFundAtClientX]);

  const onCanvasClick = useCallback((event: ReactMouseEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    let nearestKey: string | null = null;
    let nearestDistance = 10;
    for (const series of drawnSeriesRef.current) {
      const distance = distanceToSeries(x, y, series.points);
      if (distance <= nearestDistance) {
        nearestDistance = distance;
        nearestKey = series.key;
      }
    }
    setFocusedFundKey(nearestKey);
    if (nearestKey) inspectFundAtClientX(nearestKey, event.clientX);
    else clearHover();
  }, [clearHover, inspectFundAtClientX]);

  const onCanvasKeyDown = useCallback((event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === "Escape") {
      setFocusedFundKey(null);
      clearHover();
      setKeyboardAnnouncement("All selected fund lines are active.");
      event.preventDefault();
      return;
    }
    const bounds = canvasRef.current?.getBoundingClientRect();
    const drawn = drawnSeriesRef.current;
    if (!bounds || !drawn.length) return;
    if (["ArrowUp", "ArrowDown"].includes(event.key)) {
      const currentKey = activeFocusedFundKey ?? hoveredFundKey;
      const currentIndex = Math.max(-1, drawn.findIndex((series) => series.key === currentKey));
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = currentIndex < 0
        ? (delta > 0 ? 0 : drawn.length - 1)
        : (currentIndex + delta + drawn.length) % drawn.length;
      const nextSeries = drawn[nextIndex];
      setFocusedFundKey(nextSeries.key);
      const currentPoint = nextSeries.points.find((point) => point.date === hoverDate)
        ?? nextSeries.points.at(-1);
      if (currentPoint) inspectFundAtClientX(nextSeries.key, bounds.left + currentPoint.x, true);
      event.preventDefault();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const fundKey = activeFocusedFundKey ?? hoveredFundKey ?? drawn[0].key;
    const series = drawn.find((candidate) => candidate.key === fundKey) ?? drawn[0];
    const current = Math.max(0, series.points.findIndex((point) => point.date === hoverDate));
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? series.points.length - 1
        : Math.max(0, Math.min(series.points.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1)));
    inspectFundAtClientX(series.key, bounds.left + series.points[next].x, true);
    event.preventDefault();
  }, [activeFocusedFundKey, clearHover, hoverDate, hoveredFundKey, inspectFundAtClientX]);

  const toggleCandidate = (key: string) => {
    if (focusedFundKey === key && selectedKeys.has(key)) setFocusedFundKey(null);
    if (hoveredFundKey === key && selectedKeys.has(key)) clearHover();
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const tooltipRow = hoverDate && hoveredFundKey
    ? fundComparisonTooltipAt(visibleModel, hoverDate, hoveredFundKey)[0]
    : undefined;
  const allFundsSelected = eligible.length > 0 && selectedKeys.size === eligible.length;
  const historyState = !eligible.length
    ? "unavailable"
    : loadPhase;
  const pickerLabel = allFundsSelected
    ? eligible.length
      ? `All ${eligible.length} funds`
      : `${candidates.length} in CAS · none available`
    : `${selectedKeys.size} of ${eligible.length} funds`;
  const canvasLabel = model.baselineDate && visibleStart && visibleEnd
    ? `Fund NAV comparison for ${visibleModel.series.length} funds visible in the selected range. Each line is rebased to 100 at that fund's first actual published NAV within the visible range. Both Y axes show the same indexed rupee values and signed percentage change from ₹100. Full history begins ${fullDate(model.baselineDate)} and the visible range is ${fullDate(visibleStart)} to ${fullDate(visibleEnd)}. Use up and down arrows to focus a fund, left and right arrows to inspect its published dates, and Escape to show all lines.`
    : "Fund NAV comparison awaiting exact published history.";

  const renderOptions = (items: FundComparisonCandidate[], label: string) => items.length ? (
    <div role="group" aria-label={label}>
      <span className="fund-comparison-group-label">{label}</span>
      {items.map((candidate) => (
        <label className={`fund-comparison-option${candidate.schemeCode ? "" : " unavailable"}`} key={candidate.key}>
          <input
            type="checkbox"
            checked={selectedKeys.has(candidate.key)}
            disabled={!candidate.schemeCode}
            onChange={() => toggleCandidate(candidate.key)}
          />
          <i aria-hidden="true" style={{ background: colorFor(candidate.key) }} />
          <span>
            <strong title={candidate.name}>{candidate.name}</strong>
            <small>{candidate.category} · {candidate.isin}</small>
          </span>
          <em>{!candidate.schemeCode
            ? "Published history unavailable"
            : failedKeys.has(candidate.key)
              ? "Retry needed"
              : candidate.active && candidate.closed
                ? "Current · previously closed"
                : candidate.closed
                  ? "Closed"
                  : "Current"}</em>
        </label>
      ))}
    </div>
  ) : null;

  return (
    <section
      className="fund-comparison-card"
      aria-labelledby={headingId}
      data-total-funds={candidates.length}
      data-available-funds={eligible.length}
      data-selected-funds={selectedKeys.size}
      data-loaded-funds={historyByKey.size}
      data-failed-funds={failedKeys.size}
      data-history-state={historyState}
    >
      <div className="fund-comparison-head">
        <div><p className="eyebrow">Every fund on equal footing</p><h2 id={headingId}>Growth of ₹100</h2></div>
        <div className="fund-comparison-periods" aria-label="Fund comparison period">
          <button type="button" className={period === 12 ? "active" : ""} onClick={() => setPeriodRange(12)}>1Y</button>
          <button type="button" className={period === 36 ? "active" : ""} onClick={() => setPeriodRange(36)}>3Y</button>
          <button type="button" className={period === 60 ? "active" : ""} onClick={() => setPeriodRange(60)}>5Y</button>
          <button type="button" className={period === 96 ? "active" : ""} onClick={() => setPeriodRange(96)}>8Y</button>
          <button type="button" className={period === 120 ? "active" : ""} onClick={() => setPeriodRange(120)}>10Y</button>
          <button type="button" className={period === "all" ? "active" : ""} onClick={() => setPeriodRange("all")}>All</button>
        </div>
      </div>

      <div className="fund-comparison-toolbar">
        <div
          className={`fund-comparison-summary${loadPhase === "error" || loadPhase === "partial" ? " error" : ""}`}
          role="status"
          aria-live="polite"
          aria-busy={loadPhase === "loading"}
        >
          {loadPhase === "loading" && <i className="nav-scope-spinner" aria-hidden="true" />}
          {loadPhase !== "loading" && <i aria-hidden="true" />}
          <span>
            {!eligible.length
              ? <><strong>Published comparison unavailable.</strong> No current or closed fund has an official scheme match.</>
              : loadPhase === "queued"
                ? <><strong>Comparison preload queued.</strong> It starts automatically after daily NAV history finishes.</>
                : loadPhase === "loading"
                  ? <><strong>Loading full NAV histories.</strong> {Math.min(loadProgress.completed, loadProgress.total)} of {loadProgress.total} processed.</>
                  : loadPhase === "partial"
                    ? <><strong>{historyByKey.size} histories ready.</strong> {failedKeys.size} could not be loaded.</>
                    : loadPhase === "error"
                      ? <><strong>Published histories could not be loaded.</strong> Your portfolio values are unchanged.</>
                      : model.baselineDate
                        ? <><strong>Full published plan history from {fullDate(model.baselineDate)}.</strong> The visible range rebases every fund to ₹100.</>
                        : <><strong>Exact histories loaded.</strong> Choose a fund with published NAV history.</>}
          </span>
          {(loadPhase === "partial" || loadPhase === "error") && (
            <button type="button" className="fund-comparison-retry" onClick={retryFailed}>Retry</button>
          )}
        </div>

        <div className="fund-comparison-picker" ref={pickerRef}>
          <button
            ref={pickerTriggerRef}
            type="button"
            className="fund-comparison-picker-trigger"
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            aria-controls={pickerId}
            disabled={!candidates.length}
            onClick={() => setPickerOpen((current) => !current)}
          >
            <span>{pickerLabel}</span><i aria-hidden="true" />
          </button>
          {pickerOpen && (
            <div id={pickerId} className="fund-comparison-popover" role="dialog" aria-label="Choose funds to compare">
              <header>
                <div><strong>Choose funds</strong><span>{selectedKeys.size} of {eligible.length} available funds selected · {candidates.length} in CAS</span></div>
                <button
                  type="button"
                  aria-label="Close fund selector"
                  onClick={() => {
                    setPickerOpen(false);
                    setQuery("");
                    pickerTriggerRef.current?.focus();
                  }}
                >×</button>
              </header>
              <div className="fund-comparison-picker-tools">
                <label className="fund-comparison-search">
                  <span aria-hidden="true">⌕</span>
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    aria-label="Search funds to compare"
                    placeholder="Search funds"
                  />
                </label>
                <div className="fund-comparison-picker-actions">
                  <label className="fund-comparison-all-option">
                    <input
                      ref={allFundsCheckboxRef}
                      type="checkbox"
                      checked={allFundsSelected}
                      disabled={!eligible.length}
                      onChange={(event) => {
                        setFocusedFundKey(null);
                        clearHover();
                        setSelectedKeys(event.target.checked
                          ? new Set(eligible.map((candidate) => candidate.key))
                          : new Set());
                      }}
                    />
                    <span>All funds</span>
                  </label>
                  <span aria-live="polite">{filteredCandidates.length} {filteredCandidates.length === 1 ? "fund" : "funds"} shown</span>
                </div>
              </div>
              <div className="fund-comparison-options">
                {renderOptions(activeCandidates, "Current holdings")}
                {renderOptions(closedCandidates, "Closed funds")}
                {!filteredCandidates.length && <div className="fund-comparison-no-results">No funds match “{query}”. Your existing selections are unchanged.</div>}
              </div>
            </div>
          )}
        </div>
      </div>

      {!selectedKeys.size ? (
        <div className="fund-comparison-empty"><div><strong>No funds selected</strong>Choose one or more funds to compare their exact published NAV history.<br /><button type="button" onClick={() => setPickerOpen(true)}>Choose funds</button></div></div>
      ) : loadPhase === "loading" && !model.series.length ? (
        <div className="fund-comparison-empty" aria-hidden="true"><div><strong>Preparing the comparison</strong>Full published histories are loading. The chart space is reserved so the dashboard does not jump.</div></div>
      ) : model.series.length && model.baselineDate && visibleStart && visibleEnd ? (
        <>
          <div className="fund-comparison-stage">
            <VerticalScaleControl
              range={verticalRange}
              scale={verticalScale}
              setRange={setVerticalRange}
            />
            <div
              className="fund-comparison-shell"
              ref={shellRef}
              onPointerLeave={clearHover}
            >
              <canvas
                ref={canvasRef}
                role="img"
                tabIndex={0}
                aria-label={canvasLabel}
                aria-describedby={`${noteId} ${liveId}`}
                data-baseline="100"
                data-earliest-history-date={model.baselineDate}
                data-series-start-dates={model.series.map((series) => series.points[0]?.date).filter(Boolean).join(",")}
                data-visible-series-start-dates={visibleModel.series.map((series) => series.points[0]?.date).filter(Boolean).join(",")}
                data-series-baselines={visibleModel.series.map((series) => series.points[0]?.indexedValue).filter((value) => value !== undefined).join(",")}
                data-visible-funds={visibleModel.series.length}
                data-locked-fund={focusedFundKey ?? ""}
                data-focused-fund={activeFocusedFundKey ?? ""}
                data-hover-fund={hoveredFundKey ?? ""}
                data-emphasized-fund={emphasizedFundKey ?? ""}
                data-emphasis-mode={emphasisMode}
                data-dimmed-funds={emphasizedFundKey ? Math.max(0, visibleModel.series.length - 1) : 0}
                data-resting-line-width={fundComparisonLineWidth("resting")}
                data-emphasized-line-width={fundComparisonLineWidth("emphasized")}
                data-dimmed-line-width={fundComparisonLineWidth("dimmed")}
                data-active-line-width={fundComparisonLineWidth(emphasizedFundKey ? "emphasized" : "resting")}
                data-visible-start={visibleStart}
                data-visible-end={visibleEnd}
                data-axis-min={verticalScale.min}
                data-axis-max={verticalScale.max}
                data-y-axis-sides="left,right"
                data-y-axis-ticks={axisTicks.map((tick) => `${axisMoneyLabel(tick.value)} ${axisPercentageLabel(tick.percentageChange)}`).join("|")}
                data-vertical-lower={verticalRange[0]}
                data-vertical-upper={verticalRange[1]}
                data-hover-date={hoverDate ?? ""}
                data-guide-date={tooltipRow ? hoverDate ?? "" : ""}
                data-guide-visible={tooltipRow ? "true" : "false"}
                data-pointer-track-mode={tooltipRow
                  ? activeFocusedFundKey ? "focused-timeline" : "line-hover"
                  : "none"}
                data-tooltip-fund-count={tooltipRow ? 1 : 0}
                onPointerMove={onCanvasPointerMove}
                onClick={onCanvasClick}
                onKeyDown={onCanvasKeyDown}
              />
              {hoverDate && tooltipLayout && tooltipRow?.nav !== undefined && tooltipRow.indexedValue !== undefined && (
                <div
                  className="fund-comparison-tooltip"
                  data-placement={tooltipLayout.placement}
                  data-anchor-x={tooltipLayout.anchorX.toFixed(2)}
                  data-anchor-y={tooltipLayout.anchorY.toFixed(2)}
                  data-layout-left={tooltipLayout.left.toFixed(2)}
                  data-layout-top={tooltipLayout.top.toFixed(2)}
                  style={{
                    width: `${tooltipLayout.width}px`,
                    height: `${tooltipLayout.height}px`,
                    transform: `translate3d(${tooltipLayout.left}px, ${tooltipLayout.top}px, 0)`,
                  }}
                  onPointerMove={(event) => event.stopPropagation()}
                >
                  <header>
                    <i aria-hidden="true" style={{ background: colorFor(tooltipRow.key) }} />
                    <strong title={tooltipRow.name}>{tooltipRow.name}</strong>
                    {activeFocusedFundKey && <span>Focused</span>}
                  </header>
                  <time>{fullDate(hoverDate)} · Published NAV</time>
                  <div className="fund-comparison-tooltip-metrics">
                    <span>NAV<b>{formatInr(tooltipRow.nav, 4)}</b></span>
                    <span>₹100 value<b>{indexedMoney(tooltipRow.indexedValue)}</b></span>
                  </div>
                  <p>{tooltipRow.indexedValue >= 100 ? "+" : ""}{(tooltipRow.indexedValue - 100).toFixed(2)}% within the selected range</p>
                </div>
              )}
            </div>
          </div>
          {model.dates.length > 1 && (
            <div className="fund-comparison-range">
              <div className="fund-comparison-range-dates" aria-live="polite"><span>{fullDate(visibleStart)}</span><span>{fullDate(visibleEnd)}</span></div>
              <div className="range-track" aria-label="Visible fund comparison range">
                <div
                  className={`range-fill${rangeWindowDrag.movable ? " draggable" : ""}`}
                  role="slider"
                  aria-label="Move visible fund comparison window"
                  aria-valuemin={0}
                  aria-valuemax={Math.max(0, model.dates.length - (range[1] - range[0] + 1))}
                  aria-valuenow={range[0]}
                  aria-valuetext={`${fullDate(model.dates[range[0]] ?? model.dates[0])} to ${fullDate(model.dates[range[1]] ?? model.dates.at(-1) ?? model.dates[0])}`}
                  tabIndex={rangeWindowDrag.movable ? 0 : -1}
                  onKeyDown={rangeWindowDrag.onKeyDown}
                  onPointerCancel={rangeWindowDrag.onPointerCancel}
                  onPointerDown={rangeWindowDrag.onPointerDown}
                  onPointerMove={rangeWindowDrag.onPointerMove}
                  onPointerUp={rangeWindowDrag.onPointerUp}
                  style={{
                    left: `${range[0] / Math.max(1, model.dates.length - 1) * 100}%`,
                    right: `${100 - range[1] / Math.max(1, model.dates.length - 1) * 100}%`,
                  }}
                />
                <input
                  aria-label="Fund comparison start"
                  type="range"
                  min={0}
                  max={Math.max(1, model.dates.length - 2)}
                  value={range[0]}
                  onChange={(event) => {
                    setPeriod(null);
                    setHoverDate(null);
                    setHoveredFundKey(null);
                    tooltipLayoutRef.current = undefined;
                    setTooltipLayout(undefined);
                    setRange([Math.min(Number(event.target.value), range[1] - 1), range[1]]);
                  }}
                />
                <input
                  aria-label="Fund comparison end"
                  type="range"
                  min={1}
                  max={Math.max(1, model.dates.length - 1)}
                  value={range[1]}
                  onChange={(event) => {
                    setPeriod(null);
                    setHoverDate(null);
                    setHoveredFundKey(null);
                    tooltipLayoutRef.current = undefined;
                    setTooltipLayout(undefined);
                    setRange([range[0], Math.max(Number(event.target.value), range[0] + 1)]);
                  }}
                />
              </div>
            </div>
          )}
        </>
      ) : loadPhase === "queued" ? (
        <div className="fund-comparison-empty"><div><strong>Comparison preload queued</strong>Full fund histories begin automatically after the daily NAV loading stage.</div></div>
      ) : (
        <div className="fund-comparison-empty"><div><strong>No published NAV history</strong>The selected funds do not have an official history available for this comparison.{failedKeys.size ? <><br /><button type="button" onClick={retryFailed}>Retry histories</button></> : null}</div></div>
      )}

      <p id={noteId} className="fund-comparison-note"><strong>How this is calculated:</strong> in every selected range, each fund restarts at ₹100 on its first actual published NAV inside that range. All reaches back to the earliest exact plan history available; Direct-plan records commonly begin in January 2013 and are never replaced with a different Regular-plan series. Missing dates are never interpolated or forward-filled. Connecting strokes are visual guides between published observations.</p>
      <span id={liveId} className="fund-comparison-live" role="status" aria-live="polite">{keyboardAnnouncement}</span>
    </section>
  );
}
