import type { Locale } from "./i18n";

export type ChannelGroup = "shelf" | "pressure" | "vacuum" | "cooling" | "other";

export type ChannelConfig = {
  code: string;
  label: string;
  labelEn?: string;
  unit: string | null;
  group: ChannelGroup;
  color: string;
  colorDark?: string;
  axis: "main" | "vacuum";
  derived?: boolean;
};

export const SHELF_AVERAGE_CHANNEL = "RAF_AVG";
export const SHELF_CHANNELS = ["RAF1", "RAF2", "RAF3", "RAF4"];

const channelConfigs: Record<string, ChannelConfig> = {
  RAF1: {
    code: "RAF1",
    label: "RAF1",
    unit: "°C",
    group: "shelf",
    color: "#2563eb",
    colorDark: "#60a5fa",
    axis: "main",
  },
  RAF2: {
    code: "RAF2",
    label: "RAF2",
    unit: "°C",
    group: "shelf",
    color: "#16803c",
    colorDark: "#4ade80",
    axis: "main",
  },
  RAF3: {
    code: "RAF3",
    label: "RAF3",
    unit: "°C",
    group: "shelf",
    color: "#b7791f",
    colorDark: "#f59e0b",
    axis: "main",
  },
  RAF4: {
    code: "RAF4",
    label: "RAF4",
    unit: "°C",
    group: "shelf",
    color: "#7c3aed",
    colorDark: "#a78bfa",
    axis: "main",
  },
  RAF_AVG: {
    code: SHELF_AVERAGE_CHANNEL,
    label: "Raf Avg",
    labelEn: "Shelf Avg",
    unit: "°C",
    group: "shelf",
    color: "#111827",
    colorDark: "#f8fafc",
    axis: "main",
    derived: true,
  },
  L_PRES: {
    code: "L_PRES",
    label: "L Pres",
    unit: null,
    group: "pressure",
    color: "#dc2626",
    colorDark: "#fb3b3f",
    axis: "main",
  },
  H_PRES: {
    code: "H_PRES",
    label: "H Pres",
    unit: null,
    group: "pressure",
    color: "#f97316",
    colorDark: "#fb923c",
    axis: "main",
  },
  VACUM: {
    code: "VACUM",
    label: "Vakum",
    labelEn: "Vacuum",
    unit: null,
    group: "vacuum",
    color: "#64748b",
    colorDark: "#cbd5e1",
    axis: "vacuum",
  },
  SERP2: {
    code: "SERP2",
    label: "Serp 2",
    unit: "°C",
    group: "cooling",
    color: "#0284c7",
    colorDark: "#38bdf8",
    axis: "main",
  },
  SERP4: {
    code: "SERP4",
    label: "Serp 4",
    unit: "°C",
    group: "cooling",
    color: "#0f766e",
    colorDark: "#2dd4bf",
    axis: "main",
  },
  KONDANSER: {
    code: "KONDANSER",
    label: "Kondanser",
    labelEn: "Condenser",
    unit: "°C",
    group: "cooling",
    color: "#7a5c2e",
    colorDark: "#d6a75f",
    axis: "main",
  },
};

export function getChannelConfig(code: string): ChannelConfig {
  return (
    channelConfigs[code] ?? {
      code,
      label: code,
      unit: null,
      group: "other",
      color: "#475569",
      axis: "main",
    }
  );
}

export function channelLabel(code: string, locale: Locale): string {
  const config = getChannelConfig(code);
  return locale === "en" && config.labelEn ? config.labelEn : config.label;
}

export function channelColor(code: string, themeMode: "light" | "dark"): string {
  const config = getChannelConfig(code);
  return themeMode === "dark" && config.colorDark ? config.colorDark : config.color;
}

export function sortChannels(channels: string[]): string[] {
  const order = Object.keys(channelConfigs);
  return [...channels].sort((a, b) => {
    const aIndex = order.indexOf(a);
    const bIndex = order.indexOf(b);

    if (aIndex === -1 && bIndex === -1) {
      return a.localeCompare(b);
    }

    if (aIndex === -1) {
      return 1;
    }

    if (bIndex === -1) {
      return -1;
    }

    return aIndex - bIndex;
  });
}
