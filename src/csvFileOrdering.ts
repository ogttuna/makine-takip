import type { BrowserTailStatus } from "./api";

type CsvFileLike = Pick<File, "lastModified" | "name">;

export function sortCsvFiles<T extends CsvFileLike>(files: T[]): T[] {
  const datedFiles = files.map((file) => ({ file, dateKey: logFileDateKey(file.name) }));

  if (datedFiles.every((entry) => entry.dateKey !== null)) {
    return datedFiles
      .sort(
        (left, right) =>
          left.dateKey! - right.dateKey! || left.file.name.localeCompare(right.file.name),
      )
      .map((entry) => entry.file);
  }

  return [...files].sort(
    (left, right) => left.lastModified - right.lastModified || left.name.localeCompare(right.name),
  );
}

export function scanStartIndex(
  files: CsvFileLike[],
  status: Pick<BrowserTailStatus, "active_file_name" | "last_modified_ms"> | null,
): number {
  if (!status?.active_file_name) {
    return 0;
  }

  const activeIndex = files.findIndex((file) => file.name === status.active_file_name);
  if (activeIndex >= 0) {
    return activeIndex;
  }

  const activeDate = logFileDateKey(status.active_file_name);
  if (activeDate !== null && files.every((file) => logFileDateKey(file.name) !== null)) {
    const firstNewer = files.findIndex((file) => logFileDateKey(file.name)! > activeDate);
    return firstNewer >= 0 ? firstNewer : files.length;
  }

  const firstNewer = files.findIndex(
    (file) => file.lastModified > (status.last_modified_ms ?? 0),
  );
  return firstNewer >= 0 ? firstNewer : files.length;
}

export function logFileDateKey(fileName: string): number | null {
  const match = fileName.match(/^LogFile_(\d{4})_(\d{2})_(\d{2})\.csv$/i);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return year * 10_000 + month * 100 + day;
}
