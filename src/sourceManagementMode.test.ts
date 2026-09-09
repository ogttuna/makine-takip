import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SOURCE_MANAGEMENT_MODE,
  hasServerMachineData,
  parseSourceManagementMode,
  preferredMachineId,
  preferredRunId,
  readSourceManagementMode,
  SOURCE_MANAGEMENT_STORAGE_KEY,
  writeSourceManagementMode,
} from "./sourceManagementMode.ts";

test("new and unknown devices fail closed in viewer mode", () => {
  assert.equal(parseSourceManagementMode(null), DEFAULT_SOURCE_MANAGEMENT_MODE);
  assert.equal(parseSourceManagementMode("viewer"), "viewer");
  assert.equal(parseSourceManagementMode("unexpected"), "viewer");
  assert.equal(parseSourceManagementMode("manager"), "manager");
});

test("source management mode persists only on the current device", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };

  assert.equal(readSourceManagementMode(storage), "viewer");
  writeSourceManagementMode(storage, "manager");
  assert.equal(values.get(SOURCE_MANAGEMENT_STORAGE_KEY), "manager");
  assert.equal(readSourceManagementMode(storage), "manager");
});

test("storage failures keep source controls locked", () => {
  const unavailableStorage = {
    getItem: () => {
      throw new Error("storage unavailable");
    },
  };

  assert.equal(readSourceManagementMode(unavailableStorage), "viewer");
});

test("the default machine favors a live feed, then the latest server data", () => {
  const machines = [
    {
      id: 1,
      active_run_id: null,
      last_sampled_at: "2026-09-08T10:00:00Z",
      run_count: 1,
      source_count: 1,
    },
    {
      id: 2,
      active_run_id: 22,
      last_sampled_at: "2026-09-07T10:00:00Z",
      run_count: 1,
      source_count: 1,
    },
    {
      id: 3,
      active_run_id: null,
      last_sampled_at: "2026-09-09T10:00:00Z",
      run_count: 1,
      source_count: 1,
    },
  ];

  assert.equal(preferredMachineId(machines), 2);
  assert.equal(preferredMachineId(machines.filter((machine) => machine.id !== 2)), 3);
  assert.equal(preferredMachineId([]), null);
});

test("manual imports count as server data without a browser-tail source", () => {
  assert.equal(
    hasServerMachineData({
      active_run_id: null,
      last_sampled_at: "2026-09-09T10:00:00Z",
      run_count: 1,
      source_count: 0,
    }),
    true,
  );
  assert.equal(
    hasServerMachineData({
      active_run_id: null,
      last_sampled_at: null,
      run_count: 0,
      source_count: 0,
    }),
    false,
  );
});

test("the default run shows server data instead of an empty checkpoint", () => {
  const runs = [
    { id: 14, row_count: 0 },
    { id: 13, row_count: 480 },
    { id: 12, row_count: 480 },
  ];

  assert.equal(preferredRunId(runs), 13);
  assert.equal(preferredRunId(runs, 14), 14);
  assert.equal(preferredRunId([{ id: 14, row_count: 0 }]), 14);
  assert.equal(preferredRunId([]), null);
});
