import assert from "node:assert/strict";
import test from "node:test";

import { prepareCsvFilesForScan } from "./csvHeaderPreflight.ts";

function csvFile(name: string, contents: string): File {
  return new File([contents], name, { type: "text/csv", lastModified: 1 });
}

const isDatedDailyLog = (fileName: string) =>
  /^LogFile_\d{4}_\d{2}_\d{2}\.csv$/i.test(fileName);

test("waits at an incomplete daily header instead of skipping later files", async () => {
  const result = await prepareCsvFilesForScan(
    [
      csvFile("LogFile_2026_09_01.csv", "SAAT;RAF1\n00:00;10\n"),
      csvFile("LogFile_2026_09_02.csv", "SAAT;RAF1"),
      csvFile("LogFile_2026_09_03.csv", "SAAT;RAF1\n00:00;30\n"),
    ],
    isDatedDailyLog,
  );

  assert.deepEqual(
    result.files.map(({ file }) => file.name),
    ["LogFile_2026_09_01.csv"],
  );
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0].message, /henüz tamamlanmadı/);
});

test("skips a complete invalid header and keeps later valid files flowing", async () => {
  const result = await prepareCsvFilesForScan(
    [
      csvFile("LogFile_2026_09_01.csv", "SAAT;RAF1\n00:00;10\n"),
      csvFile("LogFile_2026_09_02.csv", "WRONG;RAF1\n00:00;20\n"),
      csvFile("LogFile_2026_09_03.csv", '"SAAT";"raf1"\n00:00;"30,5"\n'),
    ],
    isDatedDailyLog,
  );

  assert.deepEqual(
    result.files.map(({ file }) => file.name),
    ["LogFile_2026_09_01.csv", "LogFile_2026_09_03.csv"],
  );
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0].message, /TARIH SAAT veya SAAT/);
});

test("treats an oversized header as corrupt instead of waiting forever", async () => {
  const result = await prepareCsvFilesForScan(
    [
      csvFile("LogFile_2026_09_01.csv", "SAAT;RAF1\n00:00;10\n"),
      csvFile("LogFile_2026_09_02.csv", "X".repeat(64 * 1024 + 1)),
      csvFile("LogFile_2026_09_03.csv", "SAAT;RAF1\n00:00;30\n"),
    ],
    isDatedDailyLog,
  );

  assert.deepEqual(
    result.files.map(({ file }) => file.name),
    ["LogFile_2026_09_01.csv", "LogFile_2026_09_03.csv"],
  );
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0].message, /65536 byte sınırını aşıyor/);
});
