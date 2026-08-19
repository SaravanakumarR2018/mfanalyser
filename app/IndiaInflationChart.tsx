"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  INDIA_INFLATION_INDICATOR,
  loadIndiaInflation,
  type IndiaInflationPoint,
} from "./inflation-service";

type LoadState = "waiting" | "loading" | "ready" | "error";

const formatPercent = (value: number, digits = 1) => `${value.toFixed(digits)}%`;

export default function IndiaInflationChart() {
  const headingId = useId();
  const descriptionId = useId();
  const liveId = useId();
  const cardRef = useRef<HTMLElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const hasStartedRef = useRef(false);
  const [state, setState] = useState<LoadState>("waiting");
  const [points, setPoints] = useState<IndiaInflationPoint[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 480px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const geometry = useMemo(() => compact
    ? { width: 560, height: 400, plot: { left: 50, right: 542, top: 25, bottom: 330 } }
    : { width: 920, height: 350, plot: { left: 56, right: 898, top: 24, bottom: 292 } }, [compact]);

  const requestData = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    const sequence = ++requestSequenceRef.current;
    requestRef.current = controller;
    setState("loading");
    try {
      const next = await loadIndiaInflation({ signal: controller.signal });
      if (controller.signal.aborted || sequence !== requestSequenceRef.current) return;
      setPoints(next);
      setActiveIndex(next.length - 1);
      setState("ready");
    } catch {
      if (controller.signal.aborted || sequence !== requestSequenceRef.current) return;
      setState("error");
    }
  }, []);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const begin = () => {
      if (hasStartedRef.current) return;
      hasStartedRef.current = true;
      void requestData();
    };
    if (!("IntersectionObserver" in window)) {
      begin();
      return () => requestRef.current?.abort();
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        begin();
        observer.disconnect();
      }
    }, { rootMargin: "160px 0px" });
    observer.observe(card);
    return () => {
      observer.disconnect();
      requestRef.current?.abort();
    };
  }, [requestData]);

  const model = useMemo(() => {
    if (points.length < 2) return null;
    const { plot } = geometry;
    const values = points.map((point) => point.value);
    const low = Math.min(0, Math.floor(Math.min(...values) - 1));
    const high = Math.max(1, Math.ceil(Math.max(...values) + 1));
    const x = (index: number) => plot.left + (index / (points.length - 1)) * (plot.right - plot.left);
    const y = (value: number) => plot.bottom - ((value - low) / (high - low)) * (plot.bottom - plot.top);
    const drawn = points.map((point, index) => ({ ...point, x: x(index), y: y(point.value) }));
    const line = drawn.map((point) => `${point.x},${point.y}`).join(" ");
    const area = `${plot.left},${plot.bottom} ${line} ${plot.right},${plot.bottom}`;
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const peak = points.reduce((highest, point) => point.value > highest.value ? point : highest);
    const yTicks = Array.from({ length: 5 }, (_, index) => {
      const value = low + ((high - low) * index) / 4;
      return { value, y: y(value) };
    }).reverse();
    return { drawn, line, area, average, peak, yTicks, zeroY: y(0) };
  }, [geometry, points]);

  const active = model && activeIndex !== null ? model.drawn[activeIndex] : null;
  const inspectAt = (clientX: number, bounds: DOMRect) => {
    if (!model) return;
    const svgX = ((clientX - bounds.left) / bounds.width) * geometry.width;
    const ratio = (svgX - geometry.plot.left) / (geometry.plot.right - geometry.plot.left);
    setActiveIndex(Math.max(0, Math.min(model.drawn.length - 1, Math.round(ratio * (model.drawn.length - 1)))));
  };
  const handlePointer = (event: ReactPointerEvent<SVGSVGElement>) => inspectAt(
    event.clientX,
    event.currentTarget.getBoundingClientRect(),
  );
  const handleKey = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (!model || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    setActiveIndex((current) => {
      if (event.key === "Home") return 0;
      if (event.key === "End") return model.drawn.length - 1;
      const index = current ?? model.drawn.length - 1;
      return Math.max(0, Math.min(model.drawn.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)));
    });
    event.preventDefault();
  };

  const retry = () => {
    hasStartedRef.current = true;
    void requestData();
  };

  return (
    <section
      ref={cardRef}
      className="inflation-card"
      aria-labelledby={headingId}
      data-load-state={state}
      data-observations={points.length}
      data-source="world-bank-client"
    >
      <div className="inflation-head">
        <div>
          <p className="eyebrow">The purchasing-power backdrop</p>
          <h2 id={headingId}>India inflation, year by year</h2>
          <p>Annual consumer-price inflation across the latest 30 published observations.</p>
        </div>
        <span className="inflation-source-badge">World Bank · CPI</span>
      </div>

      {state !== "ready" || !model ? (
        <div className={`inflation-state ${state}`} role="status" aria-live="polite" aria-busy={state === "loading"}>
          {state === "error" ? (
            <div><strong>Inflation history is temporarily unavailable.</strong><span>Your portfolio data is unaffected.</span><button type="button" onClick={retry}>Retry</button></div>
          ) : (
            <div><i aria-hidden="true" /><strong>{state === "waiting" ? "Inflation history loads as this chart approaches." : "Loading India’s inflation history…"}</strong><span>This public dataset is requested directly by your browser.</span></div>
          )}
        </div>
      ) : (
        <>
          <div className="inflation-metrics" aria-label="Inflation highlights">
            <div><span>Latest · {points.at(-1)?.year}</span><strong>{formatPercent(points.at(-1)?.value ?? 0, 2)}</strong></div>
            <div><span>30-year average</span><strong>{formatPercent(model.average, 2)}</strong></div>
            <div><span>Highest · {model.peak.year}</span><strong>{formatPercent(model.peak.value, 2)}</strong></div>
          </div>
          <div className="inflation-chart-shell">
            <svg
              viewBox={`0 0 ${geometry.width} ${geometry.height}`}
              role="img"
              tabIndex={0}
              aria-labelledby={`${headingId} ${descriptionId}`}
              aria-describedby={liveId}
              onPointerMove={handlePointer}
              onPointerDown={handlePointer}
              onKeyDown={handleKey}
              data-start-year={points[0].year}
              data-end-year={points.at(-1)?.year}
              data-indicator={INDIA_INFLATION_INDICATOR}
            >
              <title>India annual consumer-price inflation</title>
              <desc id={descriptionId}>A line chart of {points.length} annual observations from {points[0].year} to {points.at(-1)?.year}. Use left and right arrow keys to inspect years.</desc>
              <defs>
                <linearGradient id={`${headingId}-area`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#ff7a66" stopOpacity="0.32" />
                  <stop offset="1" stopColor="#ff7a66" stopOpacity="0.015" />
                </linearGradient>
                <linearGradient id={`${headingId}-line`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#d75e50" />
                  <stop offset="0.55" stopColor="#ff7a66" />
                  <stop offset="1" stopColor="#1d9d61" />
                </linearGradient>
              </defs>
              {model.yTicks.map((tick) => <g className="inflation-grid" key={tick.value}>
                <line x1={geometry.plot.left} x2={geometry.plot.right} y1={tick.y} y2={tick.y} />
                <text x={geometry.plot.left - 10} y={tick.y + 4}>{formatPercent(tick.value, 0)}</text>
              </g>)}
              <line className="inflation-zero" x1={geometry.plot.left} x2={geometry.plot.right} y1={model.zeroY} y2={model.zeroY} />
              <polygon className="inflation-area" points={model.area} fill={`url(#${headingId}-area)`} />
              <polyline className="inflation-line" points={model.line} stroke={`url(#${headingId}-line)`} />
              {model.drawn.map((point, index) => (
                (index === 0 || index === model.drawn.length - 1 || point.year % 5 === 0) &&
                <text className="inflation-year" x={point.x} y={geometry.plot.bottom + 28} key={point.year}>{point.year}</text>
              ))}
              {active && <g className="inflation-active">
                <line x1={active.x} x2={active.x} y1={geometry.plot.top} y2={geometry.plot.bottom} />
                <circle cx={active.x} cy={active.y} r="6" />
                <g transform={`translate(${Math.max(70, Math.min(geometry.width - 70, active.x)) - 61} ${Math.max(geometry.plot.top + 4, active.y - 61)})`}>
                  <rect width="122" height="44" rx="10" />
                  <text x="12" y="17">{active.year}</text>
                  <text className="inflation-tooltip-value" x="110" y="18">{formatPercent(active.value, 2)}</text>
                  <text x="12" y="33">annual CPI change</text>
                </g>
              </g>}
            </svg>
            <p id={liveId} className="fund-comparison-live" aria-live="polite">{active ? `${active.year}: ${formatPercent(active.value, 2)} annual inflation.` : ""}</p>
          </div>
          <p className="inflation-note"><strong>What this means.</strong> This is India’s annual percentage change in consumer prices—not a forecast and not part of your return calculation. Data is fetched client-side from the World Bank Indicators API; no portfolio information is sent.</p>
        </>
      )}
    </section>
  );
}
