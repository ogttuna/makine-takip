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
import type { ComposeOption, EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useMemo, useRef } from "react";

import type { QualityEvent, SampleFrame } from "./api";
import { getChannelConfig, sortChannels } from "./channelConfig";

type TelemetryChartProps = {
  samples: SampleFrame[];
  qualityEvents: QualityEvent[];
  visibleChannels: string[];
};

type TelemetryChartOption = ComposeOption<
  | DataZoomComponentOption
  | GridComponentOption
  | LegendComponentOption
  | LineSeriesOption
  | ScatterSeriesOption
  | TooltipComponentOption
>;

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
  visibleChannels,
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

    const option: TelemetryChartOption = {
      animation: false,
      color: series.colors,
      grid: {
        top: 86,
        right: 76,
        bottom: 78,
        left: 58,
      },
      legend: {
        type: "scroll",
        top: 0,
        left: 56,
        right: 56,
        height: 56,
        textStyle: {
          color: "#3f4754",
          fontFamily: "Inter, system-ui, sans-serif",
        },
      },
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) =>
          typeof value === "number" ? value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : String(value),
      },
      dataZoom: [
        {
          type: "inside",
          throttle: 80,
        },
        {
          type: "slider",
          bottom: 18,
          height: 24,
          borderColor: "#d7dde8",
          brushSelect: false,
          fillerColor: "rgba(8, 145, 178, 0.14)",
          handleSize: 16,
          moveHandleSize: 6,
          selectedDataBackground: {
            lineStyle: {
              color: "#0891b2",
            },
            areaStyle: {
              color: "rgba(8, 145, 178, 0.08)",
            },
          },
          textStyle: {
            color: "#667085",
          },
          throttle: 80,
        },
      ],
      xAxis: {
        type: "time",
        axisLabel: {
          color: "#667085",
          formatter: formatAxisTime,
          hideOverlap: true,
        },
        axisLine: {
          lineStyle: {
            color: "#cbd5e1",
          },
        },
      },
      yAxis: [
        {
          type: "value",
          name: "Value",
          axisLabel: {
            color: "#667085",
          },
          splitLine: {
            lineStyle: {
              color: "#e5e7eb",
            },
          },
        },
        {
          type: "log",
          name: "Vacum",
          min: 0.000_001,
          axisLabel: {
            color: "#667085",
          },
          splitLine: {
            show: false,
          },
        },
      ],
      series: series.series,
    };

    chartRef.current.setOption(option, true);
  }, [series]);

  return <div className="telemetry-chart" ref={containerRef} />;
}

function buildSeries(
  samples: SampleFrame[],
  qualityEvents: QualityEvent[],
  visibleChannels: string[],
): { colors: string[]; series: Array<LineSeriesOption | ScatterSeriesOption> } {
  const channels = sortChannels(visibleChannels);
  const colors = channels.map((channel) => getChannelConfig(channel).color);
  const eventByFrameChannel = new Set(
    qualityEvents
      .filter((event) => event.event_type === "suspect_value" && event.frame_id && event.channel_code)
      .map((event) => `${event.frame_id}:${event.channel_code}`),
  );
  const result: Array<LineSeriesOption | ScatterSeriesOption> = [];

  for (const channel of channels) {
    const config = getChannelConfig(channel);
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
      name: config.label,
      type: "line",
      yAxisIndex: config.axis === "vacuum" ? 1 : 0,
      showSymbol: false,
      smooth: 0.15,
      connectNulls: false,
      emphasis: {
        focus: "series",
      },
      data: lineData,
    });

    if (suspectData.length > 0) {
      result.push({
        name: `${config.label} suspect`,
        type: "scatter",
        yAxisIndex: config.axis === "vacuum" ? 1 : 0,
        symbol: "diamond",
        symbolSize: 10,
        data: suspectData,
        emphasis: {
          focus: "series",
        },
        tooltip: {
          valueFormatter: (_value) => "suspect",
        },
      });
      colors.push("#b91c1c");
    }
  }

  return { colors, series: result };
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
