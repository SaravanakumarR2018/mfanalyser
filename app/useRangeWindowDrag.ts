"use client";

import { useCallback, useRef } from "react";
import type {
  Dispatch,
  KeyboardEvent,
  PointerEvent,
  SetStateAction,
} from "react";
import { shiftRangeWindow, type IndexRange } from "./range-window";

type RangeWindowDragOptions = {
  range: IndexRange;
  setRange: Dispatch<SetStateAction<IndexRange>>;
  totalPoints: number;
  onMoveStart?: () => void;
};

type DragState = {
  pointerId: number;
  startX: number;
  trackWidth: number;
  range: IndexRange;
};

export function useRangeWindowDrag({
  range,
  setRange,
  totalPoints,
  onMoveStart,
}: RangeWindowDragOptions) {
  const dragState = useRef<DragState | null>(null);
  const movable = totalPoints > 1 && range[1] - range[0] < totalPoints - 1;

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!movable || (event.pointerType === "mouse" && event.button !== 0)) return;
    const track = event.currentTarget.parentElement;
    if (!track) return;

    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      trackWidth: Math.max(1, track.getBoundingClientRect().width),
      range: [...range],
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    onMoveStart?.();
    event.preventDefault();
  }, [movable, onMoveStart, range]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const indexDelta = ((event.clientX - drag.startX) / drag.trackWidth)
      * Math.max(1, totalPoints - 1);
    setRange(shiftRangeWindow(drag.range, indexDelta, totalPoints));
    event.preventDefault();
  }, [setRange, totalPoints]);

  const finishPointerDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (dragState.current?.pointerId !== event.pointerId) return;
    dragState.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!movable || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const step = event.shiftKey ? 5 : 1;
    onMoveStart?.();
    setRange((current) => shiftRangeWindow(current, direction * step, totalPoints));
    event.preventDefault();
  }, [movable, onMoveStart, setRange, totalPoints]);

  return {
    movable,
    onKeyDown,
    onPointerCancel: finishPointerDrag,
    onPointerDown,
    onPointerMove,
    onPointerUp: finishPointerDrag,
  };
}
