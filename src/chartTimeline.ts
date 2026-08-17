import type { Locale } from "./i18n";

const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
const SHORT_RANGE_MS = 36 * 60 * 60 * 1_000;
const MEDIUM_RANGE_MS = 14 * ONE_DAY_MS;
const YEAR_RANGE_MS = 370 * ONE_DAY_MS;

type TimestampedSample = {
  sampled_at: string;
  source_row_number: number;
};

export type TimelineExtent = {
  endMs: number;
  spanMs: number;
  startMs: number;
};

export function chronologicalSamples<T extends TimestampedSample>(samples: T[]): T[] {
  return samples
    .map((sample, index) => ({
      index,
      sample,
      timestampMs: Date.parse(sample.sampled_at),
    }))
    .filter((entry) => Number.isFinite(entry.timestampMs))
    .sort(
      (left, right) =>
        left.timestampMs - right.timestampMs ||
        left.sample.source_row_number - right.sample.source_row_number ||
        left.index - right.index,
    )
    .map((entry) => entry.sample);
}

export function timelineExtent(samples: TimestampedSample[]): TimelineExtent | null {
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;

  for (const sample of samples) {
    const timestampMs = Date.parse(sample.sampled_at);
    if (!Number.isFinite(timestampMs)) {
      continue;
    }

    startMs = Math.min(startMs, timestampMs);
    endMs = Math.max(endMs, timestampMs);
  }

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }

  return {
    startMs,
    endMs,
    spanMs: Math.max(0, endMs - startMs),
  };
}

export function formatTimelineAxis(
  value: number | string,
  locale: Locale,
  spanMs: number,
): string {
  const timestamp = typeof value === "number" ? value : Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return String(value);
  }

  const date = new Date(timestamp);
  const language = locale === "en" ? "en-US" : "tr-TR";

  if (spanMs <= SHORT_RANGE_MS) {
    return new Intl.DateTimeFormat(language, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  if (spanMs <= MEDIUM_RANGE_MS) {
    const day = new Intl.DateTimeFormat(language, {
      day: "2-digit",
      month: "2-digit",
    }).format(date);
    const time = new Intl.DateTimeFormat(language, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
    return `${day}\n${time}`;
  }

  return new Intl.DateTimeFormat(language, {
    day: "2-digit",
    month: "2-digit",
    ...(spanMs > YEAR_RANGE_MS ? { year: "2-digit" as const } : {}),
  }).format(date);
}

export function stateLabelFits(
  startedAt: string,
  finishedAt: string,
  label: string,
  extent: TimelineExtent | null,
  plotWidth: number,
): boolean {
  if (!extent || extent.spanMs <= 0 || plotWidth <= 0) {
    return false;
  }

  const startedAtMs = Date.parse(startedAt);
  const finishedAtMs = Date.parse(finishedAt);
  if (
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(finishedAtMs) ||
    finishedAtMs <= startedAtMs
  ) {
    return false;
  }

  const visibleStart = Math.max(startedAtMs, extent.startMs);
  const visibleEnd = Math.min(finishedAtMs, extent.endMs);
  if (visibleEnd <= visibleStart) {
    return false;
  }

  const segmentWidth = ((visibleEnd - visibleStart) / extent.spanMs) * plotWidth;
  const requiredWidth = Math.max(34, label.length * 6.4 + 12);
  return segmentWidth >= requiredWidth;
}
