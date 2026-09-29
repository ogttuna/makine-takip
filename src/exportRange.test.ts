import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultExportRange,
  exportRangeQuery,
  timestampDateTimeInputValue,
  validateExportRange,
} from "./exportRange.ts";

test("accepts an exact five-day export window", () => {
  const range = {
    startDateTime: "2026-09-10T08:00",
    endDateTime: "2026-09-15T08:00",
  };

  assert.equal(validateExportRange(range), null);
  assert.deepEqual(exportRangeQuery(range), {
    from: "2026-09-10T08:00:00.000",
    to: "2026-09-15T08:00:00.000",
  });
});

test("rejects missing, invalid, reversed, and longer-than-five-day windows", () => {
  assert.equal(
    validateExportRange({ startDateTime: "", endDateTime: "2026-09-15T08:00" }),
    "missing",
  );
  assert.equal(
    validateExportRange({
      startDateTime: "2026-02-30T08:00",
      endDateTime: "2026-03-01T08:00",
    }),
    "invalid",
  );
  assert.equal(
    validateExportRange({
      startDateTime: "2026-09-15T08:01",
      endDateTime: "2026-09-15T08:00",
    }),
    "order",
  );
  assert.equal(
    validateExportRange({
      startDateTime: "2026-09-10T07:59",
      endDateTime: "2026-09-15T08:00",
    }),
    "too_long",
  );
});

test("defaults to the latest 24 hours without browser timezone conversion", () => {
  assert.deepEqual(
    defaultExportRange(
      "2026-09-14T11:29:00.000",
      "2025-09-12T20:06:27.327",
      new Date("2030-01-01T00:00:00.000Z"),
    ),
    {
      startDateTime: "2026-09-13T11:29",
      endDateTime: "2026-09-14T11:29",
    },
  );
});

test("clamps a default range to the first available sample", () => {
  assert.deepEqual(
    defaultExportRange(
      "2026-09-14T11:29:00.000",
      "2026-09-14T08:15:00.000",
    ),
    {
      startDateTime: "2026-09-14T08:15",
      endDateTime: "2026-09-14T11:29",
    },
  );
});

test("extracts only valid machine-local datetime values", () => {
  assert.equal(
    timestampDateTimeInputValue("2026-09-14T11:29:00.000"),
    "2026-09-14T11:29",
  );
  assert.equal(timestampDateTimeInputValue("2026-02-30T11:29:00.000"), null);
  assert.equal(timestampDateTimeInputValue(null), null);
});

test("the default export includes an FD2 sample with seconds and milliseconds", () => {
  const latest = "2026-09-21T17:39:36.363";
  const range = defaultExportRange(latest, "2026-09-08T20:48:00.000");
  const query = exportRangeQuery(range);

  assert.equal(range.endDateTime, "2026-09-21T17:40");
  assert.ok(query);
  assert.ok(query.from <= latest && latest <= query.to);
  assert.equal(
    Date.parse(`${query.to}Z`) - Date.parse(`${query.from}Z`),
    24 * 60 * 60 * 1_000,
  );
});

test("the end input permits the default end without rounding the start up", () => {
  const latest = "2026-09-21T17:39:36.363";
  const range = defaultExportRange(latest, latest);

  assert.equal(timestampDateTimeInputValue(latest), "2026-09-21T17:39");
  assert.equal(timestampDateTimeInputValue(latest, "end"), range.endDateTime);
  assert.equal(range.startDateTime, "2026-09-21T17:39");
  const query = exportRangeQuery(range);
  assert.ok(query && query.from <= latest && latest <= query.to);
});

test("FD1 samples on exact minutes keep their existing export boundaries", () => {
  for (const latest of [
    "2026-09-21T15:23",
    "2026-09-21T15:23:00",
    "2026-09-21T15:23:00.000",
  ]) {
    assert.equal(timestampDateTimeInputValue(latest, "end"), "2026-09-21T15:23");
    assert.equal(defaultExportRange(latest, null).endDateTime, "2026-09-21T15:23");
  }
});

test("end boundaries include fractional seconds and cross calendar boundaries", () => {
  const cases = [
    ["2026-09-21T15:24:00.001", "2026-09-21T15:25"],
    ["2026-09-21T15:59:59.999", "2026-09-21T16:00"],
    ["2026-09-30T23:59:59.999", "2026-10-01T00:00"],
    ["2026-12-31T23:59:59.999", "2027-01-01T00:00"],
    ["2028-02-28T23:59:59.999", "2028-02-29T00:00"],
  ];
  for (const [latest, expectedEnd] of cases) {
    assert.equal(timestampDateTimeInputValue(latest, "end"), expectedEnd);
    const query = exportRangeQuery(defaultExportRange(latest, null));
    assert.ok(query && query.from <= latest && latest <= query.to);
  }
});

test("a rounded end still permits exactly 120 hours and rejects another minute", () => {
  const endDateTime = timestampDateTimeInputValue("2026-09-21T17:39:36.363", "end");
  assert.equal(endDateTime, "2026-09-21T17:40");
  assert.ok(endDateTime);
  const exact = { startDateTime: "2026-09-16T17:40", endDateTime };
  assert.equal(validateExportRange(exact), null);
  assert.deepEqual(exportRangeQuery(exact), {
    from: "2026-09-16T17:40:00.000",
    to: "2026-09-21T17:40:00.000",
  });
  assert.equal(
    validateExportRange({ ...exact, startDateTime: "2026-09-16T17:39" }),
    "too_long",
  );
});
