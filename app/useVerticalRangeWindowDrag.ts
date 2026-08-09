"use client";

import { useCallback, useRef } from "react";
import type {
  Dispatch,
  KeyboardEvent,
  PointerEvent,
  SetStateAction,
} from "react";
import type { IndexRange } from "./range-window";
import { shiftVerticalRangeWindow, VERTICAL_RANGE_MAX } from "./vertical-range";

type VerticalRangeWindowDragOptions = {
  range: IndexRange;
  setRange: Dispatch<SetStateAction<IndexRange>>;
};

type DragState = {
  pointerId: number;
  startY: number;
  trackHeight: number;
  range: IndexRange;
};

export function useVerticalRangeWindowDrag({
  range,
  setRange,
}: VerticalRangeWindowDragOptions) {
  const dragState = useRef<DragState | null>(null);
  const movable = range[1] - range[0] < VERTICAL_RANGE_MAX;

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!movable || (event.pointerType === "mouse" && event.button !== 0)) return;
    const track = event.currentTarget.parentElement;
    if (!track) return;
    dragState.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      trackHeight: Math.max(1, track.getBoundingClientRect().height),
      range: [...range],
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, [movable, range]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const indexDelta = ((drag.startY - event.clientY) / drag.trackHeight) * VERTICAL_RANGE_MAX;
    setRange(shiftVerticalRangeWindow(drag.range, indexDelta));
    event.preventDefault();
  }, [setRange]);

  const finishPointerDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (dragState.current?.pointerId !== event.pointerId) return;
    dragState.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!movable || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    const direction = event.key === "ArrowUp" ? 1 : -1;
    const step = event.shiftKey ? 25 : 5;
    setRange((current) => shiftVerticalRangeWindow(current, direction * step));
    event.preventDefault();
  }, [movable, setRange]);

  return {
    movable,
    onKeyDown,
    onPointerCancel: finishPointerDrag,
    onPointerDown,
    onPointerMove,
    onPointerUp: finishPointerDrag,
  };
}
