import assert from "node:assert/strict";
import test from "node:test";

import {
  samplesForChartRange,
  segmentsForVisibleSamples,
} from "./chartTimeRange.ts";

const sample = (sampledAt: string) => ({ sampled_at: sampledAt });

test("shows only the latest rolling 24 hours by default", () => {
  const samples = [
    sample("2026-08-13T23:59:00.000Z"),
    sample("2026-08-14T00:04:00.000Z"),
    sample("2026-08-14T23:59:00.000Z"),
  ];

  assert.deepEqual(samplesForChartRange(samples, "24h"), [samples[1], samples[2]]);
});

test("keeps seven days and all-history views explicit", () => {
  const samples = [
    sample("2026-08-01T00:00:00.000Z"),
    sample("2026-08-08T00:00:00.000Z"),
    sample("2026-08-14T00:00:00.000Z"),
  ];

  assert.deepEqual(samplesForChartRange(samples, "7d"), [samples[1], samples[2]]);
  assert.equal(samplesForChartRange(samples, "all"), samples);
});

test("moves the rolling window forward with a new live sample", () => {
  const samples = [
    sample("2026-08-14T00:00:00.000Z"),
    sample("2026-08-14T12:00:00.000Z"),
    sample("2026-08-15T12:01:00.000Z"),
  ];

  assert.deepEqual(samplesForChartRange(samples, "24h"), [samples[2]]);
});

test("clips process bands to the samples visible in the selected window", () => {
  const segments = [
    {
      id: 1,
      started_at: "2026-08-13T20:00:00.000Z",
      finished_at: "2026-08-14T01:00:00.000Z",
    },
    {
      id: 2,
      started_at: "2026-08-14T02:00:00.000Z",
      finished_at: null,
    },
    {
      id: 3,
      started_at: "2026-08-15T00:00:00.000Z",
      finished_at: "2026-08-15T01:00:00.000Z",
    },
  ];
  const visibleSamples = [
    sample("2026-08-14T00:04:00.000Z"),
    sample("2026-08-14T23:59:00.000Z"),
  ];

  assert.deepEqual(segmentsForVisibleSamples(segments, visibleSamples, "24h"), [
    {
      ...segments[0],
      started_at: "2026-08-14T00:04:00.000Z",
    },
    segments[1],
  ]);
});
