import assert from "node:assert/strict";
import test from "node:test";

import {
  chronologicalSamples,
  formatTimelineAxis,
  stateLabelFits,
  timelineExtent,
} from "./chartTimeline.ts";

test("orders chart samples by timestamp without mutating source sequence order", () => {
  const samples = [
    { sampled_at: "2026-08-14T00:00:00.000", source_row_number: 2 },
    { sampled_at: "invalid", source_row_number: 3 },
    { sampled_at: "2026-06-11T00:00:00.000", source_row_number: 1 },
  ];

  assert.deepEqual(
    chronologicalSamples(samples).map((sample) => sample.source_row_number),
    [1, 2],
  );
  assert.deepEqual(
    samples.map((sample) => sample.source_row_number),
    [2, 3, 1],
  );
});

test("uses dates instead of repeated midnight labels for a multi-month range", () => {
  const spanMs = 65 * 24 * 60 * 60 * 1_000;
  const formatted = formatTimelineAxis("2026-08-14T00:00:00.000", "tr", spanMs);

  assert.match(formatted, /14[./]08/);
  assert.notEqual(formatted, "00:00");
});

test("keeps hours for a single-day chart", () => {
  const formatted = formatTimelineAxis(
    "2026-08-14T09:05:00.000",
    "tr",
    12 * 60 * 60 * 1_000,
  );

  assert.match(formatted, /09:05/);
});

test("shows a state label only when its band has enough pixels", () => {
  const samples = [
    { sampled_at: "2026-06-11T00:00:00.000", source_row_number: 1 },
    { sampled_at: "2026-08-14T00:00:00.000", source_row_number: 2 },
  ];
  const extent = timelineExtent(samples);

  assert.equal(
    stateLabelFits(
      "2026-07-01T00:00:00.000",
      "2026-07-01T01:00:00.000",
      "START",
      extent,
      800,
    ),
    false,
  );
  assert.equal(
    stateLabelFits(
      "2026-07-01T00:00:00.000",
      "2026-07-10T00:00:00.000",
      "WAIT",
      extent,
      800,
    ),
    true,
  );
});
