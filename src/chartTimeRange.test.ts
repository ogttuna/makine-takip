import assert from "node:assert/strict";
import test from "node:test";

import {
  chartDateRangeQuery,
  samplesForChartRange,
  segmentsForVisibleSamples,
  timestampDateInputValue,
  validateChartDateRange,
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
  assert.equal(samplesForChartRange(samples, "custom"), samples);
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

  assert.deepEqual(segmentsForVisibleSamples(segments, visibleSamples), [
    {
      ...segments[0],
      started_at: "2026-08-14T00:04:00.000Z",
    },
    segments[1],
  ]);
});

test("turns an operator date selection into inclusive machine-local bounds", () => {
  assert.deepEqual(
    chartDateRangeQuery({ startDate: "2026-09-02", endDate: "2026-09-10" }),
    {
      from: "2026-09-02T00:00:00.000",
      to: "2026-09-10T23:59:59.999",
    },
  );
});

test("rejects incomplete, impossible, and reversed date ranges", () => {
  assert.equal(
    validateChartDateRange({ startDate: "", endDate: "2026-09-10" }),
    "missing",
  );
  assert.equal(
    validateChartDateRange({ startDate: "2026-02-30", endDate: "2026-03-01" }),
    "invalid",
  );
  assert.equal(
    validateChartDateRange({ startDate: "2026-09-11", endDate: "2026-09-10" }),
    "order",
  );
  assert.equal(
    chartDateRangeQuery({ startDate: "2026-09-11", endDate: "2026-09-10" }),
    null,
  );
});

test("extracts valid date input values without timezone conversion", () => {
  assert.equal(timestampDateInputValue("2026-09-12T23:59:00.000"), "2026-09-12");
  assert.equal(timestampDateInputValue("not-a-date"), null);
  assert.equal(timestampDateInputValue(null), null);
});
