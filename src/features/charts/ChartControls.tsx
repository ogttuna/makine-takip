import { lazy, Suspense } from "react";

import type { ProcessStateSegment, QualityEvent, SampleFrame } from "../../api";
import type { ChannelGroup } from "../../channelConfig";
import { channelLabel, getChannelConfig, sortChannels } from "../../channelConfig";
import { ChartState } from "../../components/StatusViews";
import type { AppCopy, Locale } from "../../i18n";
import type { ChartLayout, ChartTimeRange, ThemeMode } from "../../types";

const CHART_GROUPS: Array<{
  group: ChannelGroup;
}> = [
  { group: "shelf" },
  { group: "pressure" },
  { group: "vacuum" },
  { group: "cooling" },
  { group: "other" },
];

const TelemetryChart = lazy(() =>
  import("../../TelemetryChart").then((module) => ({ default: module.TelemetryChart })),
);

export function UnitNote({
  copy,
  locale,
  pendingChannels,
}: {
  copy: AppCopy["chart"];
  locale: Locale;
  pendingChannels: string[];
}) {
  const pendingLabels = pendingChannels.map((channel) => channelLabel(channel, locale));

  if (pendingChannels.length === 0) {
    return (
      <p className="unit-note">
        <strong>{copy.unitAssumptionTitle}</strong>
        <span>{copy.unitAssumptionBody}</span>
      </p>
    );
  }

  return (
    <p className="unit-note">
      <strong>{copy.unitCheckTitle}</strong>
      <span>{copy.unitCheckBody(pendingLabels.join(", "))}</span>
    </p>
  );
}

export function ChartViewControls({
  chartLayout,
  chartTimeRange,
  copy,
  onChartLayoutChange,
  onChartTimeRangeChange,
}: {
  chartLayout: ChartLayout;
  chartTimeRange: ChartTimeRange;
  copy: AppCopy["chart"];
  onChartLayoutChange: (layout: ChartLayout) => void;
  onChartTimeRangeChange: (range: ChartTimeRange) => void;
}) {
  return (
    <div className="chart-toolbar">
      <div className="toolbar-cluster">
        <span>{copy.rangeLabel}</span>
        <div
          className="segmented-control range-control"
          role="group"
          aria-label={copy.rangeAria}
        >
          <button
            aria-pressed={chartTimeRange === "24h"}
            className={chartTimeRange === "24h" ? "active" : ""}
            onClick={() => onChartTimeRangeChange("24h")}
            type="button"
          >
            {copy.last24Hours}
          </button>
          <button
            aria-pressed={chartTimeRange === "7d"}
            className={chartTimeRange === "7d" ? "active" : ""}
            onClick={() => onChartTimeRangeChange("7d")}
            type="button"
          >
            {copy.last7Days}
          </button>
          <button
            aria-pressed={chartTimeRange === "all"}
            className={chartTimeRange === "all" ? "active" : ""}
            onClick={() => onChartTimeRangeChange("all")}
            type="button"
          >
            {copy.allTime}
          </button>
        </div>
      </div>
      <div className="toolbar-cluster">
        <span>{copy.modeLabel}</span>
        <div className="segmented-control" role="group" aria-label={copy.modeAria}>
          <button
            aria-pressed={chartLayout === "overlay"}
            className={chartLayout === "overlay" ? "active" : ""}
            onClick={() => onChartLayoutChange("overlay")}
            type="button"
          >
            {copy.overlay}
          </button>
          <button
            aria-pressed={chartLayout === "grouped"}
            className={chartLayout === "grouped" ? "active" : ""}
            onClick={() => onChartLayoutChange("grouped")}
            type="button"
          >
            {copy.grouped}
          </button>
        </div>
      </div>
    </div>
  );
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
    <>
      <Suspense
        fallback={
          <ChartState
            message={copy.loadingMessage}
            title={copy.loadingTitle}
          />
        }
      >
        {layout === "overlay" ? (
          <TelemetryChart
            locale={locale}
            processSegments={processSegments}
            qualityEvents={qualityEvents}
            samples={samples}
            themeMode={themeMode}
            visibleChannels={visibleChannels}
          />
        ) : (
          <div className="chart-grid">
            {groupedCharts.map((chart) => (
              <section className="chart-tile" key={chart.group}>
                <div className="chart-tile-heading">
                  <div>
                    <strong>{chart.title}</strong>
                    <span>{chart.note}</span>
                  </div>
                  <small>{copy.groups.signalCount(chart.channels.length)}</small>
                </div>
                <TelemetryChart
                  locale={locale}
                  processSegments={processSegments}
                  qualityEvents={qualityEvents}
                  samples={samples}
                  showSlider={false}
                  themeMode={themeMode}
                  variant="compact"
                  visibleChannels={chart.channels}
                />
              </section>
            ))}
          </div>
        )}
      </Suspense>
    </>
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

  const chooseGroup = (group: ReturnType<typeof getChannelConfig>["group"]) => {
    onChange(
      sortChannels(
        channels.filter((channel) => getChannelConfig(channel).group === group),
      ),
    );
  };

  return (
    <div className="channel-control-shell">
      <div className="control-heading">
        <div className="control-title">
          <strong>{copy.channels.title}</strong>
          <span>
            {copy.channels.visible(visibleChannels.length, channels.length)}
          </span>
        </div>
        <div className="channel-quick-actions" aria-label={copy.channels.quickLabel}>
          <button onClick={() => onChange(channels)} type="button">
            {copy.channels.all}
          </button>
          <button onClick={() => chooseGroup("shelf")} type="button">
            {copy.channels.shelves}
          </button>
          <button onClick={() => chooseGroup("pressure")} type="button">
            {copy.channels.pressure}
          </button>
          <button onClick={() => chooseGroup("cooling")} type="button">
            {copy.channels.cooling}
          </button>
          <button onClick={() => onChange([])} type="button">
            {copy.channels.clear}
          </button>
        </div>
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
              onClick={() => {
                if (active) {
                  onChange(visibleChannels.filter((item) => item !== channel));
                } else {
                  onChange(sortChannels([...visibleChannels, channel]));
                }
              }}
              type="button"
            >
              <span>{channelLabel(channel, locale)}</span>
              {secondaryLabel ? <small>{secondaryLabel}</small> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function chartGroupsFor(channels: string[], copy: AppCopy["chart"]) {
  return CHART_GROUPS.map((groupConfig) => ({
    ...groupConfig,
    ...copy.groups[groupConfig.group],
    channels: sortChannels(
      channels.filter(
        (channel) => getChannelConfig(channel).group === groupConfig.group,
      ),
    ),
  })).filter((groupConfig) => groupConfig.channels.length > 0);
}
