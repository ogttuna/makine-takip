import { lazy, Suspense, useId, useState } from "react";

import type { ProcessStateSegment, QualityEvent, SampleFrame } from "../../api";
import {
  CHANNEL_GROUP_ORDER,
  channelLabel,
  getChannelConfig,
  sortChannels,
  type ChannelGroup,
} from "../../channelConfig";
import {
  timestampDateInputValue,
  validateChartDateRange,
  type ChartDateRangeError,
} from "../../chartTimeRange";
import { ChartState } from "../../components/StatusViews";
import type { AppCopy, Locale } from "../../i18n";
import type {
  ChartDateRange,
  ChartLayout,
  ChartTimeRange,
  ThemeMode,
} from "../../types";

const TelemetryChart = lazy(() =>
  import("../../TelemetryChart").then((module) => ({ default: module.TelemetryChart })),
);

const PRIMARY_GROUPS = new Set<ChannelGroup>([
  "shelf_temperature",
  "cooling_temperature",
]);

export function UnitNote({
  copy,
  locale,
  pendingChannels,
}: {
  copy: AppCopy["chart"];
  locale: Locale;
  pendingChannels: string[];
}) {
  if (pendingChannels.length === 0) {
    return null;
  }

  const pendingLabels = pendingChannels.map((channel) => channelLabel(channel, locale));
  return (
    <p className="unit-note" role="note">
      <strong>{copy.unitCheckTitle}</strong>
      <span>{copy.unitCheckBody(pendingLabels.join(", "))}</span>
    </p>
  );
}

