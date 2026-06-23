export type ChannelGroup = "shelf" | "pressure" | "vacuum" | "cooling" | "other";

export type ChannelConfig = {
  code: string;
  label: string;
  unit: string | null;
  group: ChannelGroup;
  color: string;
  axis: "main" | "vacuum";
  derived?: boolean;
};

export const SHELF_AVERAGE_CHANNEL = "RAF_AVG";
export const SHELF_CHANNELS = ["RAF1", "RAF2", "RAF3", "RAF4"];

const channelConfigs: Record<string, ChannelConfig> = {
  RAF1: { code: "RAF1", label: "RAF1", unit: "degC", group: "shelf", color: "#0f62fe", axis: "main" },
  RAF2: { code: "RAF2", label: "RAF2", unit: "degC", group: "shelf", color: "#198038", axis: "main" },
  RAF3: { code: "RAF3", label: "RAF3", unit: "degC", group: "shelf", color: "#b28600", axis: "main" },
  RAF4: { code: "RAF4", label: "RAF4", unit: "degC", group: "shelf", color: "#8a3ffc", axis: "main" },
  RAF_AVG: {
    code: SHELF_AVERAGE_CHANNEL,
    label: "Raf Avg",
    unit: "degC",
    group: "shelf",
    color: "#111827",
    axis: "main",
    derived: true,
  },
  L_PRES: { code: "L_PRES", label: "L Pres", unit: null, group: "pressure", color: "#da1e28", axis: "main" },
  H_PRES: { code: "H_PRES", label: "H Pres", unit: null, group: "pressure", color: "#fa4d56", axis: "main" },
  VACUM: { code: "VACUM", label: "Vacum", unit: null, group: "vacuum", color: "#007d79", axis: "vacuum" },
  SERP2: { code: "SERP2", label: "Serp 2", unit: "degC", group: "cooling", color: "#1192e8", axis: "main" },
  SERP4: { code: "SERP4", label: "Serp 4", unit: "degC", group: "cooling", color: "#005d5d", axis: "main" },
  KONDANSER: {
    code: "KONDANSER",
    label: "Kondanser",
    unit: "degC",
    group: "cooling",
    color: "#6f6f6f",
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
