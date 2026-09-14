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
  const safariGesture = useRef<NonNullable<typeof gesture.current> | null>(null);
  const lastApplied = useRef<Range | null>(null);
  const wheelGesture = useRef<{ state: NonNullable<typeof gesture.current>; factor: number; time: number } | null>(null);
  const suppressUntil = useRef(0);
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    if (lastApplied.current && (range[0] !== lastApplied.current[0] || range[1] !== lastApplied.current[1])) wheelGesture.current = null;
    const apply = (next: Range, vertical?: Range) => { lastApplied.current = next; onChange(next, vertical); };
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
      safariGesture.current = null;
      wheelGesture.current = null;
      const { distance, center, centerY } = position(event.touches);
      gesture.current = { distance, range: [...range], anchor: range[0] + center * (range[1] - range[0]), verticalRange, anchorY: verticalRange ? verticalRange[0] + centerY * (verticalRange[1] - verticalRange[0]) : undefined, ids: [event.touches[0].identifier, event.touches[1].identifier] };
      onStart?.();
      event.preventDefault();
      event.stopPropagation();
    };
    const updateWindow = (current: NonNullable<typeof gesture.current>, distance: number, center: number, centerY: number) => {
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
        apply([startIndex, Math.max(startIndex + 1, nearest(lower + windowSize))]);
      } else apply([first, first + span], y === undefined ? undefined : [y, y + span]);
    };
    const move = (event: TouchEvent) => {
      const current = gesture.current;
      if (!current || event.touches.length !== 2) return;
      if (!current.ids.every((id) => Array.from(event.touches).some((touch) => touch.identifier === id))) return;
      const { distance, center, centerY } = position(event.touches);
      updateWindow(current, distance, center, centerY);
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
    const wheel = (event: WheelEvent) => {
      // Trackpad pinch arrives as Ctrl+wheel. Ordinary wheel scrolling stays native.
      if (safariGesture.current) return;
      if ((!event.ctrlKey && !event.altKey) || totalPoints < 2 || !Number.isFinite(event.deltaY)) return;
      if ((event.target as Element).closest("input, button, select")) return;
      const plot = element.matches("canvas, svg") ? element : element.querySelector("canvas, svg") ?? element;
      const bounds = plot.getBoundingClientRect();
      const left = Number(plot.getAttribute("data-plot-left")) || 0;
      const right = Number(plot.getAttribute("data-plot-right")) || bounds.width;
      const center = Math.max(0, Math.min(1, (event.clientX - bounds.left - left) / Math.max(1, right - left)));
      const centerY = Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height)));
      const now = performance.now();
      if (!wheelGesture.current || now - wheelGesture.current.time > 250) {
        wheelGesture.current = { state: { distance: 1, range: [...range], anchor: range[0] + center * (range[1] - range[0]), verticalRange, anchorY: verticalRange ? verticalRange[0] + centerY * (verticalRange[1] - verticalRange[0]) : undefined, ids: [] }, factor: 1, time: now };
        onStart?.();
      }
      const gesture = wheelGesture.current;
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
      gesture.factor = Math.max(0.01, Math.min(100, gesture.factor * Math.exp(-Math.max(-240, Math.min(240, pixels)) * 0.006)));
      gesture.time = now;
      updateWindow(gesture.state, gesture.factor, center, centerY);
      event.preventDefault();
      event.stopPropagation();
    };
    type SafariGesture = Event & { scale: number; clientX: number; clientY: number };
    const safariPosition = (event: SafariGesture) => {
      const plot = element.matches("canvas, svg") ? element : element.querySelector("canvas, svg") ?? element;
      const bounds = plot.getBoundingClientRect();
      const left = Number(plot.getAttribute("data-plot-left")) || 0;
      const right = Number(plot.getAttribute("data-plot-right")) || bounds.width;
      return { center: Math.max(0, Math.min(1, (event.clientX - bounds.left - left) / Math.max(1, right - left))), centerY: Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height))) };
    };
    // Safari trackpads expose GestureEvent; touchscreen TouchEvents take priority.
    const safariStart = (raw: Event) => {
      if (totalPoints < 2 || gesture.current || (raw.target as Element).closest("input, button, select")) return;
      const { center, centerY } = safariPosition(raw as SafariGesture);
      safariGesture.current = { distance: 1, range: [...range], anchor: range[0] + center * (range[1] - range[0]), verticalRange, anchorY: verticalRange ? verticalRange[0] + centerY * (verticalRange[1] - verticalRange[0]) : undefined, ids: [] };
      wheelGesture.current = null;
      onStart?.(); raw.preventDefault();
    };
    const safariChange = (raw: Event) => {
      const event = raw as SafariGesture;
      if (gesture.current) { event.preventDefault(); return; }
      if (!safariGesture.current || !Number.isFinite(event.scale) || event.scale <= 0) return;
      const { center, centerY } = safariPosition(event);
      updateWindow(safariGesture.current, event.scale, center, centerY);
      event.preventDefault(); event.stopPropagation();
    };
    const safariEnd = () => { safariGesture.current = null; };
    element.addEventListener("gesturestart", safariStart, { passive: false });
    element.addEventListener("gesturechange", safariChange, { passive: false });
    element.addEventListener("gestureend", safariEnd);
    const previousTitle = element.getAttribute("title");
    element.setAttribute("title", "Pinch to zoom · Ctrl + scroll (or Alt + scroll) to zoom at the pointer");
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("touchstart", start as EventListener, { passive: false });
    element.addEventListener("touchmove", move as EventListener, { passive: false });
    element.addEventListener("touchend", end);
    element.addEventListener("touchcancel", end);
    element.addEventListener("pointermove", suppressPointer, true);
    element.addEventListener("click", suppressPointer, true);
    return () => {
      element.removeEventListener("gesturestart", safariStart);
      element.removeEventListener("gesturechange", safariChange);
      element.removeEventListener("gestureend", safariEnd);
      element.removeEventListener("wheel", wheel);
      if (previousTitle === null) element.removeAttribute("title"); else element.setAttribute("title", previousTitle);
      element.removeEventListener("touchstart", start as EventListener);
      element.removeEventListener("touchmove", move as EventListener);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", end);
      element.removeEventListener("pointermove", suppressPointer, true);
      element.removeEventListener("click", suppressPointer, true);
    };
  });
}