export function ChartViewControls({
  availableFrom,
  availableTo,
  chartLayout,
  chartTimeRange,
  copy,
  customDateRange,
  locale,
  onChartLayoutChange,
  onCustomDateRangeApply,
  onChartTimeRangeChange,
}: {
  availableFrom: string | null;
  availableTo: string | null;
  chartLayout: ChartLayout;
  chartTimeRange: ChartTimeRange;
  copy: AppCopy["chart"];
  customDateRange: ChartDateRange | null;
  locale: Locale;
  onChartLayoutChange: (layout: ChartLayout) => void;
  onCustomDateRangeApply: (range: ChartDateRange) => void;
  onChartTimeRangeChange: (range: ChartTimeRange) => void;
}) {
  const errorId = useId();
  const [dateEditorOpen, setDateEditorOpen] = useState(false);
  const [dateRangeDraft, setDateRangeDraft] = useState<ChartDateRange>({
    startDate: "",
    endDate: "",
  });
  const [dateRangeError, setDateRangeError] = useState<ChartDateRangeError | null>(null);
  const minDate = timestampDateInputValue(availableFrom) ?? undefined;
  const maxDate = timestampDateInputValue(availableTo) ?? undefined;

  const choosePreset = (range: Exclude<ChartTimeRange, "custom">) => {
    setDateEditorOpen(false);
    setDateRangeError(null);
    onChartTimeRangeChange(range);
  };
  const openDateEditor = () => {
    const suggestedDate = maxDate ?? minDate ?? "";
    setDateRangeDraft(
      customDateRange ?? {
        startDate: suggestedDate,
        endDate: suggestedDate,
      },
    );
    setDateRangeError(null);
    setDateEditorOpen(true);
  };
  const applyDateRange = () => {
    const error = validateChartDateRange(dateRangeDraft);
    if (error) {
      setDateRangeError(error);
      return;
    }

    setDateRangeError(null);
    setDateEditorOpen(false);
    onCustomDateRangeApply(dateRangeDraft);
  };

  return (
    <div className="chart-toolbar">
      <div className="toolbar-cluster">
        <span>{copy.rangeLabel}</span>
        <div className="segmented-control" role="group" aria-label={copy.rangeAria}>
          {(["24h", "7d", "all"] as const).map((range) => (
            <button
              aria-pressed={chartTimeRange === range}
              className={chartTimeRange === range ? "active" : ""}
              key={range}
              onClick={() => choosePreset(range)}
              type="button"
            >
              {range === "24h"
                ? copy.last24Hours
                : range === "7d"
                  ? copy.last7Days
                  : copy.allTime}
            </button>
          ))}
          <button
            aria-expanded={dateEditorOpen}
            aria-pressed={chartTimeRange === "custom"}
            className={chartTimeRange === "custom" ? "active" : ""}
            onClick={openDateEditor}
            type="button"
          >
            {copy.customRange}
          </button>
        </div>
      </div>
      <div className="toolbar-cluster">
        <span>{copy.modeLabel}</span>
        <div className="segmented-control" role="group" aria-label={copy.modeAria}>
          <button
            aria-pressed={chartLayout === "dashboard"}
            className={chartLayout === "dashboard" ? "active" : ""}
            onClick={() => onChartLayoutChange("dashboard")}
            type="button"
          >
            {copy.dashboard}
          </button>
          <button
            aria-pressed={chartLayout === "stacked"}
            className={chartLayout === "stacked" ? "active" : ""}
            onClick={() => onChartLayoutChange("stacked")}
            type="button"
          >
            {copy.stacked}
          </button>
        </div>
      </div>

      {dateEditorOpen ? (
        <form
          className="date-range-form"
          onSubmit={(event) => {
            event.preventDefault();
            applyDateRange();
          }}
        >
          <div className="date-range-fields">
            <label>
              <span>{copy.startDate}</span>
              <input
                aria-describedby={dateRangeError ? errorId : undefined}
                max={maxDate}
                min={minDate}
                onChange={(event) => {
                  setDateRangeDraft((current) => ({
                    ...current,
                    startDate: event.target.value,
                  }));
                  setDateRangeError(null);
                }}
                type="date"
                value={dateRangeDraft.startDate}
              />
            </label>
            <span className="date-range-separator" aria-hidden="true">
              →
            </span>
            <label>
              <span>{copy.endDate}</span>
              <input
                aria-describedby={dateRangeError ? errorId : undefined}
                max={maxDate}
                min={minDate}
                onChange={(event) => {
                  setDateRangeDraft((current) => ({
                    ...current,
                    endDate: event.target.value,
                  }));
                  setDateRangeError(null);
                }}
                type="date"
                value={dateRangeDraft.endDate}
              />
            </label>
          </div>
          <button className="date-range-apply" type="submit">
            {copy.applyDateRange}
          </button>
          {dateRangeError ? (
            <p className="date-range-error" id={errorId} role="alert">
              {copy.dateRangeErrors[dateRangeError]}
            </p>
          ) : null}
        </form>
      ) : chartTimeRange === "custom" && customDateRange ? (
        <button
          aria-label={copy.editDateRange}
          className="date-range-summary"
          onClick={openDateEditor}
          type="button"
        >
          <span>{formatDateInput(customDateRange.startDate, locale)}</span>
          <b aria-hidden="true">→</b>
          <span>{formatDateInput(customDateRange.endDate, locale)}</span>
          <strong>{copy.changeDateRange}</strong>
        </button>
      ) : null}
    </div>
  );
}

