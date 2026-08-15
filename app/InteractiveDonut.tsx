"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import {
  allocationSliceOffset,
  allocationSlicePath,
  buildAllocationSlices,
  placeDonutTooltip,
  type AllocationInput,
  type DonutTooltipPlacement,
} from "./allocation-model";

type DonutItem = AllocationInput & { color: string };

type InteractiveDonutProps = {
  items: readonly DonutItem[];
  ariaLabel: string;
  className?: string;
  center: ReactNode;
  tooltipSuffix: string;
  dark?: boolean;
};

type SliceStyle = CSSProperties & {
  "--slice-x": string;
  "--slice-y": string;
};

type PositionedTooltip = DonutTooltipPlacement & { key: string };

export default function InteractiveDonut({
  items,
  ariaLabel,
  className = "",
  center,
  tooltipSuffix,
  dark = false,
}: InteractiveDonutProps) {
  const tooltipId = useId();
  const donutRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<PositionedTooltip | null>(null);
  const slices = useMemo(() => {
    const colors = new Map(items.map((item) => [item.key, item.color]));
    return buildAllocationSlices(items).map((slice) => ({
      ...slice,
      color: colors.get(slice.key) ?? "#79DDA7",
    }));
  }, [items]);
  const selectedExists = selectedKey && slices.some((slice) => slice.key === selectedKey)
    ? selectedKey
    : null;
  const hoveredExists = hoveredKey && slices.some((slice) => slice.key === hoveredKey)
    ? hoveredKey
    : null;
  const activeKey = hoveredExists ?? selectedExists;
  const activeSlice = slices.find((slice) => slice.key === activeKey);
  const tooltipPositionIsCurrent = Boolean(activeSlice && tooltipPosition?.key === activeSlice.key);

  useLayoutEffect(() => {
    if (!activeSlice) return;
    const updatePosition = () => {
      const donut = donutRef.current?.getBoundingClientRect();
      const tooltipElement = tooltipRef.current;
      const tooltip = tooltipElement
        ? { width: tooltipElement.offsetWidth, height: tooltipElement.offsetHeight }
        : null;
      if (!donut || !tooltip || tooltip.width <= 0 || tooltip.height <= 0) return;
      const next = {
        key: activeSlice.key,
        ...placeDonutTooltip({
          donut,
          tooltip,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          midAngle: activeSlice.midAngle,
        }),
      };
      setTooltipPosition((current) => (
        current?.key === next.key
        && current.direction === next.direction
        && Math.abs(current.left - next.left) < 0.25
        && Math.abs(current.top - next.top) < 0.25
          ? current
          : next
      ));
    };
    updatePosition();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    if (donutRef.current) resizeObserver?.observe(donutRef.current);
    if (tooltipRef.current) resizeObserver?.observe(tooltipRef.current);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [activeSlice, selectedExists]);

  const clearSelection = () => {
    setHoveredKey(null);
    setSelectedKey(null);
  };

  const onSliceKeyDown = (event: KeyboardEvent<SVGPathElement>, key: string) => {
    if (event.key === "Escape") {
      clearSelection();
      event.currentTarget.blur();
      event.preventDefault();
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    setSelectedKey((current) => current === key ? null : key);
    event.preventDefault();
  };

  return (
    <div
      ref={donutRef}
      className={`interactive-donut ${className}${dark ? " dark" : ""}`}
      data-active-slice={activeKey ?? ""}
      data-selected-slice={selectedExists ?? ""}
      data-slice-count={slices.length}
      data-tooltip-placement={tooltipPositionIsCurrent ? tooltipPosition?.direction : ""}
    >
      <svg viewBox="0 0 180 180" role="group" aria-label={ariaLabel}>
        <circle className="donut-track" cx="90" cy="90" r="62" />
        {slices.map((slice) => {
          const offset = allocationSliceOffset(slice.midAngle);
          const active = activeKey === slice.key;
          const selected = selectedExists === slice.key;
          const style: SliceStyle = {
            fill: slice.color,
            opacity: activeKey && !active ? 0.28 : 1,
            "--slice-x": `${offset.x.toFixed(2)}px`,
            "--slice-y": `${offset.y.toFixed(2)}px`,
          };
          return (
            <path
              key={slice.key}
              className={`donut-slice${active ? " active" : ""}${selected ? " selected" : ""}`}
              d={allocationSlicePath(slice)}
              style={style}
              role="button"
              tabIndex={0}
              aria-label={`${slice.label}: ${slice.percentage.toFixed(1)}% ${tooltipSuffix}`}
              aria-pressed={selected}
              aria-describedby={active ? tooltipId : undefined}
              data-slice-key={slice.key}
              data-percentage={slice.percentage.toFixed(1)}
              onFocus={() => setHoveredKey(slice.key)}
              onBlur={() => setHoveredKey(null)}
              onPointerEnter={() => setHoveredKey(slice.key)}
              onPointerLeave={() => setHoveredKey(null)}
              onClick={() => setSelectedKey((current) => current === slice.key ? null : slice.key)}
              onKeyDown={(event) => onSliceKeyDown(event, slice.key)}
            />
          );
        })}
      </svg>
      <div className="donut-center" aria-hidden="true">{center}</div>
      {activeSlice && typeof document !== "undefined" && createPortal(
        <div
          ref={tooltipRef}
          id={tooltipId}
          className={`donut-tooltip${dark ? " dark" : ""}`}
          role="tooltip"
          data-placement={tooltipPositionIsCurrent ? tooltipPosition?.direction : "pending"}
          style={{
            left: tooltipPositionIsCurrent ? tooltipPosition?.left : 0,
            top: tooltipPositionIsCurrent ? tooltipPosition?.top : 0,
            visibility: tooltipPositionIsCurrent ? "visible" : "hidden",
          }}
        >
          <i aria-hidden="true" style={{ background: activeSlice.color }} />
          <span><strong>{activeSlice.label}</strong><small>{activeSlice.percentage.toFixed(1)}% {tooltipSuffix}</small></span>
          {selectedExists === activeSlice.key && <em>Selected</em>}
        </div>,
        document.body,
      )}
    </div>
  );
}
