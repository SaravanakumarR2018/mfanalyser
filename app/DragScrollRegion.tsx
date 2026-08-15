"use client";

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- A labelled, keyboard-scrollable region is the accessible equivalent of this drag-scroll surface. */

import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";

type DragState = {
  pointerId: number;
  startY: number;
  scrollTop: number;
};

export default function DragScrollRegion({
  children,
  ariaLabel,
  className = "",
}: {
  children: ReactNode;
  ariaLabel: string;
  className?: string;
}) {
  const drag = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      scrollTop: event.currentTarget.scrollTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    event.currentTarget.scrollTop = drag.current.scrollTop - (event.clientY - drag.current.startY);
    event.preventDefault();
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === "ArrowDown"
      ? 36
      : event.key === "ArrowUp"
        ? -36
        : event.key === "PageDown"
          ? event.currentTarget.clientHeight * 0.8
          : event.key === "PageUp"
            ? -event.currentTarget.clientHeight * 0.8
            : 0;
    if (!delta) return;
    event.currentTarget.scrollBy({ top: delta, behavior: "smooth" });
    event.preventDefault();
  };

  return (
    <div
      className={`drag-scroll-region ${className}${dragging ? " dragging" : ""}`}
      role="region"
      aria-label={ariaLabel}
      tabIndex={0}
      data-dragging={dragging}
      onKeyDown={onKeyDown}
      onPointerCancel={finishDrag}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
    ><div className="drag-scroll-content" role="list">{children}</div></div>
  );
}
