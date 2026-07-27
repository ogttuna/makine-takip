import { LineChart, ScatterChart, type LineSeriesOption, type ScatterSeriesOption } from "echarts/charts";
import {
  DataZoomComponent,
  type DataZoomComponentOption,
  GridComponent,
  type GridComponentOption,
  LegendComponent,
  type LegendComponentOption,
  MarkAreaComponent,
  TooltipComponent,
  type TooltipComponentOption,
} from "echarts/components";
import * as echarts from "echarts/core";
import type {
  TooltipComponentFormatterCallbackParams,
  YAXisComponentOption,
} from "echarts";
import type { ComposeOption, EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ProcessStateSegment, QualityEvent, SampleFrame } from "./api";
import {
  channelColor,
  channelLabel,
  getChannelConfig,
  SHELF_AVERAGE_CHANNEL,
  SHELF_CHANNELS,
  sortChannels,
} from "./channelConfig";
import type { Locale } from "./i18n";

type TelemetryChartProps = {
  samples: SampleFrame[];
  processSegments: ProcessStateSegment[];
  qualityEvents: QualityEvent[];
  visibleChannels: string[];
  variant?: "large" | "compact";
  showSlider?: boolean;
  themeMode?: "light" | "dark";
  locale?: Locale;
};

type TelemetryChartOption = ComposeOption<
  | DataZoomComponentOption
  | GridComponentOption
  | LegendComponentOption
  | LineSeriesOption
  | ScatterSeriesOption
  | TooltipComponentOption
>;

type AxisKind = "main" | "vacuum";

type AxisLayout = {
  indexByKind: Partial<Record<AxisKind, number>>;
  yAxis: YAXisComponentOption[];
};

type ChartDatum = {
  value: [string, number | null];
  rawText?: string;
  displayValue?: string;
};

type TooltipDatumParam = {
  axisValue?: unknown;
  data?: unknown;
  marker?: unknown;
  seriesName?: unknown;
  value?: unknown;
};

type LegendSelectChangedEvent = {
  selected?: Record<string, boolean>;
};

type ChartPalette = {
  axisLine: string;
  axisText: string;
  danger: string;
  legendText: string;
  pointer: string;
  sliderBorder: string;
  sliderFill: string;
  sliderPreviewArea: string;
  splitLine: string;
  tooltipBackground: string;
  tooltipBorder: string;
  tooltipText: string;
  zoomAccent: string;
};

const CHART_FONT_FAMILY =
  'Bahnschrift, "DIN Alternate", "DIN 2014", Aptos, "Aptos Display", "IBM Plex Sans", "Noto Sans", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif';

echarts.use([
  CanvasRenderer,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  LineChart,
  MarkAreaComponent,
  ScatterChart,
  TooltipComponent,
]);

