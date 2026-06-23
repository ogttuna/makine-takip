import { LineChart, type LineSeriesOption } from "echarts/charts";
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
import { useEffect, useRef } from "react";

import type { TelemetrySample } from "./api";

type TelemetryChartProps = {
  samples: TelemetrySample[];
};

type TelemetryChartOption = ComposeOption<
  | DataZoomComponentOption
  | GridComponentOption
  | LegendComponentOption
  | LineSeriesOption
  | TooltipComponentOption
>;

echarts.use([
  CanvasRenderer,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  LineChart,
  TooltipComponent,
]);

export function TelemetryChart({ samples }: TelemetryChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

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
      color: ["#2563eb", "#16a34a", "#0891b2", "#d97706"],
      grid: {
        top: 36,
        right: 64,
        bottom: 44,
        left: 56,
      },
      legend: {
        top: 0,
        textStyle: {
          color: "#3f4754",
          fontFamily: "Inter, system-ui, sans-serif",
        },
      },
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) =>
          typeof value === "number" ? value.toFixed(2) : String(value),
      },
      dataZoom: [
        {
          type: "inside",
          throttle: 80,
        },
      ],
      xAxis: {
        type: "time",
        axisLabel: {
          color: "#667085",
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
          name: "Temperature C",
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
          name: "Pressure mbar",
          min: 0.01,
          axisLabel: {
            color: "#667085",
          },
          splitLine: {
            show: false,
          },
        },
      ],
      series: [
        {
          name: "Shelf",
          type: "line",
          showSymbol: false,
          smooth: 0.25,
          data: samples.map((sample) => [sample.timestamp, sample.shelf_temp_c]),
        },
        {
          name: "Product",
          type: "line",
          showSymbol: false,
          smooth: 0.25,
          data: samples.map((sample) => [
            sample.timestamp,
            sample.product_temp_c,
          ]),
        },
        {
          name: "Condenser",
          type: "line",
          showSymbol: false,
          smooth: 0.2,
          data: samples.map((sample) => [
            sample.timestamp,
            sample.condenser_temp_c,
          ]),
        },
        {
          name: "Pressure",
          type: "line",
          yAxisIndex: 1,
          showSymbol: false,
          smooth: 0.2,
          data: samples.map((sample) => [
            sample.timestamp,
            sample.chamber_pressure_mbar,
          ]),
        },
      ],
    };

    chartRef.current.setOption(option, true);
  }, [samples]);

  return <div className="telemetry-chart" ref={containerRef} />;
}
