import type { ChartTimeRange } from "./types";

const HOUR_MS = 60 * 60 * 1_000;

type TimestampedSample = {
  sampled_at: string;
};

type TimeSegment = {
  started_at: string;
  finished_at: string | null;
};

export function samplesForChartRange<T extends TimestampedSample>(
  samples: T[],
  range: ChartTimeRange,
): T[] {
  if (range === "all" || samples.length === 0) {
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
  range: ChartTimeRange,
): T[] {
  if (range === "all" || segments.length === 0) {
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
