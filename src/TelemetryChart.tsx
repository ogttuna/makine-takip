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
import type { YAXisComponentOption } from "echarts";
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
  visibleChannels,
  variant = "large",
}: TelemetryChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const series = useMemo(
    () => buildSeries(samples, qualityEvents, visibleChannels),
    [qualityEvents, samples, visibleChannels],
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
        borderColor: "#c7d0db",
        brushSelect: false,
        fillerColor: "rgba(0, 125, 121, 0.14)",
        handleSize: compact ? 12 : 16,
        moveHandleSize: 6,
        selectedDataBackground: {
          lineStyle: {
            color: "#007d79",
          },
          areaStyle: {
            color: "rgba(0, 125, 121, 0.08)",
          },
        },
        textStyle: {
          color: "#607089",
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
          color: "#334155",
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
            color: "#8b9aad",
            type: "dashed",
            width: 1,
          },
        },
        valueFormatter: (value) =>
          typeof value === "number" ? value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : String(value),
      },
      dataZoom,
      xAxis: {
        type: "time",
        axisLabel: {
          color: "#607089",
          formatter: formatAxisTime,
          hideOverlap: true,
        },
        axisLine: {
          lineStyle: {
            color: "#c7d0db",
          },
        },
      },
      yAxis: series.yAxis,
      series: series.series,
    };

    chartRef.current.setOption(option, true);
  }, [series, showSlider, variant]);

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
): {
  colors: string[];
  series: Array<LineSeriesOption | ScatterSeriesOption>;
  yAxis: YAXisComponentOption[];
} {
  const channels = sortChannels(visibleChannels);
  const axisLayout = buildAxisLayout(channels);
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
        data: shelfAverageLineData(samples, eventByFrameChannel),
      });
      continue;
    }

    const channelValues = numericValuesForChannel(samples, channel).filter(
      (point) => point.quality === "good",
    );
    const markerValue = median(channelValues.map((point) => point.value));
    const lineData: Array<[string, number | null]> = [];
    const suspectData: Array<[string, number, string]> = [];
    let previousTimestamp: number | null = null;

    for (const sample of samples) {
      const timestamp = sample.sampled_at;
      const timestampMs = Date.parse(timestamp);
      const measurement = sample.measurements.find(
        (item) => item.channel_code === channel,
      );
      const isGap = previousTimestamp !== null && timestampMs - previousTimestamp > 240_000;

      if (isGap && previousTimestamp !== null) {
        lineData.push([new Date(previousTimestamp + 1).toISOString(), null]);
        lineData.push([new Date(timestampMs - 1).toISOString(), null]);
      }

      previousTimestamp = Number.isFinite(timestampMs) ? timestampMs : previousTimestamp;

      if (!measurement || measurement.numeric_value === null) {
        lineData.push([timestamp, null]);
        continue;
      }

      const isSuspect =
        measurement.quality === "suspect" ||
        eventByFrameChannel.has(`${sample.id}:${channel}`);

      if (isSuspect) {
        lineData.push([timestamp, null]);
        suspectData.push([
          timestamp,
          markerValue ?? measurement.numeric_value,
          `${channel}: ${measurement.raw_text}`,
        ]);
        continue;
      }

      lineData.push([timestamp, measurement.numeric_value]);
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
      data: lineData,
    });

    if (suspectData.length > 0) {
      result.push({
        name: `${seriesName(config)} suspect`,
        type: "scatter",
        yAxisIndex: axisIndexFor(axisLayout, config.axis),
        symbol: "diamond",
        symbolSize: 10,
        data: suspectData,
        itemStyle: {
          color: "#b91c1c",
        },
        emphasis: {
          disabled: true,
        },
        tooltip: {
          valueFormatter: (_value) => "suspect",
        },
      });
    }
  }

  return { colors, series: result, yAxis: axisLayout.yAxis };
}

function buildAxisLayout(channels: string[]): AxisLayout {
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
      name: "Value",
      position: "left",
      axisLabel: {
        color: "#607089",
      },
      splitLine: {
        lineStyle: {
          color: "#dde4ec",
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
        color: "#607089",
      },
      splitLine: {
        show: !includeMainAxis,
        lineStyle: {
          color: "#dde4ec",
        },
      },
    });
  }

  return { indexByKind, yAxis };
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
): Array<[string, number | null]> {
  const lineData: Array<[string, number | null]> = [];
  let previousTimestamp: number | null = null;

  for (const sample of samples) {
    const timestamp = sample.sampled_at;
    const timestampMs = Date.parse(timestamp);
    const isGap = previousTimestamp !== null && timestampMs - previousTimestamp > 240_000;

    if (isGap && previousTimestamp !== null) {
      lineData.push([new Date(previousTimestamp + 1).toISOString(), null]);
      lineData.push([new Date(timestampMs - 1).toISOString(), null]);
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
      lineData.push([timestamp, null]);
      continue;
    }

    const average =
      values.reduce((total, value) => total + value, 0) / values.length;
    lineData.push([timestamp, average]);
  }

  return lineData;
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
