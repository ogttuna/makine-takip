const MINUTE_MS = 60 * 1_000;
const HOUR_MS = 60 * MINUTE_MS;
const MAX_EXPORT_RANGE_MS = 120 * HOUR_MS;
const DATE_TIME_INPUT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export const MAX_EXPORT_RANGE_HOURS = 120;

export type ExportDateTimeRange = {
  startDateTime: string;
  endDateTime: string;
};

export type ExportRangeError = "missing" | "invalid" | "order" | "too_long";

export type ExportRangeQuery = {
  from: string;
  to: string;
};

export function validateExportRange(
  range: ExportDateTimeRange,
): ExportRangeError | null {
  if (!range.startDateTime || !range.endDateTime) {
    return "missing";
  }

  const start = parseDateTimeInput(range.startDateTime);
  const end = parseDateTimeInput(range.endDateTime);
  if (start === null || end === null) {
    return "invalid";
  }
  if (start > end) {
    return "order";
  }
  if (end - start > MAX_EXPORT_RANGE_MS) {
    return "too_long";
  }

  return null;
}

export function exportRangeQuery(
  range: ExportDateTimeRange,
): ExportRangeQuery | null {
  if (validateExportRange(range) !== null) {
    return null;
  }

  return {
    from: `${range.startDateTime}:00.000`,
    to: `${range.endDateTime}:00.000`,
  };
}

export function defaultExportRange(
  latestTimestamp: string | null,
  earliestTimestamp: string | null,
  now = new Date(),
): ExportDateTimeRange {
  const latestInput = timestampDateTimeInputValue(latestTimestamp, "end");
  const fallbackEnd = formatDateTimeInput(now.getTime());
  const endDateTime = latestInput ?? fallbackEnd;
  const end = parseDateTimeInput(endDateTime) ?? now.getTime();
  const earliest = parseTimestampMinute(earliestTimestamp);
  const preferredStart = end - 24 * HOUR_MS;
  const start = earliest === null ? preferredStart : Math.max(preferredStart, earliest);

  return {
    startDateTime: formatDateTimeInput(start),
    endDateTime,
  };
}

export function timestampDateTimeInputValue(
  value: string | null | undefined,
  boundary: "start" | "end" = "start",
): string | null {
  const inputValue = value?.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/)?.[1] ?? null;
  if (inputValue === null) {
    return null;
  }
  const minute = parseDateTimeInput(inputValue);
  if (minute === null) {
    return null;
  }

  // A minute-only end input must not round down past the latest sample.
  // Keep exact API bounds and the 120-hour limit unchanged.
  const seconds = value?.slice(16).match(/^:(\d{2}(?:\.\d+)?)/)?.[1];
  return boundary === "end" && Number(seconds ?? 0) > 0
    ? formatDateTimeInput(minute + MINUTE_MS)
    : inputValue;
}

function parseTimestampMinute(value: string | null): number | null {
  const inputValue = timestampDateTimeInputValue(value);
  return inputValue === null ? null : parseDateTimeInput(inputValue);
}

function parseDateTimeInput(value: string): number | null {
  const match = value.match(DATE_TIME_INPUT_PATTERN);
  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const timestamp = Date.UTC(year, month - 1, day, hour, minute);
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute
  ) {
    return null;
  }

  return timestamp;
}

function formatDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}
