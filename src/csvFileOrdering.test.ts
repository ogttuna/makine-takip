import assert from "node:assert/strict";
import test from "node:test";

import {
  filesBeforeUnavailableDailyLog,
  isDownloadDuplicateCsvName,
  logFileDateKey,
  scanStartIndex,
  sortCsvFiles,
} from "./csvFileOrdering.ts";

test("orders machine log files by the date in their names instead of copy time", () => {
  const files = [
    { name: "LogFile_2026_08_13.csv", lastModified: 4 },
    { name: "LogFile_2026_08_14.csv", lastModified: 3 },
    { name: "LogFile_2026_06_11.csv", lastModified: 2 },
    { name: "LogFile_2026_06_14.csv", lastModified: 1 },
  ];

  assert.deepEqual(
    sortCsvFiles(files).map((file) => file.name),
    [
      "LogFile_2026_06_11.csv",
      "LogFile_2026_06_14.csv",
      "LogFile_2026_08_13.csv",
      "LogFile_2026_08_14.csv",
    ],
  );
});

test("resumes at the first dated file after a missing active file", () => {
  const files = sortCsvFiles([
    { name: "LogFile_2026_08_14.csv", lastModified: 1 },
    { name: "LogFile_2026_08_16.csv", lastModified: 2 },
  ]);

  assert.equal(
    scanStartIndex(files, {
      active_file_name: "LogFile_2026_08_15.csv",
      last_modified_ms: 999,
    }),
    1,
  );
});

test("rejects impossible dates in machine log file names", () => {
  assert.equal(logFileDateKey("LogFile_2026_02_29.csv"), null);
  assert.equal(logFileDateKey("LogFile_2028_02_29.csv"), 20280229);
});

test("keeps valid daily files in date order when an unrelated CSV has a newer copy time", () => {
  const files = [
    { name: "LogFile_2026_08_14 (1).csv", lastModified: 1 },
    { name: "LogFile_2026_08_14.csv", lastModified: 4 },
    { name: "LogFile_2026_06_11.csv", lastModified: 3 },
  ];

  assert.deepEqual(
    sortCsvFiles(files).map((file) => file.name),
    [
      "LogFile_2026_06_11.csv",
      "LogFile_2026_08_14.csv",
      "LogFile_2026_08_14 (1).csv",
    ],
  );
});

test("recognizes browser download copies without accepting them as daily log names", () => {
  assert.equal(isDownloadDuplicateCsvName("LogFile_2026_08_14 (1).csv"), true);
  assert.equal(isDownloadDuplicateCsvName("LogFile_2026_08_14 (23).csv"), true);
  assert.equal(isDownloadDuplicateCsvName("LogFile_2026_08_14.csv"), false);
});

test("recovers from an obsolete malformed active filename using valid daily checkpoints", () => {
  const files = sortCsvFiles([
    { name: "LogFile_2026_08_13.csv", lastModified: 1 },
    { name: "LogFile_2026_08_14.csv", lastModified: 2 },
  ]);

  assert.equal(
    scanStartIndex(files, {
      active_file_name: "LogFile_2026_08_14 (1).csv",
      last_modified_ms: 999,
    }),
    0,
  );
});

test("does not advance past a temporarily unreadable daily file", () => {
  const files = sortCsvFiles([
    { name: "LogFile_2026_09_01.csv", lastModified: 1 },
    { name: "LogFile_2026_09_03.csv", lastModified: 3 },
  ]);

  assert.deepEqual(
    filesBeforeUnavailableDailyLog(
      files,
      ["LogFile_2026_09_02.csv"],
      "LogFile_2026_09_01.csv",
    ).map((file) => file.name),
    ["LogFile_2026_09_01.csv"],
  );
});

test("an unavailable old file does not freeze an already newer checkpoint", () => {
  const files = sortCsvFiles([
    { name: "LogFile_2026_09_02.csv", lastModified: 2 },
    { name: "LogFile_2026_09_03.csv", lastModified: 3 },
  ]);

  assert.deepEqual(
    filesBeforeUnavailableDailyLog(
      files,
      ["LogFile_2026_09_01.csv"],
      "LogFile_2026_09_03.csv",
    ).map((file) => file.name),
    ["LogFile_2026_09_02.csv", "LogFile_2026_09_03.csv"],
  );
});
