import assert from "node:assert/strict";
import test from "node:test";

import { logFileDateKey, scanStartIndex, sortCsvFiles } from "./csvFileOrdering.ts";

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
