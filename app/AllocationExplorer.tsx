"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { allocationSlicePath, buildAllocationSlices, type AllocationInput } from "./allocation-model";
import { useChartPinch } from "./useChartPinch";

type Item = AllocationInput & { color: string };
const percent = (value: number) => value > 0 && value < 0.01 ? "<0.01%" : `${value.toFixed(2)}%`;
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);

export default function AllocationExplorer({ items, title, onClose }: {
  items: readonly Item[];
  title: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState("");
  const slices = useMemo(() => buildAllocationSlices(items), [items]);
  const [selectedKey, setSelectedKey] = useState(slices[0]?.key ?? "");
  const selected = slices.find((slice) => slice.key === selectedKey);
  const [x, setX] = useState<[number, number]>([0, 180]);
  const [y, setY] = useState<[number, number]>([0, 180]);
  useChartPinch({ target: svg, range: x, verticalRange: y, totalPoints: 181, minSpan: 12,
    onChange: (nextX, nextY) => { setX(nextX); if (nextY) setY(nextY); } });
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; previous?.focus({ preventScroll: true }); };
  }, []);
  const reset = () => { setX([0, 180]); setY([0, 180]); };
  const zoom = (factor: number, focusSelection = false) => {
    const span = Math.max(12, Math.min(180, (x[1] - x[0]) * factor));
    const angle = ((selected?.midAngle ?? 0) - 90) * Math.PI / 180;
    const cx = focusSelection ? 90 + 62 * Math.cos(angle) : (x[0] + x[1]) / 2;
    const cy = focusSelection ? 90 + 62 * Math.sin(angle) : (y[0] + y[1]) / 2;
    const left = Math.max(0, Math.min(180 - span, cx - span / 2));
    const top = Math.max(0, Math.min(180 - span, cy - span / 2));
    setX([left, left + span]); setY([top, top + span]);
  };
  const visible = slices.filter((slice) => slice.label.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <dialog className="allocation-explorer" ref={dialog} aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header><div><p>Explore every allocation</p><h2 id={titleId}>{title}</h2></div><button type="button" aria-label="Close allocation explorer" onClick={onClose}>×</button></header>
      <div className="allocation-explorer-overview">
        <svg ref={svg} viewBox={`${x[0]} ${y[0]} ${x[1] - x[0]} ${y[1] - y[0]}`} role="img" aria-label="Zoomable allocation diagram" style={{ touchAction: "pan-y" }}>
          {slices.map((slice) => <path key={slice.key} d={allocationSlicePath(slice)} fill={items.find((item) => item.key === slice.key)?.color} opacity={slice.key === selectedKey ? 1 : 0.24} />)}
        </svg>
        <div className="allocation-explorer-selection" aria-live="polite">
          <span>Selected allocation</span><strong>{selected?.label ?? "No allocations"}</strong>
          {selected && <><b>{percent(selected.percentage)}</b><small>{money(selected.value)}</small></>}
        </div>
      </div>
      <div className="allocation-explorer-zoom" aria-label="Allocation diagram zoom">
        <button type="button" aria-label="Zoom allocation out" onClick={() => zoom(1.5)} disabled={x[1] - x[0] >= 180}>−</button>
        <button type="button" aria-label="Zoom allocation in" onClick={() => zoom(0.66)} disabled={x[1] - x[0] <= 12}>+</button>
        <button type="button" onClick={() => zoom(60 / (x[1] - x[0]), true)} disabled={!selected}>Zoom selected</button>
        <button type="button" onClick={reset}>Reset</button>
      </div>
      <p className="allocation-explorer-help">Pinch to zoom; move two fingers to explore. Tap any row below, even the smallest allocation.</p>
      <label className="allocation-explorer-search">Find an allocation<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names" /></label>
      <div className="allocation-explorer-list" role="group" aria-label="All allocations">
        {visible.map((slice) => <button type="button" key={slice.key} aria-pressed={slice.key === selectedKey} onClick={() => { setSelectedKey(slice.key); reset(); }}>
          <i aria-hidden="true" style={{ background: items.find((item) => item.key === slice.key)?.color }} />
          <span><strong>{slice.label}</strong><small>{money(slice.value)}</small></span><b>{percent(slice.percentage)}</b>
        </button>)}
        {!visible.length && <p role="status">No allocations match your search.</p>}
      </div>
      <footer>{visible.length} of {slices.length} allocations · percentages retain their true proportions</footer>
    </dialog>
  );
}
