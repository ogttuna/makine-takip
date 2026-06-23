export type ChannelGroup = "shelf" | "pressure" | "vacuum" | "cooling" | "other";

export type ChannelConfig = {
  code: string;
  label: string;
  group: ChannelGroup;
  color: string;
  axis: "main" | "vacuum";
};

const channelConfigs: Record<string, ChannelConfig> = {
  RAF1: { code: "RAF1", label: "RAF1", group: "shelf", color: "#2563eb", axis: "main" },
  RAF2: { code: "RAF2", label: "RAF2", group: "shelf", color: "#16a34a", axis: "main" },
  RAF3: { code: "RAF3", label: "RAF3", group: "shelf", color: "#d97706", axis: "main" },
  RAF4: { code: "RAF4", label: "RAF4", group: "shelf", color: "#7c3aed", axis: "main" },
  L_PRES: { code: "L_PRES", label: "L Pres", group: "pressure", color: "#dc2626", axis: "main" },
  H_PRES: { code: "H_PRES", label: "H Pres", group: "pressure", color: "#ea580c", axis: "main" },
  VACUM: { code: "VACUM", label: "Vacum", group: "vacuum", color: "#0891b2", axis: "vacuum" },
  SERP2: { code: "SERP2", label: "Serp 2", group: "cooling", color: "#0f766e", axis: "main" },
  SERP4: { code: "SERP4", label: "Serp 4", group: "cooling", color: "#14b8a6", axis: "main" },
  KONDANSER: {
    code: "KONDANSER",
    label: "Kondanser",
    group: "cooling",
    color: "#64748b",
    axis: "main",
  },
};

export function getChannelConfig(code: string): ChannelConfig {
  return (
    channelConfigs[code] ?? {
      code,
      label: code,
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
