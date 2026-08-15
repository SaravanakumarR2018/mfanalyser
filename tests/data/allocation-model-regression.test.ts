import assert from "node:assert/strict";
import test from "node:test";

import {
  allocationSliceOffset,
  allocationSlicePath,
  buildAllocationSlices,
  placeDonutTooltip,
} from "../../app/allocation-model.ts";

test("allocation slices preserve input order and reconcile exactly to one circle", () => {
  const inputs = [
    { key: "small", label: "Small cap", value: 622 },
    { key: "mid", label: "Mid cap", value: 238 },
    { key: "gold", label: "Gold", value: 140 },
  ];
  const before = structuredClone(inputs);

  const slices = buildAllocationSlices(inputs);

  assert.deepEqual(inputs, before);
  assert.deepEqual(slices.map((slice) => slice.key), ["small", "mid", "gold"]);
  assert.deepEqual(slices.map((slice) => Number(slice.percentage.toFixed(1))), [62.2, 23.8, 14]);
  assert.equal(slices[0].startAngle, 0);
  assert.equal(slices.at(-1)?.endAngle, 360);
  assert.ok(Math.abs(slices.reduce((sum, slice) => sum + slice.percentage, 0) - 100) < 0.000001);
});

test("allocation slices reject unsafe values without inventing a percentage", () => {
  assert.deepEqual(buildAllocationSlices([
    { key: "zero", label: "Zero", value: 0 },
    { key: "negative", label: "Negative", value: -10 },
    { key: "nan", label: "NaN", value: Number.NaN },
    { key: "infinite", label: "Infinite", value: Number.POSITIVE_INFINITY },
    { key: "", label: "Missing key", value: 10 },
    { key: "missing-label", label: "", value: 10 },
  ]), []);
});

test("donut arc paths and lift offsets remain finite at cardinal and full-circle bounds", () => {
  const slices = buildAllocationSlices([
    { key: "only", label: "Only fund", value: 1 },
  ]);
  const path = allocationSlicePath(slices[0]);

  assert.match(path, /^M /);
  assert.match(path, / A 76 76 /);
  assert.match(path, / A 48 48 /);
  assert.equal(path.includes("NaN"), false);
  assert.equal(path.includes("Infinity"), false);
  assert.deepEqual(allocationSliceOffset(90), { x: 5, y: 0 });
  assert.ok(Math.abs(allocationSliceOffset(180).x) < 0.000001);
  assert.equal(allocationSliceOffset(180).y, 5);
  assert.equal(allocationSlicePath({ startAngle: 40, endAngle: 40 }), "");
});

test("tooltip placement follows the active slice while remaining outside the donut", () => {
  const right = placeDonutTooltip({
    donut: { left: 100, top: 100, width: 120, height: 120 },
    tooltip: { width: 184, height: 54 },
    viewport: { width: 1440, height: 900 },
    midAngle: 90,
  });
  assert.deepEqual(right, { direction: "right", left: 234, top: 133 });

  const narrow = placeDonutTooltip({
    donut: { left: 92, top: 300, width: 135, height: 135 },
    tooltip: { width: 184, height: 54 },
    viewport: { width: 320, height: 720 },
    midAngle: 90,
  });
  assert.deepEqual(narrow, { direction: "bottom", left: 67.5, top: 449 });

  const edgeAligned = placeDonutTooltip({
    donut: { left: 36, top: 312, width: 95, height: 95 },
    tooltip: { width: 184, height: 48 },
    viewport: { width: 320, height: 720 },
    midAngle: 90,
  });
  assert.deepEqual(edgeAligned, { direction: "bottom", left: 8, top: 421 });
});

test("every viewport-safe tooltip candidate has zero rectangular overlap with its donut", () => {
  for (const viewport of [{ width: 320, height: 720 }, { width: 768, height: 1024 }, { width: 1440, height: 1000 }]) {
    for (const midAngle of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const donut = { left: viewport.width / 2 - 67.5, top: 240, width: 135, height: 135 };
      const tooltip = { width: 184, height: 54 };
      const placed = placeDonutTooltip({ donut, tooltip, viewport, midAngle });
      const overlapWidth = Math.max(0, Math.min(donut.left + donut.width, placed.left + tooltip.width) - Math.max(donut.left, placed.left));
      const overlapHeight = Math.max(0, Math.min(donut.top + donut.height, placed.top + tooltip.height) - Math.max(donut.top, placed.top));
      assert.equal(overlapWidth * overlapHeight, 0);
      assert.ok(placed.left >= 8);
      assert.ok(placed.top >= 8);
      assert.ok(placed.left + tooltip.width <= viewport.width - 8);
      assert.ok(placed.top + tooltip.height <= viewport.height - 8);
    }
  }
});
