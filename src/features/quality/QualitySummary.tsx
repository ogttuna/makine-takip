import type { QualityEvent } from "../../api";
import { InlineError } from "../../components/StatusViews";
import { channelLabel } from "../../channelConfig";
import type { AppCopy, Locale } from "../../i18n";
import type { QualityFilter } from "../../types";
import {
  formatDate,
  formatMachineTimestamp,
  formatSeconds,
} from "../../utils/format";

export function QualitySummary({
  copy,
  error,
  events,
  filter,
  isLoading,
  locale,
  onFilterChange,
  onRetry,
  visibleLimit = 5,
}: {
  copy: AppCopy["quality"] & { retry: string };
  error: Error | null;
  events: QualityEvent[];
  filter: QualityFilter;
  isLoading: boolean;
  locale: Locale;
  onFilterChange: (filter: QualityFilter) => void;
  onRetry: () => void;
  visibleLimit?: number;
}) {
  const counts = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.event_type] = (acc[event.event_type] ?? 0) + 1;
    return acc;
  }, {});
  const gapCount = counts.time_gap ?? 0;
  const suspectCount = counts.suspect_value ?? 0;
  const otherCount = Math.max(0, events.length - gapCount - suspectCount);
  const filteredEvents = events.filter((event) => {
    if (filter === "all") {
      return true;
    }
    if (filter === "other") {
      return event.event_type !== "time_gap" && event.event_type !== "suspect_value";
    }
    return event.event_type === filter;
  });
  const visibleEvents = filteredEvents.slice(0, visibleLimit);

  return (
    <div className="quality-summary">
      <div className="quality-header">
        <div>
          <strong>{copy.title}</strong>
          <span>{qualitySummaryLabel(events.length, copy)}</span>
        </div>
      </div>
      <div className="quality-filters">
        <FilterButton
          active={filter === "all"}
          count={events.length}
          label={copy.filters.all}
          onClick={() => onFilterChange("all")}
        />
        <FilterButton
          active={filter === "time_gap"}
          count={gapCount}
          label={copy.filters.gap}
          onClick={() => onFilterChange("time_gap")}
        />
        <FilterButton
          active={filter === "suspect_value"}
          count={suspectCount}
          label={copy.filters.suspect}
          onClick={() => onFilterChange("suspect_value")}
        />
        <FilterButton
          active={filter === "other"}
          count={otherCount}
          label={copy.filters.other}
          onClick={() => onFilterChange("other")}
        />
      </div>
      {isLoading ? (
        <span>{copy.loading}</span>
      ) : error ? (
        <InlineError
          actionLabel={copy.retry}
          message={error.message}
          onAction={onRetry}
          title={copy.loadError}
        />
      ) : events.length === 0 ? (
        <span className="quality-empty">{copy.empty}</span>
      ) : filteredEvents.length === 0 ? (
        <span className="quality-empty">{copy.filterEmpty}</span>
      ) : (
        <div className="quality-overview">
          <strong>{qualityFilterHeadline(filter, filteredEvents.length, copy)}</strong>
          <span>{qualityFilterDescription(filter, gapCount, suspectCount, otherCount, copy)}</span>
          <div className="quality-breakdown" aria-label={copy.breakdownLabel}>
            <div>
              <span>{copy.breakdownGap}</span>
              <strong>{gapCount}</strong>
            </div>
            <div>
              <span>{copy.breakdownSuspect}</span>
              <strong>{suspectCount}</strong>
            </div>
            <div>
              <span>{copy.breakdownOther}</span>
              <strong>{otherCount}</strong>
            </div>
          </div>
        </div>
      )}
      {visibleEvents.length > 0 ? (
        <ul className="quality-event-list">
          {visibleEvents.map((event) => {
            const view = qualityEventView(event, locale, copy);

            return (
              <li className="quality-event" key={event.id}>
                <div className="quality-event-top">
                  <strong>{view.title}</strong>
                  <span>{view.location}</span>
                </div>
                <span className="quality-event-time">{view.meta}</span>
                <p>{view.detail}</p>
              </li>
            );
          })}
        </ul>
      ) : null}
      {filteredEvents.length > visibleEvents.length ? (
        <span>{copy.hiddenMore(filteredEvents.length - visibleEvents.length)}</span>
      ) : null}
    </div>
  );
}

function FilterButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={active ? "filter-button active" : "filter-button"}
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
  );
}

function qualitySummaryLabel(count: number, copy: AppCopy["quality"]): string {
  if (count === 0) {
    return copy.noWarning;
  }

  return copy.needsReview(count);
}