function formatDateInput(value: string, locale: Locale): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "tr-TR", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function ChartArea({
  copy,
  layout,
  locale,
  processSegments,
  qualityEvents,
  samples,
  themeMode,
  visibleChannels,
}: {
  copy: AppCopy["chart"];
  layout: ChartLayout;
  locale: Locale;
  processSegments: ProcessStateSegment[];
  qualityEvents: QualityEvent[];
  samples: SampleFrame[];
  themeMode: ThemeMode;
  visibleChannels: string[];
}) {
  const groupedCharts = chartGroupsFor(visibleChannels, copy);

  return (
    <Suspense
      fallback={<ChartState message={copy.loadingMessage} title={copy.loadingTitle} />}
    >
      <div className={`chart-grid ${layout}`}>
        {groupedCharts.map((chart) => (
          <section
            className={`chart-tile chart-${chart.group} ${
              PRIMARY_GROUPS.has(chart.group) ? "primary" : "supporting"
            }`}
            key={chart.group}
          >
            <div className="chart-tile-heading">
              <div>
                <strong>{chart.title}</strong>
                <span>{chart.note}</span>
              </div>
              <div className="chart-tile-meta">
                {chart.unit ? <b>{chart.unit}</b> : null}
                <small>{copy.groups.signalCount(chart.channels.length)}</small>
              </div>
            </div>
            <TelemetryChart
              locale={locale}
              processSegments={processSegments}
              qualityEvents={qualityEvents}
              samples={samples}
              showSlider={layout === "stacked"}
              themeMode={themeMode}
              variant={layout === "stacked" ? "large" : "compact"}
              visibleChannels={chart.channels}
            />
          </section>
        ))}
      </div>
    </Suspense>
  );
}

export function ChannelControls({
  channels,
  copy,
  locale,
  visibleChannels,
  onChange,
}: {
  channels: string[];
  copy: AppCopy["chart"];
  locale: Locale;
  visibleChannels: string[];
  onChange: (channels: string[]) => void;
}) {
  if (channels.length === 0) {
    return null;
  }

  const presentGroups = CHANNEL_GROUP_ORDER.filter((group) =>
    channels.some((channel) => getChannelConfig(channel).group === group),
  );
  const chooseGroup = (group: ChannelGroup) => {
    onChange(
      sortChannels(channels.filter((channel) => getChannelConfig(channel).group === group)),
    );
  };

  return (
    <details className="channel-control-shell">
      <summary>
        <span>
          <strong>{copy.channels.title}</strong>
          <small>{copy.channels.visible(visibleChannels.length, channels.length)}</small>
        </span>
        <span aria-hidden="true">+</span>
      </summary>
      <div className="channel-control-body">
        <div className="channel-quick-actions" aria-label={copy.channels.quickLabel}>
          <button onClick={() => onChange(channels)} type="button">
            {copy.channels.all}
          </button>
          {presentGroups.map((group) => (
            <button key={group} onClick={() => chooseGroup(group)} type="button">
              {copy.groups[group].shortTitle}
            </button>
          ))}
          <button onClick={() => onChange([])} type="button">
            {copy.channels.clear}
          </button>
        </div>
        <div className="channel-controls">
          {channels.map((channel) => {
            const active = visibleChannels.includes(channel);
            const config = getChannelConfig(channel);
            const secondaryLabel = [
              config.unit,
              config.derived ? copy.channels.derived : null,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <button
                aria-pressed={active}
                className={active ? "channel-button active" : "channel-button"}
                key={channel}
                onClick={() =>
                  onChange(
                    active
                      ? visibleChannels.filter((item) => item !== channel)
                      : sortChannels([...visibleChannels, channel]),
                  )
                }
                type="button"
              >
                <span>{channelLabel(channel, locale)}</span>
                {secondaryLabel ? <small>{secondaryLabel}</small> : null}
              </button>
            );
          })}
        </div>
      </div>
    </details>
  );
}

function chartGroupsFor(channels: string[], copy: AppCopy["chart"]) {
  return CHANNEL_GROUP_ORDER.map((group) => {
    const groupedChannels = sortChannels(
      channels.filter((channel) => getChannelConfig(channel).group === group),
    );
    const units = [
      ...new Set(groupedChannels.map((channel) => getChannelConfig(channel).unit).filter(Boolean)),
    ];

    return {
      group,
      ...copy.groups[group],
      channels: groupedChannels,
      unit: units.length === 1 ? units[0] : null,
    };
  }).filter((groupConfig) => groupConfig.channels.length > 0);
}