export function TelemetryChart({
  locale = "tr",
  processSegments,
  samples,
  qualityEvents,
  showSlider = true,
  themeMode = "light",
  visibleChannels,
  variant = "large",
}: TelemetryChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const [legendSelection, setLegendSelection] = useState<Record<string, boolean>>({});
  const series = useMemo(
    () =>
      buildSeries(
        samples,
        qualityEvents,
        processSegments,
        visibleChannels,
        themeMode,
        locale,
      ),
    [locale, processSegments, qualityEvents, samples, themeMode, visibleChannels],
  );

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    chartRef.current = echarts.init(containerRef.current, undefined, {
      renderer: "canvas",
    });

    const resizeObserver = new ResizeObserver(() => {
      chartRef.current?.resize();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;

    if (!chart) {
      return;
    }

    const handleLegendSelect = (event: unknown) => {
      const legendEvent = legendSelectEventFrom(event);

      if (legendEvent?.selected) {
        setLegendSelection(legendEvent.selected);
      }
    };

    chart.on("legendselectchanged", handleLegendSelect);

    return () => {
      chart.off("legendselectchanged", handleLegendSelect);
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) {
      return;
    }

    const compact = variant === "compact";
    const palette = chartPalette(themeMode);
    const dataZoom: DataZoomComponentOption[] = [
      {
        type: "inside",
        throttle: 80,
      },
    ];

    if (showSlider) {
      dataZoom.push({
        type: "slider",
        bottom: compact ? 10 : 18,
        height: compact ? 18 : 24,
        borderColor: palette.sliderBorder,
        brushSelect: false,
        fillerColor: palette.sliderFill,
        handleSize: compact ? 12 : 16,
        moveHandleSize: 6,
        selectedDataBackground: {
          lineStyle: {
            color: palette.zoomAccent,
          },
          areaStyle: {
            color: palette.sliderPreviewArea,
          },
        },
        textStyle: {
          color: palette.axisText,
        },
        throttle: 80,
      });
    }

    const option: TelemetryChartOption = {
      animation: false,
      color: series.colors,
      grid: {
        top: compact ? 58 : 86,
        right: compact ? 62 : 76,
        bottom: showSlider ? (compact ? 42 : 78) : 38,
        left: 58,
      },
      legend: {
        type: "scroll",
        top: 0,
        left: 56,
        right: 56,
        height: compact ? 36 : 56,
        selected: legendSelection,
        textStyle: {
          color: palette.legendText,
          fontFamily: CHART_FONT_FAMILY,
          fontSize: compact ? 11 : 12,
          fontWeight: 700,
        },
      },
      tooltip: {
        trigger: "axis",
        transitionDuration: 0,
        axisPointer: {
          animation: false,
          type: "line",
          lineStyle: {
            color: palette.pointer,
            type: "dashed",
            width: 1,
          },
        },
        backgroundColor: palette.tooltipBackground,
        borderColor: palette.tooltipBorder,
        formatter: (params) => formatTooltip(params, locale),
        textStyle: {
          color: palette.tooltipText,
          fontFamily: CHART_FONT_FAMILY,
          fontWeight: 600,
        },
      },
      dataZoom,
      xAxis: {
        type: "time",
        axisLabel: {
          color: palette.axisText,
          fontFamily: CHART_FONT_FAMILY,
          fontWeight: 600,
          formatter: (value) => formatAxisTime(value, locale),
          hideOverlap: true,
        },
        axisLine: {
          lineStyle: {
            color: palette.axisLine,
          },
        },
      },
      yAxis: series.yAxis,
      series: series.series,
    };

    chartRef.current.setOption(option, true);
  }, [legendSelection, locale, series, showSlider, themeMode, variant]);

  return (
    <div
      className={variant === "compact" ? "telemetry-chart compact" : "telemetry-chart"}
      ref={containerRef}
    />
  );
}

function legendSelectEventFrom(event: unknown): LegendSelectChangedEvent | null {
  if (!event || typeof event !== "object" || !("selected" in event)) {
    return null;
  }

  const selected = (event as { selected?: unknown }).selected;

  if (!selected || typeof selected !== "object" || Array.isArray(selected)) {
    return null;
  }

  return { selected: selected as Record<string, boolean> };
}