function qualityFilterHeadline(
  filter: QualityFilter,
  count: number,
  copy: AppCopy["quality"],
): string {
  if (filter === "time_gap") {
    return copy.headlineGap(count);
  }

  if (filter === "suspect_value") {
    return copy.headlineSuspect(count);
  }

  if (filter === "other") {
    return copy.headlineOther(count);
  }

  return copy.headlineAll(count);
}

function qualityFilterDescription(
  filter: QualityFilter,
  gapCount: number,
  suspectCount: number,
  otherCount: number,
  copy: AppCopy["quality"],
): string {
  if (filter === "time_gap") {
    return copy.descGap;
  }

  if (filter === "suspect_value") {
    return copy.descSuspect;
  }

  if (filter === "other") {
    return copy.descOther;
  }

  return copy.descAll(gapCount, suspectCount, otherCount);
}

function qualityEventView(
  event: QualityEvent,
  locale: Locale,
  copy: AppCopy["quality"],
): {
  detail: string;
  location: string;
  meta: string;
  title: string;
} {
  const metadata = parseQualityMetadata(event.metadata_json);
  const location = event.source_row_number !== null ? copy.row(event.source_row_number) : copy.noRow;
  const time = qualityEventDisplayTime(event, locale, copy);

  if (event.event_type === "time_gap") {
    const gapSeconds = qualityGapSeconds(event, metadata);

    return {
      title: copy.longGap,
      location,
      meta: time,
      detail: gapSeconds !== null
        ? copy.longGapDetail(formatSeconds(gapSeconds, locale))
        : copy.longGapFallback,
    };
  }

  if (event.event_type === "suspect_value") {
    const channelName = event.channel_code
      ? channelLabel(event.channel_code, locale)
      : copy.channel;
    const rawValue =
      stringFromMetadata(metadata, "raw_text") ??
      suspectValueFromMessage(event.message) ??
      numberFromMetadata(metadata, "raw_value")?.toString() ??
      copy.unknownValue;

    return {
      title: copy.suspectTitle,
      location: event.channel_code ? `${channelName} - ${location}` : location,
      meta: time,
      detail: copy.suspectDetail(channelName, rawValue),
    };
  }

  if (event.event_type === "parse_error") {
    const channelName = event.channel_code
      ? channelLabel(event.channel_code, locale)
      : copy.channel;
    const rawValue =
      stringFromMetadata(metadata, "raw_text") ??
      suspectValueFromMessage(event.message) ??
      copy.unknownValue;

    return {
      title: copy.invalidCellTitle,
      location: event.channel_code ? `${channelName} - ${location}` : location,
      meta: time,
      detail: copy.invalidCellDetail(channelName, rawValue),
    };
  }

  if (event.event_type === "csv_row_timestamp_error") {
    return {
      title: copy.invalidTimestampTitle,
      location,
      meta: time,
      detail: copy.invalidTimestampDetail(event.source_timestamp_text ?? copy.unknownValue),
    };
  }

  if (event.event_type.startsWith("csv_row_")) {
    return {
      title: copy.invalidRowTitle,
      location,
      meta: time,
      detail: copy.invalidRowDetail,
    };
  }

  return {
    title: copy.genericTitle,
    location,
    meta: time,
    detail: cleanQualityMessage(event.message),
  };
}

function qualityEventDisplayTime(
  event: QualityEvent,
  locale: Locale,
  copy: AppCopy["quality"],
): string {
  if (event.source_timestamp_text) {
    return formatMachineTimestamp(event.source_timestamp_text, locale);
  }

  if (event.sampled_at) {
    return formatDate(event.sampled_at, locale);
  }

  return copy.noTime;
}

function parseQualityMetadata(metadataJson: string | null): Record<string, unknown> {
  if (!metadataJson) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(metadataJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function qualityGapSeconds(
  event: QualityEvent,
  metadata: Record<string, unknown>,
): number | null {
  const metadataValue = numberFromMetadata(metadata, "gap_seconds");

  if (metadataValue !== null) {
    return metadataValue;
  }

  const match = event.message.match(/time gap of ([\d.]+) seconds/);
  return match ? Number(match[1]) : null;
}

function numberFromMetadata(
  metadata: Record<string, unknown>,
  key: string,
): number | null {
  const value = metadata[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return null;
}

function stringFromMetadata(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function suspectValueFromMessage(message: string): string | null {
  const match = message.match(/value ([^\s]+)/);
  return match ? match[1] : null;
}

function cleanQualityMessage(message: string): string {
  return message.replaceAll("`", "");
}
