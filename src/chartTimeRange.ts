import type { ChartDateRange, ChartTimeRange } from "./types";

const HOUR_MS = 60 * 60 * 1_000;

type TimestampedSample = {
  sampled_at: string;
};

type TimeSegment = {
  started_at: string;
  finished_at: string | null;
};

export type ChartDateRangeError = "missing" | "invalid" | "order";

export type ChartDateRangeQuery = {
  from: string;
  to: string;
};

export function samplesForChartRange<T extends TimestampedSample>(
  samples: T[],
  range: ChartTimeRange,
): T[] {
  if (range === "all" || range === "custom" || samples.length === 0) {
    return samples;
  }

  const durationMs = range === "24h" ? 24 * HOUR_MS : 7 * 24 * HOUR_MS;
  const latestTimestamp = latestValidTimestamp(samples);

  if (latestTimestamp === null) {
    return [];
  }

  const cutoff = latestTimestamp - durationMs;
  return samples.filter((sample) => {
    const timestamp = Date.parse(sample.sampled_at);
    return Number.isFinite(timestamp) && timestamp > cutoff && timestamp <= latestTimestamp;
  });
}

export function segmentsForVisibleSamples<T extends TimeSegment>(
  segments: T[],
  visibleSamples: TimestampedSample[],
): T[] {
  if (segments.length === 0) {
    return segments;
  }

  const timestamps = visibleSamples
    .map((sample) => Date.parse(sample.sampled_at))
    .filter(Number.isFinite);

  if (timestamps.length === 0) {
    return [];
  }

  const visibleStart = Math.min(...timestamps);
  const visibleEnd = Math.max(...timestamps);

  return segments.flatMap((segment) => {
    const startedAt = Date.parse(segment.started_at);
    const finishedAt = segment.finished_at === null ? visibleEnd : Date.parse(segment.finished_at);

    if (
      !Number.isFinite(startedAt) ||
      !Number.isFinite(finishedAt) ||
      finishedAt < visibleStart ||
      startedAt > visibleEnd
    ) {
      return [];
    }

    return [
      {
        ...segment,
        started_at: new Date(Math.max(startedAt, visibleStart)).toISOString(),
        finished_at:
          segment.finished_at === null && finishedAt <= visibleEnd
            ? null
            : new Date(Math.min(finishedAt, visibleEnd)).toISOString(),
      },
    ];
  });
}

export function validateChartDateRange(
  range: ChartDateRange,
): ChartDateRangeError | null {
  if (!range.startDate || !range.endDate) {
    return "missing";
  }

  if (!isValidDateInput(range.startDate) || !isValidDateInput(range.endDate)) {
    return "invalid";
  }

  if (range.startDate > range.endDate) {
    return "order";
  }

  return null;
}

export function chartDateRangeQuery(
  range: ChartDateRange,
): ChartDateRangeQuery | null {
  if (validateChartDateRange(range) !== null) {
    return null;
  }

  return {
    from: `${range.startDate}T00:00:00.000`,
    to: `${range.endDate}T23:59:59.999`,
  };
}

export function timestampDateInputValue(value: string | null | undefined): string | null {
  const datePart = value?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  return datePart && isValidDateInput(datePart) ? datePart : null;
}

function isValidDateInput(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function latestValidTimestamp(samples: TimestampedSample[]): number | null {
  let latest = Number.NEGATIVE_INFINITY;

  for (const sample of samples) {
    const timestamp = Date.parse(sample.sampled_at);
    if (Number.isFinite(timestamp)) {
      latest = Math.max(latest, timestamp);
    }
  }

  return Number.isFinite(latest) ? latest : null;
}
