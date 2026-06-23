import { LineChart, ScatterChart, type LineSeriesOption, type ScatterSeriesOption } from "echarts/charts";
import {
  DataZoomComponent,
  type DataZoomComponentOption,
  GridComponent,
  type GridComponentOption,
  LegendComponent,
  type LegendComponentOption,
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
import { useEffect, useMemo, useRef } from "react";

import type { QualityEvent, SampleFrame } from "./api";
import {
  getChannelConfig,
  SHELF_AVERAGE_CHANNEL,
  SHELF_CHANNELS,
  sortChannels,
} from "./channelConfig";

type TelemetryChartProps = {
  samples: SampleFrame[];
  qualityEvents: QualityEvent[];
  visibleChannels: string[];
  variant?: "large" | "compact";
  showSlider?: boolean;
  themeMode?: "light" | "dark";
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

echarts.use([
  CanvasRenderer,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  LineChart,
  ScatterChart,
  TooltipComponent,
]);

export function TelemetryChart({
  samples,
  qualityEvents,
  showSlider = true,
  themeMode = "light",
  visibleChannels,
  variant = "large",
}: TelemetryChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const series = useMemo(
    () => buildSeries(samples, qualityEvents, visibleChannels, themeMode),
    [qualityEvents, samples, themeMode, visibleChannels],
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
        textStyle: {
          color: palette.legendText,
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: compact ? 11 : 12,
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
        formatter: formatTooltip,
        textStyle: {
          color: palette.tooltipText,
        },
      },
      dataZoom,
      xAxis: {
        type: "time",
        axisLabel: {
          color: palette.axisText,
          formatter: formatAxisTime,
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
  }, [series, showSlider, themeMode, variant]);

  return (
    <div
      className={variant === "compact" ? "telemetry-chart compact" : "telemetry-chart"}
      ref={containerRef}
    />
  );
}

function buildSeries(
  samples: SampleFrame[],
  qualityEvents: QualityEvent[],
  visibleChannels: string[],
  themeMode: "light" | "dark",
): {
  colors: string[];
  series: Array<LineSeriesOption | ScatterSeriesOption>;
  yAxis: YAXisComponentOption[];
} {
  const channels = sortChannels(visibleChannels);
  const palette = chartPalette(themeMode);
  const axisLayout = buildAxisLayout(channels, palette);
  const colors = channels.map((channel) => getChannelConfig(channel).color);
  const eventByFrameChannel = new Set(
    qualityEvents
      .filter((event) => event.event_type === "suspect_value" && event.frame_id && event.channel_code)
      .map((event) => `${event.frame_id}:${event.channel_code}`),
  );
  const result: Array<LineSeriesOption | ScatterSeriesOption> = [];

  for (const channel of channels) {
    const config = getChannelConfig(channel);

    if (channel === SHELF_AVERAGE_CHANNEL) {
      result.push({
        name: seriesName(config),
        type: "line",
        yAxisIndex: axisIndexFor(axisLayout, config.axis),
        showSymbol: false,
        smooth: 0.15,
        connectNulls: false,
        lineStyle: {
          color: config.color,
          width: 2.4,
          type: "dashed",
        },
        itemStyle: {
          color: config.color,
        },
        emphasis: {
          disabled: true,
        },
        data: shelfAverageLineData(samples, eventByFrameChannel) as LineSeriesOption["data"],
      });
      continue;
    }

    const channelValues = numericValuesForChannel(samples, channel).filter(
      (point) => point.quality === "good",
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

      if (!measurement || measurement.numeric_value === null) {
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
          displayValue: `${measurement.raw_text} şüpheli`,
        });
        continue;
      }

      lineData.push({
        value: [timestamp, measurement.numeric_value],
        rawText: measurement.raw_text,
      });
    }

    result.push({
      name: seriesName(config),
      type: "line",
      yAxisIndex: axisIndexFor(axisLayout, config.axis),
      showSymbol: false,
      smooth: 0.15,
      connectNulls: false,
      lineStyle: {
        color: config.color,
      },
      itemStyle: {
        color: config.color,
      },
      emphasis: {
        disabled: true,
      },
      data: lineData as LineSeriesOption["data"],
    });

    if (suspectData.length > 0) {
      result.push({
        name: `${seriesName(config)} şüpheli`,
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
          valueFormatter: (_value) => "şüpheli",
        },
      });
    }
  }

  return { colors, series: result, yAxis: axisLayout.yAxis };
}

function buildAxisLayout(channels: string[], palette: ChartPalette): AxisLayout {
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
      name: "Değer",
      position: "left",
      axisLabel: {
        color: palette.axisText,
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
      name: "Vacum",
      min: 0.000_001,
      position: includeMainAxis ? "right" : "left",
      axisLabel: {
        color: palette.axisText,
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
      axisLine: "#30433c",
      axisText: "#92a69d",
      danger: "#fb7185",
      legendText: "#d7e4de",
      pointer: "#8aa199",
      sliderBorder: "#30433c",
      sliderFill: "rgba(45, 212, 191, 0.18)",
      sliderPreviewArea: "rgba(45, 212, 191, 0.1)",
      splitLine: "#1f302b",
      tooltipBackground: "rgba(10, 17, 16, 0.96)",
      tooltipBorder: "#30433c",
      tooltipText: "#d7e4de",
      zoomAccent: "#2dd4bf",
    };
  }

  return {
    axisLine: "#c7d0db",
    axisText: "#607089",
    danger: "#b91c1c",
    legendText: "#334155",
    pointer: "#8b9aad",
    sliderBorder: "#c7d0db",
    sliderFill: "rgba(0, 125, 121, 0.14)",
    sliderPreviewArea: "rgba(0, 125, 121, 0.08)",
    splitLine: "#dde4ec",
    tooltipBackground: "rgba(255, 255, 255, 0.96)",
    tooltipBorder: "#c7d0db",
    tooltipText: "#334155",
    zoomAccent: "#007d79",
  };
}

function axisIndexFor(axisLayout: AxisLayout, axis: AxisKind): number {
  return axisLayout.indexByKind[axis] ?? axisLayout.indexByKind.main ?? 0;
}

function seriesName(config: ReturnType<typeof getChannelConfig>): string {
  return config.unit ? `${config.label} (${config.unit})` : config.label;
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
        eventByFrameChannel.has(`${sample.id}:${channel}`)
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

function formatTooltip(params: TooltipComponentFormatterCallbackParams): string {
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
    `<div class="chart-tooltip-title">${escapeHtml(tooltipTitle(params))}</div>`,
    ...items,
  ].join("");
}

function tooltipTitle(params: TooltipComponentFormatterCallbackParams): string {
  const first = (Array.isArray(params) ? params[0] : params) as
    | TooltipDatumParam
    | undefined;

  if (!first) {
    return "";
  }

  const value = Array.isArray(first.value) ? first.value[0] : first.axisValue;
  return value === undefined || value === null ? "" : String(value);
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

function formatAxisTime(value: number | string): string {
  const timestamp = typeof value === "number" ? value : Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return String(value);
  }

  return new Intl.DateTimeFormat("tr-TR", {
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