function buildSeries(
  samples: SampleFrame[],
  qualityEvents: QualityEvent[],
  processSegments: ProcessStateSegment[],
  visibleChannels: string[],
  themeMode: "light" | "dark",
  locale: Locale,
): {
  colors: string[];
  series: Array<LineSeriesOption | ScatterSeriesOption>;
  yAxis: YAXisComponentOption[];
} {
  const channels = sortChannels(visibleChannels);
  const palette = chartPalette(themeMode);
  const axisLayout = buildAxisLayout(channels, palette, locale);
  const colors = channels.map((channel) => channelColor(channel, themeMode));
  const suspectLabel = locale === "en" ? "suspect" : "şüpheli";
  const eventByFrameChannel = new Set(
    qualityEvents
      .filter((event) => event.event_type === "suspect_value" && event.frame_id && event.channel_code)
      .map((event) => `${event.frame_id}:${event.channel_code}`),
  );
  const result: Array<LineSeriesOption | ScatterSeriesOption> = [];

  for (const channel of channels) {
    const config = getChannelConfig(channel);
    const color = channelColor(channel, themeMode);

    if (channel === SHELF_AVERAGE_CHANNEL) {
      result.push({
        name: seriesName(channel, locale),
        type: "line",
        yAxisIndex: axisIndexFor(axisLayout, config.axis),
        showSymbol: false,
        smooth: 0.15,
        connectNulls: false,
        lineStyle: {
          color,
          width: 2.4,
          type: "dashed",
        },
        itemStyle: {
          color,
        },
        emphasis: {
          disabled: true,
        },
        data: shelfAverageLineData(samples, eventByFrameChannel) as LineSeriesOption["data"],
      });
      continue;
    }

    const channelValues = numericValuesForChannel(samples, channel).filter(
      (point) =>
        point.quality === "good" && !isShelfOffReading(channel, point.value),
    );
    const markerValue = median(channelValues.map((point) => point.value));
    const lineData: ChartDatum[] = [];
    const suspectData: ChartDatum[] = [];
    let previousTimestamp: number | null = null;

    for (const sample of samples) {
      const timestamp = sample.sampled_at;
      const timestampMs = Date.parse(timestamp);
      const measurement = sample.measurements.find(
        (item) => item.channel_code === channel,
      );
      const isGap = previousTimestamp !== null && timestampMs - previousTimestamp > 240_000;

      if (isGap && previousTimestamp !== null) {
        lineData.push({ value: [new Date(previousTimestamp + 1).toISOString(), null] });
        lineData.push({ value: [new Date(timestampMs - 1).toISOString(), null] });
      }

      previousTimestamp = Number.isFinite(timestampMs) ? timestampMs : previousTimestamp;

      if (
        !measurement ||
        measurement.numeric_value === null ||
        isShelfOffReading(channel, measurement.numeric_value)
      ) {
        lineData.push({ value: [timestamp, null] });
        continue;
      }

      const isSuspect =
        measurement.quality === "suspect" ||
        eventByFrameChannel.has(`${sample.id}:${channel}`);

      if (isSuspect) {
        lineData.push({ value: [timestamp, null] });
        suspectData.push({
          value: [timestamp, markerValue ?? measurement.numeric_value],
          rawText: measurement.raw_text,
          displayValue: `${measurement.raw_text} ${suspectLabel}`,
        });
        continue;
      }

      lineData.push({
        value: [timestamp, measurement.numeric_value],
        rawText: measurement.raw_text,
      });
    }

    result.push({
      name: seriesName(channel, locale),
      type: "line",
      yAxisIndex: axisIndexFor(axisLayout, config.axis),
      showSymbol: false,
      smooth: 0.15,
      connectNulls: false,
      lineStyle: {
        color,
      },
      itemStyle: {
        color,
      },
      emphasis: {
        disabled: true,
      },
      data: lineData as LineSeriesOption["data"],
    });

    if (suspectData.length > 0) {
      result.push({
        name: `${seriesName(channel, locale)} ${suspectLabel}`,
        type: "scatter",
        yAxisIndex: axisIndexFor(axisLayout, config.axis),
        symbol: "diamond",
        symbolSize: 10,
        data: suspectData as ScatterSeriesOption["data"],
        itemStyle: {
          color: palette.danger,
        },
        emphasis: {
          disabled: true,
        },
        tooltip: {
          valueFormatter: (_value) => suspectLabel,
        },
      });
    }
  }

  const stateAreaTarget = result.find(
    (series): series is LineSeriesOption => series.type === "line",
  );

  if (stateAreaTarget && processSegments.length > 0 && samples.length > 0) {
    const lastSampledAt = samples[samples.length - 1].sampled_at;
    stateAreaTarget.markArea = {
      silent: true,
      label: {
        show: true,
        color: palette.axisText,
        fontFamily: CHART_FONT_FAMILY,
        fontSize: 10,
        fontWeight: 700,
        position: "insideTop",
      },
      data: processSegments.map((segment) => [
        {
          name: stateDisplayName(segment.state_code, locale),
          xAxis: segment.started_at,
          itemStyle: {
            color: stateAreaColor(segment.state_code, themeMode),
          },
        },
        {
          xAxis: segment.finished_at ?? lastSampledAt,
        },
      ]),
    } as LineSeriesOption["markArea"];
  }

  return { colors, series: result, yAxis: axisLayout.yAxis };
}

