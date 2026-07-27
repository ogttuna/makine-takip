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
    label: "RAF1 hedef",
    labelEn: "Shelf 1 target",
    unit: "°C",
    group: "shelf",
    color: "#2563eb",
    colorDark: "#60a5fa",
    axis: "main",
  },
  RAF2: {
    code: "RAF2",
    label: "RAF2 hedef",
    labelEn: "Shelf 2 target",
    unit: "°C",
    group: "shelf",
    color: "#16803c",
    colorDark: "#4ade80",
    axis: "main",
  },
  RAF3: {
    code: "RAF3",
    label: "RAF3 hedef",
    labelEn: "Shelf 3 target",
    unit: "°C",
    group: "shelf",
    color: "#b7791f",
    colorDark: "#f59e0b",
    axis: "main",
  },
  RAF4: {
    code: "RAF4",
    label: "RAF4 hedef",
    labelEn: "Shelf 4 target",
    unit: "°C",
    group: "shelf",
    color: "#7c3aed",
    colorDark: "#a78bfa",
    axis: "main",
  },
  RAF_AVG: {
    code: SHELF_AVERAGE_CHANNEL,
    label: "Aktif raf hedef ort.",
    labelEn: "Active shelf target avg.",
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
  S1: {
    code: "S1",
    label: "S1 sol üst",
    labelEn: "S1 upper left",
    unit: "°C",
    group: "cooling",
    color: "#0369a1",
    colorDark: "#38bdf8",
    axis: "main",
  },
  S2: {
    code: "S2",
    label: "S2 sol alt",
    labelEn: "S2 lower left",
    unit: "°C",
    group: "cooling",
    color: "#0f766e",
    colorDark: "#2dd4bf",
    axis: "main",
  },
  S3: {
    code: "S3",
    label: "S3 sağ üst",
    labelEn: "S3 upper right",
    unit: "°C",
    group: "cooling",
    color: "#7c3aed",
    colorDark: "#a78bfa",
    axis: "main",
  },
  S4: {
    code: "S4",
    label: "S4 sağ alt",
    labelEn: "S4 lower right",
    unit: "°C",
    group: "cooling",
    color: "#b45309",
    colorDark: "#f59e0b",
    axis: "main",
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
  TARTIM: {
    code: "TARTIM",
    label: "Tartım",
    labelEn: "Weight",
    unit: "kg",
    group: "other",
    color: "#475569",
    colorDark: "#cbd5e1",
    axis: "main",
  },
  "E.GUC": {
    code: "E.GUC",
    label: "Enerji gücü",
    labelEn: "Power",
    unit: null,
    group: "other",
    color: "#be123c",
    colorDark: "#fb7185",
    axis: "main",
  },
  "E.TUKETIM": {
    code: "E.TUKETIM",
    label: "Enerji tüketimi",
    labelEn: "Energy consumption",
    unit: null,
    group: "other",
    color: "#a16207",
    colorDark: "#facc15",
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
