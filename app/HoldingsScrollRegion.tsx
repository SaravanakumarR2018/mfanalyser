"use client";

/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- The named scroll region needs keyboard focus for native arrow and Page Up/Down scrolling. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export default function HoldingsScrollRegion({ children, count, total }: {
  children: ReactNode;
  count: number;
  total: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const updateEdges = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    setEdges({ start: element.scrollLeft < 2, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [updateEdges]);

  const moveColumns = (direction: number) => {
    const element = scrollRef.current;
    if (!element) return;
    const pinnedWidth = Number.parseFloat(getComputedStyle(element).getPropertyValue("--fund-column-width"));
    const columnWidth = element.querySelector(".sort-column")?.getBoundingClientRect().width ?? 116;
    const columnsPerStep = Math.max(1, Math.floor((element.clientWidth - pinnedWidth - 16) / columnWidth));
    element.scrollBy({ left: direction * columnsPerStep * columnWidth, behavior: "auto" });
  };

  return (
    <div className="holdings-comparison">
      <div className="holdings-scroll-tools">
        <div><strong aria-live="polite">{count === total ? `${total} ${total === 1 ? "fund" : "funds"}` : `${count} of ${total} funds`}</strong><span id="holdings-scroll-help">{edges.start && edges.end ? "Scroll rows to compare. Column headings stay in view." : "Scroll rows to compare. Swipe across for more columns."}</span></div>
        {!(edges.start && edges.end) && <div className="holdings-column-controls" aria-label="Table columns">
          <button type="button" aria-label="Previous fund columns" disabled={edges.start} onClick={() => moveColumns(-1)}>←</button>
          <button type="button" aria-label="Next fund columns" disabled={edges.end} onClick={() => moveColumns(1)}>→</button>
        </div>}
      </div>
      <div ref={scrollRef} className="holdings-scroll" role="region" aria-label="Scrollable fund comparison" aria-describedby="holdings-scroll-help" tabIndex={0} onScroll={updateEdges}>
        {children}
      </div>
    </div>
  );
}
