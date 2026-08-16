import assert from "node:assert/strict";
import test from "node:test";

import type { SampleFrame } from "./api.ts";
import { lastSourceSequence, mergeIncrementalSamples } from "./incrementalSamples.ts";

function sample(sequence: number): SampleFrame {
  return {
    id: sequence,
    sampled_at: `2026-08-14T00:${String(sequence).padStart(2, "0")}:00.000`,
    source_timestamp_text: `2026-08-14-00:${String(sequence).padStart(2, "0")}:00.000`,
    source_row_number: sequence,
    measurements: [],
  };
}

test("keeps the same array when a poll has no new rows", () => {
  const current = [sample(2), sample(3)];
  assert.equal(mergeIncrementalSamples(current, [], 5_000), current);
});

test("appends only unseen source sequences and keeps a bounded window", () => {
  const merged = mergeIncrementalSamples(
    [sample(2), sample(3)],
    [sample(3), sample(4), sample(5)],
    3,
  );

  assert.deepEqual(
    merged.map((item) => item.source_row_number),
    [3, 4, 5],
  );
  assert.equal(lastSourceSequence(merged), 5);
});
