export type QualityFilter = "all" | "time_gap" | "suspect_value" | "other";
export type ChartLayout = "dashboard" | "stacked";
export type ChartTimeRange = "24h" | "7d" | "all" | "custom";
export type ChartDateRange = {
  startDate: string;
  endDate: string;
};
export type ThemeMode = "light" | "dark";
export type InspectorTab = "quality" | "analysis" | "runs" | "source";
