"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

type Range = [number, number];
type Options = {
  target: RefObject<HTMLElement | SVGElement | null>;
  range: Range;
  totalPoints: number;
  coordinates?: readonly number[];
  onChange: (range: Range, vertical?: Range) => void;
  verticalRange?: Range;
  minSpan?: number;
  onStart?: () => void;
};

/** Two fingers zoom/pan the data window; one finger retains native page scroll.
 * Non-passive touch listeners are needed to claim pinch before Safari zooms
 * the page. No global listeners or viewport zoom restrictions are installed. */
export function useChartPinch({ target, range, totalPoints, onChange, onStart, verticalRange, minSpan = 1, coordinates }: Options) {
  const gesture = useRef<{ distance: number; range: Range; anchor: number; anchorY?: number; verticalRange?: Range; ids: number[] } | null>(null);
  const suppressUntil = useRef(0);
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const position = (touches: TouchList) => {
      const first = touches[0];
      const second = touches[1];
      const plot = element.matches("canvas, svg") ? element : element.querySelector("canvas, svg") ?? element;
      const bounds = plot.getBoundingClientRect();
      const left = Number(plot.getAttribute("data-plot-left")) || 0;
      const right = Number(plot.getAttribute("data-plot-right")) || bounds.width;
      return {
        centerY: Math.max(0, Math.min(1, ((first.clientY + second.clientY) / 2 - bounds.top) / Math.max(1, bounds.height))),
        distance: Math.max(1, Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)),
        center: Math.max(0, Math.min(1, ((first.clientX + second.clientX) / 2 - bounds.left - left) / Math.max(1, right - left))),
      };
    };
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 2 || totalPoints < 2) return;
      const { distance, center, centerY } = position(event.touches);
      gesture.current = { distance, range: [...range], anchor: range[0] + center * (range[1] - range[0]), verticalRange, anchorY: verticalRange ? verticalRange[0] + centerY * (verticalRange[1] - verticalRange[0]) : undefined, ids: [event.touches[0].identifier, event.touches[1].identifier] };
      onStart?.();
      event.preventDefault();
      event.stopPropagation();
    };
    const move = (event: TouchEvent) => {
      const current = gesture.current;
      if (!current || event.touches.length !== 2) return;
      if (!current.ids.every((id) => Array.from(event.touches).some((touch) => touch.identifier === id))) return;
      const { distance, center, centerY } = position(event.touches);
      const span = Math.max(minSpan, Math.min(totalPoints - 1, Math.round((current.range[1] - current.range[0]) * current.distance / distance)));
      const first = Math.max(0, Math.min(totalPoints - 1 - span, Math.round(current.anchor - center * span)));
      const y = current.verticalRange && current.anchorY !== undefined ? Math.max(0, Math.min(totalPoints - 1 - span, Math.round(current.anchorY - centerY * span))) : undefined;
      if (coordinates && coordinates.length === totalPoints) {
        // Charts use calendar spacing, so anchor zoom to time, not row density.
        const initialStart = coordinates[current.range[0]];
        const initialEnd = coordinates[current.range[1]];
        const initialCenter = (current.anchor - current.range[0]) / Math.max(1, current.range[1] - current.range[0]);
        const anchor = initialStart + initialCenter * (initialEnd - initialStart);
        const extent = coordinates[totalPoints - 1] - coordinates[0];
        const windowSize = Math.min(extent, (initialEnd - initialStart) * current.distance / distance);
        const lower = Math.max(coordinates[0], Math.min(coordinates[totalPoints - 1] - windowSize, anchor - center * windowSize));
        const nearest = (value: number) => {
          let low = 0, high = coordinates.length - 1;
          while (low < high) { const middle = Math.floor((low + high) / 2); if (coordinates[middle] < value) low = middle + 1; else high = middle; }
          return low > 0 && value - coordinates[low - 1] < coordinates[low] - value ? low - 1 : low;
        };
        const startIndex = Math.min(totalPoints - 2, nearest(lower));
        onChange([startIndex, Math.max(startIndex + 1, nearest(lower + windowSize))]);
      } else onChange([first, first + span], y === undefined ? undefined : [y, y + span]);
      event.preventDefault();
      event.stopPropagation();
    };
    const end = () => {
      if (!gesture.current) return;
      gesture.current = null;
      suppressUntil.current = performance.now() + 350;
    };
    const suppressPointer = (event: Event) => {
      if (gesture.current || performance.now() < suppressUntil.current) event.stopImmediatePropagation();
    };
    element.addEventListener("touchstart", start as EventListener, { passive: false });
    element.addEventListener("touchmove", move as EventListener, { passive: false });
    element.addEventListener("touchend", end);
    element.addEventListener("touchcancel", end);
    element.addEventListener("pointermove", suppressPointer, true);
    element.addEventListener("click", suppressPointer, true);
    return () => {
      element.removeEventListener("touchstart", start as EventListener);
      element.removeEventListener("touchmove", move as EventListener);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", end);
      element.removeEventListener("pointermove", suppressPointer, true);
      element.removeEventListener("click", suppressPointer, true);
    };
  });
}
