"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  CHART_LENS_CONTENT_INSET,
  chartLensGeometry,
  chartLensMovementBounds,
  insetChartLensGeometry,
  lensDisplayPoint,
  lensSourcePoint,
  pointIsInsideChartLens,
  shiftNormalizedChartLensPosition,
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
  if (mode === "contribution") return point.totalContribution;
  return point.totalPeriodChange ?? 0;
};

export const stackModeTitle = (mode: FundStackMode) => {
  if (mode === "value") return "Fund value";
  if (mode === "invested") return "Net invested";
  if (mode === "contribution") return "Contribution";
  return "Period change";
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
  cursorX: number;
  cursorY: number;
  markerVisible: boolean;
  tooltipLeft: number;
  tooltipTop: number;
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
    captureTarget: HTMLCanvasElement;
    startX: number;
    startY: number;
    startLensX: number;
    startLensY: number;
    moved: boolean;
  } | null>(null);
  const latestLensDrawRef = useRef<() => void>(() => undefined);
  const lensMoveFrameRef = useRef<number | null>(null);
  const pendingLensPositionRef = useRef<{ x: number; y: number } | null>(null);
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
    const contentGeometry = insetChartLensGeometry(geometry, CHART_LENS_CONTENT_INSET);
    const insideLens = lens.enabled && pointIsInsideChartLens(raw.x, raw.y, contentGeometry);
    const source = insideLens
      ? lensSourcePoint(raw.x, raw.y, geometry, lens.magnification)
      : raw;
    return { raw, source, insideLens, geometry, contentGeometry, padding };
  }, [lens]);

  const updateHover = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect || !visible.length) return;
    const resolved = resolvePointer(event.clientX, event.clientY, rect);
    const { padding } = resolved;
    const chartHeight = rect.height - padding.top - padding.bottom;
    if (
      resolved.source.x < padding.left
      || resolved.source.x > rect.width - padding.right
      || resolved.source.y < padding.top
      || resolved.source.y > rect.height - padding.bottom
    ) {
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
    const displayPoint = resolved.insideLens
      ? lensDisplayPoint(sourceX, sourceY, resolved.geometry, lens.magnification)
      : { x: sourceX, y: sourceY };
    const markerVisible = !resolved.insideLens
      || pointIsInsideChartLens(displayPoint.x, displayPoint.y, resolved.contentGeometry);
    const x = displayPoint.x;
    const y = displayPoint.y;
    const cursorX = resolved.raw.x;
    const cursorY = resolved.raw.y;
    const tooltipWidth = Math.min(218, rect.width - 16);
    const tooltipAnchorX = resolved.insideLens ? cursorX : x;
    const preferredLeft = tooltipAnchorX < rect.width / 2 ? tooltipAnchorX + 14 : tooltipAnchorX - tooltipWidth - 14;
    const tooltipLeft = Math.max(8, Math.min(rect.width - tooltipWidth - 8, preferredLeft));
    const tooltipHeight = fundIndex === null ? 122 : mode === "periodChange" ? 182 : 158;
    const tooltipTop = resolved.insideLens && resolved.geometry.centerY < rect.height / 2
      ? Math.max(8, rect.height - tooltipHeight - 8)
      : 8;

    setHover((current) => current
      && current.point === point
      && current.fundIndex === fundIndex
      && current.viewKey === viewKey
      && current.insideLens === resolved.insideLens
      && Math.abs(current.x - x) < 0.5
      && Math.abs(current.y - y) < 0.5
      && Math.abs(current.cursorX - cursorX) < 0.5
      && Math.abs(current.cursorY - cursorY) < 0.5
      && current.markerVisible === markerVisible
      && current.tooltipTop === tooltipTop
        ? current
        : { pointIndex, point, fundIndex, viewKey, x, y, cursorX, cursorY, markerVisible, tooltipLeft, tooltipTop, insideLens: resolved.insideLens });
  }, [bounds, lens.magnification, mode, pointerToIndex, resolvePointer, scale, viewKey, visible, visibleTimes]);

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

  const renderChart = useCallback((
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    detailScale = 1,
  ) => {
    const padding = chartPadding(width);
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

    context.lineCap = "round";
    context.lineJoin = "round";
    context.font = `${10 * detailScale}px Arial, sans-serif`;
    context.textBaseline = "middle";
    for (const tick of scale.ticks) {
      const y = yFor(tick);
      context.strokeStyle = tick === 0 ? "rgba(11, 29, 42, 0.22)" : "rgba(11, 29, 42, 0.08)";
      context.lineWidth = (tick === 0 ? 1.2 : 1) * detailScale;
      context.setLineDash(tick === 0 ? [] : [3 * detailScale, 6 * detailScale]);
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
      context.lineWidth = 0.65 * detailScale;
      context.stroke();
    });

    context.beginPath();
    visible.forEach((point, index) => {
      const y = yFor(modeTotal(point, mode));
      if (index === 0) context.moveTo(xFor(index), y);
      else context.lineTo(xFor(index), y);
    });
    context.strokeStyle = "rgba(11,29,42,.72)";
    context.lineWidth = 1.6 * detailScale;
    context.setLineDash(mode === "contribution" || mode === "periodChange" ? [5 * detailScale, 4 * detailScale] : []);
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
      context.lineWidth = 1.3 * detailScale;
      context.beginPath();
      context.moveTo(x, padding.top);
      context.lineTo(x, height - padding.bottom);
      context.stroke();
      context.fillStyle = "#0B1D2A";
      const markerY = yFor(modeTotal(visible[selectedIndex], mode));
      if (markerY >= padding.top && markerY <= height - padding.bottom) {
        context.beginPath();
        context.arc(x, markerY, 4 * detailScale, 0, Math.PI * 2);
        context.fill();
      }
    }
  }, [bounds, mode, model.funds, scale, selectedDate, visible, visibleTimes]);

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
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    renderChart(context, width, height);
  }, [renderChart, visible.length]);

  const positionLens = useCallback(() => {
    const lensCanvas = lensCanvasRef.current;
    const shell = shellRef.current;
    if (!lensCanvas || !shell) return null;
    if (!lens.enabled || !visible.length) {
      lensCanvas.style.display = "none";
      return null;
    }

    const width = shell.clientWidth;
    const height = 390;
    const shellRect = shell.getBoundingClientRect();
    const geometry = chartLensGeometry(width, height, chartPadding(width), lens);
    const diameter = Math.ceil(geometry.radius * 2 + 8);
    const localCenter = diameter / 2;
    lensCanvas.style.display = "block";
    lensCanvas.style.width = `${diameter}px`;
    lensCanvas.style.setProperty("height", `${diameter}px`, "important");
    lensCanvas.style.transform = `translate3d(${shellRect.left + geometry.centerX - localCenter}px, ${shellRect.top + geometry.centerY - localCenter}px, 0)`;
    return { lensCanvas, width, height, geometry, diameter, localCenter };
  }, [lens, visible.length]);

  const drawLens = useCallback(() => {
    const positioned = positionLens();
    if (!positioned) return;
    const { lensCanvas, width, height, geometry, diameter, localCenter } = positioned;
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
    const pixelSize = Math.round(diameter * dpr);
    if (lensCanvas.width !== pixelSize || lensCanvas.height !== pixelSize) {
      lensCanvas.width = pixelSize;
      lensCanvas.height = pixelSize;
    }
    const context = lensCanvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, diameter, diameter);
    const destinationLeft = localCenter - geometry.radius;
    const destinationTop = localCenter - geometry.radius;

    context.save();
    context.fillStyle = "#fdfcf7";
    context.beginPath();
    context.arc(localCenter, localCenter, geometry.radius - 2, 0, Math.PI * 2);
    context.fill();
    context.restore();

    context.save();
    context.beginPath();
    context.arc(localCenter, localCenter, geometry.radius - CHART_LENS_CONTENT_INSET, 0, Math.PI * 2);
    context.clip();
    context.fillStyle = "#fdfcf7";
    context.fillRect(destinationLeft, destinationTop, geometry.radius * 2, geometry.radius * 2);
    context.translate(localCenter, localCenter);
    context.scale(lens.magnification, lens.magnification);
    context.translate(-geometry.focusX, -geometry.focusY);
    renderChart(context, width, height, 1 / lens.magnification);
    context.restore();

    context.save();
    context.beginPath();
    context.arc(localCenter, localCenter, geometry.radius - CHART_LENS_CONTENT_INSET, 0, Math.PI * 2);
    context.clip();
    const sheen = context.createLinearGradient(
      destinationLeft,
      destinationTop,
      localCenter + geometry.radius * 0.35,
      localCenter + geometry.radius * 0.35,
    );
    sheen.addColorStop(0, "rgba(255,255,255,.28)");
    sheen.addColorStop(0.38, "rgba(255,255,255,.04)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = sheen;
    context.fillRect(destinationLeft, destinationTop, geometry.radius * 2, geometry.radius * 2);
    const vignette = context.createRadialGradient(
      localCenter,
      localCenter,
      geometry.radius * 0.72,
      localCenter,
      localCenter,
      geometry.radius,
    );
    vignette.addColorStop(0, "rgba(11,29,42,0)");
    vignette.addColorStop(1, "rgba(11,29,42,.10)");
    context.fillStyle = vignette;
    context.fillRect(destinationLeft, destinationTop, geometry.radius * 2, geometry.radius * 2);
    context.restore();

    context.strokeStyle = "rgba(255,255,255,.94)";
    context.lineWidth = 5;
    context.beginPath();
    context.arc(localCenter, localCenter, geometry.radius - 4, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = dragging ? "#087A4B" : "#315e4d";
    context.lineWidth = dragging ? 3 : 2.25;
    context.beginPath();
    context.arc(localCenter, localCenter, geometry.radius - 1.5, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = dragging ? "rgba(8,122,75,.30)" : "rgba(49,94,77,.18)";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(localCenter, localCenter, geometry.radius + 1.5, 0, Math.PI * 2);
    context.stroke();
  }, [dragging, lens.magnification, positionLens, renderChart]);

  useEffect(() => {
    if (lens.enabled) return;
    const drag = dragRef.current;
    dragRef.current = null;
    pendingLensPositionRef.current = null;
    suppressClickRef.current = false;
    if (lensMoveFrameRef.current !== null) {
      cancelAnimationFrame(lensMoveFrameRef.current);
      lensMoveFrameRef.current = null;
    }
    if (drag?.captureTarget.hasPointerCapture(drag.pointerId)) {
      drag.captureTarget.releasePointerCapture(drag.pointerId);
    }
    if (canvasRef.current) canvasRef.current.style.cursor = "crosshair";
    if (lensCanvasRef.current) lensCanvasRef.current.style.cursor = "grab";
    requestAnimationFrame(() => {
      setHover(null);
      setDragging(false);
    });
  }, [lens.enabled]);

  useEffect(() => {
    latestLensDrawRef.current = drawLens;
    drawLens();
  }, [drawLens]);

  useEffect(() => {
    let viewportFrame: number | null = null;
    const refreshLensPosition = () => {
      if (viewportFrame !== null) return;
      viewportFrame = requestAnimationFrame(() => {
        viewportFrame = null;
        positionLens();
      });
    };
    window.addEventListener("resize", refreshLensPosition);
    document.addEventListener("scroll", refreshLensPosition, true);
    return () => {
      window.removeEventListener("resize", refreshLensPosition);
      document.removeEventListener("scroll", refreshLensPosition, true);
      if (viewportFrame !== null) cancelAnimationFrame(viewportFrame);
    };
  }, [positionLens]);

  useEffect(() => () => {
    if (lensMoveFrameRef.current !== null) cancelAnimationFrame(lensMoveFrameRef.current);
  }, []);

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
    startLensX: number,
    startLensY: number,
    startClientX: number,
    startClientY: number,
  ) => {
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect) return { x: startLensX, y: startLensY };
    const padding = chartPadding(rect.width);
    return shiftNormalizedChartLensPosition(
      startLensX,
      startLensY,
      event.clientX - startClientX,
      event.clientY - startClientY,
      rect.width,
      rect.height,
      padding,
      chartLensMovementBounds(rect.width, rect.height, padding, lens),
    );
  }, [lens]);

  const scheduleLensMove = useCallback((position: { x: number; y: number }) => {
    pendingLensPositionRef.current = position;
    if (lensMoveFrameRef.current !== null) return;
    lensMoveFrameRef.current = requestAnimationFrame(() => {
      lensMoveFrameRef.current = null;
      const pending = pendingLensPositionRef.current;
      pendingLensPositionRef.current = null;
      if (pending) onLensMove(pending);
    });
  }, [onLensMove]);

  const beginLensDrag = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!lens.enabled || event.button !== 0) return;
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect) return;
    const resolved = resolvePointer(event.clientX, event.clientY, rect);
    if (!pointIsInsideChartLens(resolved.raw.x, resolved.raw.y, resolved.geometry)) return;
    const movement = chartLensMovementBounds(rect.width, rect.height, resolved.padding, lens);
    const effectiveStart = shiftNormalizedChartLensPosition(
      lens.x,
      lens.y,
      0,
      0,
      rect.width,
      rect.height,
      resolved.padding,
      movement,
    );
    dragRef.current = {
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      startLensX: effectiveStart.x,
      startLensY: effectiveStart.y,
      moved: false,
    };
    suppressClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.style.cursor = "grabbing";
    setDragging(true);
    event.preventDefault();
  }, [lens, resolvePointer]);

  const movePointer = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3) drag.moved = true;
      scheduleLensMove(lensPositionForPointer(
        event,
        drag.startLensX,
        drag.startLensY,
        drag.startX,
        drag.startY,
      ));
      setHover(null);
      event.preventDefault();
      return;
    }
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect) return;
    const resolved = resolvePointer(event.clientX, event.clientY, rect);
    event.currentTarget.style.cursor = resolved.insideLens ? "grab" : "crosshair";
    updateHover(event);
  }, [lensPositionForPointer, resolvePointer, scheduleLensMove, updateHover]);

  const finishLensDrag = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
    dragRef.current = null;
    if (drag.captureTarget.hasPointerCapture(event.pointerId)) drag.captureTarget.releasePointerCapture(event.pointerId);
    drag.captureTarget.style.cursor = drag.captureTarget === lensCanvasRef.current ? "grab" : "crosshair";
    setDragging(false);
  }, []);

  const cancelLensDrag = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = false;
    dragRef.current = null;
    pendingLensPositionRef.current = null;
    if (lensMoveFrameRef.current !== null) {
      cancelAnimationFrame(lensMoveFrameRef.current);
      lensMoveFrameRef.current = null;
    }
    if (drag.captureTarget.hasPointerCapture(event.pointerId)) drag.captureTarget.releasePointerCapture(event.pointerId);
    drag.captureTarget.style.cursor = drag.captureTarget === lensCanvasRef.current ? "grab" : "crosshair";
    setDragging(false);
  }, []);

  const loseLensCapture = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    pendingLensPositionRef.current = null;
    suppressClickRef.current = false;
    if (lensMoveFrameRef.current !== null) {
      cancelAnimationFrame(lensMoveFrameRef.current);
      lensMoveFrameRef.current = null;
    }
    event.currentTarget.style.cursor = event.currentTarget === lensCanvasRef.current ? "grab" : "crosshair";
    setHover(null);
    setDragging(false);
  }, []);

  const selectFromPointer = useCallback((event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect) return;
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
  const periodStartDate = visible[0]?.date ?? "";
  const hoveredPeriodChange = hoveredFundValue?.periodChange ?? 0;
  const hoveredPeriodCashFlow = hoveredPoint && hoveredFund
    ? hoveredFund.transactions.reduce((total, transaction) =>
      transaction.date > periodStartDate && transaction.date <= hoveredPoint.date
        ? total + transaction.amount
        : total, 0)
    : 0;
  const hoveredMarketMovement = hoveredPeriodChange - hoveredPeriodCashFlow;
  const hoveredPeriodSideTotal = hoveredPoint
    ? hoveredPoint.funds.reduce((total, fund) => {
      const change = fund.periodChange ?? 0;
      return change === 0 || Math.sign(change) === Math.sign(hoveredPeriodChange)
        ? total + Math.abs(change)
        : total;
    }, 0)
    : 0;
  const hoveredPeriodShare = hoveredPeriodSideTotal
    ? Math.abs(hoveredPeriodChange) / hoveredPeriodSideTotal * 100
    : 0;
  const latestPoint = visible.at(-1);

  return (
    <article className={`fund-stack-panel${lens.enabled ? " lens-active" : ""}${dragging ? " lens-dragging" : ""}`} data-panel-mode={mode} data-period-start-date={mode === "periodChange" ? periodStartDate : ""} data-lens-enabled={lens.enabled} data-lens-x={lens.x.toFixed(4)} data-lens-y={lens.y.toFixed(4)} data-lens-magnification={lens.magnification} data-lens-size={lens.size}>
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
          onPointerCancel={cancelLensDrag}
          onLostPointerCapture={loseLensCapture}
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
        <canvas
          ref={lensCanvasRef}
          className="stack-lens-canvas"
          data-render-mode="vector"
          aria-hidden="true"
          onClick={selectFromPointer}
          onPointerDown={beginLensDrag}
          onPointerMove={movePointer}
          onPointerUp={finishLensDrag}
          onPointerCancel={cancelLensDrag}
          onLostPointerCapture={loseLensCapture}
          onPointerLeave={(event) => {
            if (!dragRef.current) setHover(null);
            if (!dragRef.current) event.currentTarget.style.cursor = "grab";
          }}
        />
        {activeHover && hoveredPoint && (
          <>
            {!activeHover.insideLens && <span className="stack-hover-guide" style={{ left: `${activeHover.x}px` }} />}
            {activeHover.insideLens && <span className="stack-lens-cursor" style={{ left: `${activeHover.cursorX}px`, top: `${activeHover.cursorY}px` }} />}
            {activeHover.markerVisible && <i className={`stack-hover-marker${activeHover.insideLens ? " lens-pointer" : ""}`} data-inside-lens={activeHover.insideLens} style={{ left: `${activeHover.x}px`, top: `${activeHover.y}px`, background: hoveredFund ? stackFundColor(activeHover.fundIndex ?? 0) : "#0B1D2A" }} />}
            <div className="stack-hover-tooltip" role="status" data-fund-key={hoveredFund?.key ?? "portfolio-total"} data-fund-color={hoveredFund && activeHover.fundIndex !== null ? stackFundColor(activeHover.fundIndex) : ""} data-date={hoveredPoint.date} data-inside-lens={activeHover.insideLens} style={{ left: `${activeHover.tooltipLeft}px`, top: `${activeHover.tooltipTop}px` }}>
              <span className="stack-tooltip-date">{stackFormatDate(hoveredPoint.date)}</span>
              <div className="stack-tooltip-title">
                {hoveredFund && activeHover.fundIndex !== null && <i aria-hidden="true" style={{ background: stackFundColor(activeHover.fundIndex) }} />}
                <strong>{hoveredFund?.name ?? "Portfolio total"}</strong>
              </div>
              {hoveredFund && hoveredFundValue && mode === "periodChange" ? (
                <>
                  <small>{hoveredFund.category}{hoveredFund.closed ? " · Closed" : ""} · baseline {stackFormatDate(periodStartDate)}</small>
                  <div><span>Start value</span><b>{formatInr(hoveredFundValue.periodStartValue ?? 0)}</b></div>
                  <div><span>Value on date</span><b>{formatInr(hoveredFundValue.value)}</b></div>
                  <div><span>Net cash flow</span><b className={hoveredPeriodCashFlow < 0 ? "negative" : hoveredPeriodCashFlow > 0 ? "positive" : ""}>{formatInr(hoveredPeriodCashFlow)}</b></div>
                  <div><span>Market movement</span><b className={hoveredMarketMovement < 0 ? "negative" : hoveredMarketMovement > 0 ? "positive" : ""}>{formatInr(hoveredMarketMovement)}</b></div>
                  <div><span>Period change</span><b className={hoveredPeriodChange < 0 ? "negative" : "positive"}>{formatInr(hoveredPeriodChange)}</b></div>
                  <footer><b>{hoveredPeriodShare.toFixed(2)}% of {hoveredPeriodChange < 0 ? "decrease" : "increase"}</b><span>Total {formatInr(hoveredPoint.totalPeriodChange ?? 0)}</span></footer>
                </>
              ) : hoveredFund && hoveredFundValue ? (
                <>
                  <small>{hoveredFund.category}{hoveredFund.closed ? " · Closed" : ""}</small>
                  <div><span>Fund value</span><b>{formatInr(hoveredFundValue.value)}</b></div>
                  <div><span>Net invested</span><b>{formatInr(hoveredFundValue.invested)}</b></div>
                  <div><span>Contribution</span><b className={hoveredFundValue.contribution < 0 ? "negative" : "positive"}>{formatInr(hoveredFundValue.contribution)}</b></div>
                  <div><span>Annualised return</span><b className={annualizedReturn !== null && annualizedReturn < 0 ? "negative" : annualizedReturn !== null ? "positive" : ""}>{annualizedReturn === null ? "—" : `${annualizedReturn.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% p.a.`}</b></div>
                  <footer><b>{hoveredShare.toFixed(2)}% of portfolio</b><span>Total {formatInr(hoveredPoint.totalValue)}</span></footer>
                </>
              ) : mode === "periodChange" ? (
                <>
                  <div><span>Portfolio start</span><b>{formatInr(hoveredPoint.periodStartValue ?? 0)}</b></div>
                  <div><span>Portfolio value</span><b>{formatInr(hoveredPoint.totalValue)}</b></div>
                  <div><span>Period change</span><b className={(hoveredPoint.totalPeriodChange ?? 0) < 0 ? "negative" : "positive"}>{formatInr(hoveredPoint.totalPeriodChange ?? 0)}</b></div>
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
