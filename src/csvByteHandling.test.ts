import assert from "node:assert/strict";
import test from "node:test";

import { completeLinePrefixLength, decodeCsvRows } from "./csvByteHandling.ts";

test("keeps an unfinished final CSV row for the next scan", () => {
  const bytes = new TextEncoder().encode("00:03;10\r\n00:08;par");
  const consumed = completeLinePrefixLength(bytes);

  assert.equal(new TextDecoder().decode(bytes.slice(0, consumed)), "00:03;10\r\n");
  assert.equal(new TextDecoder().decode(bytes.slice(consumed)), "00:08;par");
});

test("waits when a chunk has no completed row", () => {
  assert.equal(completeLinePrefixLength(new TextEncoder().encode("00:03;10")), 0);
});

test("replaces an invalid UTF-8 byte instead of stopping the CSV stream", () => {
  const decoded = decodeCsvRows(Uint8Array.from([48, 48, 58, 48, 51, 59, 0xff, 10]));

  assert.equal(decoded, "00:03;�\n");
});
