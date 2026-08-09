"use client";

import type { Dispatch, SetStateAction } from "react";
import { formatInr } from "./formatters";
import type { FundStackScale } from "./fund-stack-service";
import type { IndexRange } from "./range-window";
import { useVerticalRangeWindowDrag } from "./useVerticalRangeWindowDrag";
import {
  resizeVerticalRange,
  VERTICAL_RANGE_MAX,
} from "./vertical-range";

type VerticalScaleControlProps = {
  range: IndexRange;
  scale: FundStackScale;
  setRange: Dispatch<SetStateAction<IndexRange>>;
};

export default function VerticalScaleControl({
  range,
  scale,
  setRange,
}: VerticalScaleControlProps) {
  const windowDrag = useVerticalRangeWindowDrag({ range, setRange });
  const fullRange = range[0] === 0 && range[1] === VERTICAL_RANGE_MAX;
  const selectedTop = (VERTICAL_RANGE_MAX - range[1]) / VERTICAL_RANGE_MAX * 100;
  const selectedBottom = range[0] / VERTICAL_RANGE_MAX * 100;
  const valueText = `${formatInr(scale.min)} to ${formatInr(scale.max)}`;

  return (
    <aside className="stack-y-control" aria-label="Shared vertical value range">
      <button
        type="button"
        className="stack-y-reset"
        disabled={fullRange}
        onClick={() => setRange([0, VERTICAL_RANGE_MAX])}
        aria-label="Reset shared vertical value range"
      ><i aria-hidden="true">↕</i><span>Full Y</span></button>
      <div className="stack-y-track" data-lower={range[0]} data-upper={range[1]}>
        <span className="stack-y-edge top" aria-hidden="true">High</span>
        <div
          className={`stack-y-window${windowDrag.movable ? " draggable" : ""}`}
          role="slider"
          tabIndex={windowDrag.movable ? 0 : -1}
          aria-label="Move shared vertical value window"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={VERTICAL_RANGE_MAX}
          aria-valuenow={Math.round((range[0] + range[1]) / 2)}
          aria-valuetext={valueText}
          onKeyDown={windowDrag.onKeyDown}
          onPointerCancel={windowDrag.onPointerCancel}
          onPointerDown={windowDrag.onPointerDown}
          onPointerMove={windowDrag.onPointerMove}
          onPointerUp={windowDrag.onPointerUp}
          style={{ top: `${selectedTop}%`, bottom: `${selectedBottom}%` }}
        ><i aria-hidden="true" /></div>
        <input
          aria-label="Shared vertical minimum"
          aria-orientation="vertical"
          aria-valuetext={formatInr(scale.min)}
          type="range"
          min={0}
          max={VERTICAL_RANGE_MAX}
          value={range[0]}
          onChange={(event) => setRange((current) => resizeVerticalRange(current, "lower", Number(event.target.value)))}
        />
        <input
          aria-label="Shared vertical maximum"
          aria-orientation="vertical"
          aria-valuetext={formatInr(scale.max)}
          type="range"
          min={0}
          max={VERTICAL_RANGE_MAX}
          value={range[1]}
          onChange={(event) => setRange((current) => resizeVerticalRange(current, "upper", Number(event.target.value)))}
        />
        <span className="stack-y-edge bottom" aria-hidden="true">Low</span>
      </div>
    </aside>
  );
}