function buildAxisLayout(
  channels: string[],
  palette: ChartPalette,
  locale: Locale,
): AxisLayout {
  const axisKinds = new Set<AxisKind>(
    channels.map((channel) => getChannelConfig(channel).axis),
  );
  const yAxis: YAXisComponentOption[] = [];
  const indexByKind: Partial<Record<AxisKind, number>> = {};
  const includeMainAxis = axisKinds.has("main") || axisKinds.size === 0;

  if (includeMainAxis) {
    indexByKind.main = yAxis.length;
    yAxis.push({
      type: "value",
      name: locale === "en" ? "Value" : "Değer",
      nameTextStyle: {
        color: palette.legendText,
        fontFamily: CHART_FONT_FAMILY,
        fontWeight: 700,
      },
      position: "left",
      axisLabel: {
        color: palette.axisText,
        fontFamily: CHART_FONT_FAMILY,
        fontWeight: 600,
      },
      splitLine: {
        lineStyle: {
          color: palette.splitLine,
        },
      },
    });
  }

  if (axisKinds.has("vacuum")) {
    indexByKind.vacuum = yAxis.length;
    yAxis.push({
      type: "log",
      name: locale === "en" ? "Vacuum" : "Vakum",
      nameTextStyle: {
        color: palette.legendText,
        fontFamily: CHART_FONT_FAMILY,
        fontWeight: 700,
      },
      min: 0.000_001,
      position: includeMainAxis ? "right" : "left",
      axisLabel: {
        color: palette.axisText,
        fontFamily: CHART_FONT_FAMILY,
        fontWeight: 600,
      },
      splitLine: {
        show: !includeMainAxis,
        lineStyle: {
          color: palette.splitLine,
        },
      },
    });
  }

  return { indexByKind, yAxis };
}

function chartPalette(themeMode: "light" | "dark"): ChartPalette {
  if (themeMode === "dark") {
    return {
      axisLine: "#34383c",
      axisText: "#a2a9ad",
      danger: "#d10f16",
      legendText: "#f1f4f0",
      pointer: "#f2a11b",
      sliderBorder: "#34383c",
      sliderFill: "rgba(242, 161, 27, 0.18)",
      sliderPreviewArea: "rgba(242, 161, 27, 0.08)",
      splitLine: "#25292d",
      tooltipBackground: "rgba(10, 11, 12, 0.98)",
      tooltipBorder: "#454a50",
      tooltipText: "#f1f4f0",
      zoomAccent: "#f2a11b",
    };
  }

  return {
    axisLine: "#aeb8c0",
    axisText: "#5f6971",
    danger: "#b51d22",
    legendText: "#34424c",
    pointer: "#c97913",
    sliderBorder: "#aeb8c0",
    sliderFill: "rgba(201, 121, 19, 0.16)",
    sliderPreviewArea: "rgba(201, 121, 19, 0.08)",
    splitLine: "#c9d1d7",
    tooltipBackground: "rgba(241, 243, 242, 0.98)",
    tooltipBorder: "#aeb8c0",
    tooltipText: "#101315",
    zoomAccent: "#c97913",
  };
}

function axisIndexFor(axisLayout: AxisLayout, axis: AxisKind): number {
  return axisLayout.indexByKind[axis] ?? axisLayout.indexByKind.main ?? 0;
}

function seriesName(channel: string, locale: Locale): string {
  const config = getChannelConfig(channel);
  const label = channelLabel(channel, locale);
  return config.unit ? `${label} (${config.unit})` : label;
}

function shelfAverageLineData(
  samples: SampleFrame[],
  eventByFrameChannel: Set<string>,
): ChartDatum[] {
  const lineData: ChartDatum[] = [];
  let previousTimestamp: number | null = null;

  for (const sample of samples) {
    const timestamp = sample.sampled_at;
    const timestampMs = Date.parse(timestamp);
    const isGap = previousTimestamp !== null && timestampMs - previousTimestamp > 240_000;

    if (isGap && previousTimestamp !== null) {
      lineData.push({ value: [new Date(previousTimestamp + 1).toISOString(), null] });
      lineData.push({ value: [new Date(timestampMs - 1).toISOString(), null] });
    }

    previousTimestamp = Number.isFinite(timestampMs) ? timestampMs : previousTimestamp;

    const values = SHELF_CHANNELS.flatMap((channel) => {
      const measurement = sample.measurements.find(
        (item) => item.channel_code === channel,
      );

      if (
        !measurement ||
        measurement.numeric_value === null ||
        measurement.quality !== "good" ||
        eventByFrameChannel.has(`${sample.id}:${channel}`) ||
        isShelfOffReading(channel, measurement.numeric_value)
      ) {
        return [];
      }

      return [measurement.numeric_value];
    });

    if (values.length === 0) {
      lineData.push({ value: [timestamp, null] });
      continue;
    }

    const average =
      values.reduce((total, value) => total + value, 0) / values.length;
    lineData.push({
      value: [timestamp, average],
      displayValue: average.toString(),
    });
  }

  return lineData;
}

function isShelfOffReading(channel: string, value: number): boolean {
  return SHELF_CHANNELS.includes(channel) && Math.abs(value - 850) <= 0.5;
}

function stateDisplayName(
  state: ProcessStateSegment["state_code"],
  _locale: Locale,
): string {
  return state.replace("_", " ");
}

function stateAreaColor(
  state: ProcessStateSegment["state_code"],
  themeMode: "light" | "dark",
): string {
  const alpha = themeMode === "dark" ? "24" : "18";
  const colors: Record<ProcessStateSegment["state_code"], string> = {
    START: `#3b82f6${alpha}`,
    DRY: `#16a34a${alpha}`,
    STOP: `#dc2626${alpha}`,
    WAIT: `#64748b${alpha}`,
    DEFROST: `#f59e0b${alpha}`,
    DEFROST_STOP: `#8b5cf6${alpha}`,
  };
  return colors[state];
}

function formatTooltip(
  params: TooltipComponentFormatterCallbackParams,
  locale: Locale,
): string {
  const items = (Array.isArray(params) ? params : [params])
    .map((item) => item as TooltipDatumParam)
    .map((item) => {
      const value = tooltipDisplayValue(item);

      if (!value) {
        return null;
      }

      const marker = typeof item.marker === "string" ? item.marker : "";
      const seriesName = typeof item.seriesName === "string" ? item.seriesName : "";

      return `<div class="chart-tooltip-row">${marker}<span>${escapeHtml(seriesName)}</span><strong>${escapeHtml(value)}</strong></div>`;
    })
    .filter((item): item is string => item !== null);

  if (items.length === 0) {
    return "";
  }

  return [
    `<div class="chart-tooltip-title">${escapeHtml(tooltipTitle(params, locale))}</div>`,
    ...items,
  ].join("");
}

function tooltipTitle(
  params: TooltipComponentFormatterCallbackParams,
  locale: Locale,
): string {
  const first = (Array.isArray(params) ? params[0] : params) as
    | TooltipDatumParam
    | undefined;

  if (!first) {
    return "";
  }

  const value = Array.isArray(first.value) ? first.value[0] : first.axisValue;

  if (value === undefined || value === null) {
    return "";
  }

  const timestamp = typeof value === "number" ? value : Date.parse(String(value));

  if (!Number.isFinite(timestamp)) {
    return String(value);
  }

  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "tr-TR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(timestamp));
}

function tooltipDisplayValue(item: TooltipDatumParam): string | null {
  const data = chartDatumFrom(item.data);

  if (data?.displayValue) {
    return data.displayValue;
  }

  if (data?.rawText) {
    return data.rawText;
  }

  const value = data?.value[1] ?? (Array.isArray(item.value) ? item.value[1] : item.value);

  if (value === null || value === undefined || value === "") {
    return null;
  }

  return typeof value === "number" ? value.toString() : String(value);
}

function chartDatumFrom(data: unknown): ChartDatum | null {
  if (!data || typeof data !== "object" || !("value" in data)) {
    return null;
  }

  const value = (data as { value?: unknown }).value;

  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  return data as ChartDatum;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAxisTime(value: number | string, locale: Locale): string {
  const timestamp = typeof value === "number" ? value : Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return String(value);
  }

  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function numericValuesForChannel(samples: SampleFrame[], channel: string) {
  return samples.flatMap((sample) => {
    const measurement = sample.measurements.find(
      (item) => item.channel_code === channel,
    );

    if (!measurement || measurement.numeric_value === null) {
      return [];
    }

    return [
      {
        value: measurement.numeric_value,
        quality: measurement.quality,
      },
    ];
  });
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}
