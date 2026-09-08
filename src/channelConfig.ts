import type { Locale } from "./i18n";

export type ChannelGroup =
  | "shelf_temperature"
  | "cooling_temperature"
  | "pressure"
  | "vacuum"
  | "mass"
  | "power"
  | "energy"
  | "other";

export type ChannelAxis =
  | "temperature"
  | "pressure"
  | "vacuum"
  | "mass"
  | "power"
  | "energy"
  | "generic";

export type ChannelConfig = {
  code: string;
  label: string;
  labelEn?: string;
  unit: string | null;
  group: ChannelGroup;
  color: string;
  colorDark?: string;
  axis: ChannelAxis;
  scale?: "linear" | "log";
  derived?: boolean;
};

export const SHELF_AVERAGE_CHANNEL = "RAF_AVG";
export const SHELF_CHANNELS = ["RAF1", "RAF2", "RAF3", "RAF4"];

export const CHANNEL_GROUP_ORDER: ChannelGroup[] = [
  "shelf_temperature",
  "cooling_temperature",
  "pressure",
  "vacuum",
  "mass",
  "power",
  "energy",
  "other",
];

const channelConfigs: Record<string, ChannelConfig> = {
  RAF1: temperatureChannel("RAF1", "Raf 1 hedef", "Shelf 1 target", "#b64924", "#f08a5d", "shelf_temperature"),
  RAF2: temperatureChannel("RAF2", "Raf 2 hedef", "Shelf 2 target", "#1f6f5f", "#69c2aa", "shelf_temperature"),
  RAF3: temperatureChannel("RAF3", "Raf 3 hedef", "Shelf 3 target", "#315b8a", "#79a8d8", "shelf_temperature"),
  RAF4: temperatureChannel("RAF4", "Raf 4 hedef", "Shelf 4 target", "#8b5a2b", "#d0a06b", "shelf_temperature"),
  RAF_AVG: {
    ...temperatureChannel(
      SHELF_AVERAGE_CHANNEL,
      "Aktif raf ortalaması",
      "Active shelf average",
      "#202624",
      "#f2eee6",
      "shelf_temperature",
    ),
    derived: true,
  },
  S1: temperatureChannel("S1", "Serpantin sensörü S1", "Coil sensor S1", "#be3b3b", "#ff8585", "cooling_temperature"),
  S2: temperatureChannel("S2", "Serpantin sensörü S2", "Coil sensor S2", "#cc7722", "#f2a65a", "cooling_temperature"),
  S3: temperatureChannel("S3", "Serpantin sensörü S3", "Coil sensor S3", "#6a4c93", "#b99ad9", "cooling_temperature"),
  S4: temperatureChannel("S4", "Serpantin sensörü S4", "Coil sensor S4", "#2f6f8f", "#76b7d5", "cooling_temperature"),
  SERP2: temperatureChannel("SERP2", "Serpantin 2", "Coil 2", "#197278", "#66c7c9", "cooling_temperature"),
  SERP4: temperatureChannel("SERP4", "Serpantin 4", "Coil 4", "#305f72", "#7eb5c8", "cooling_temperature"),
  KONDANSER: temperatureChannel("KONDANSER", "Kondenser", "Condenser", "#725f3f", "#c9ac77", "cooling_temperature"),
  L_PRES: {
    code: "L_PRES",
    label: "Düşük basınç",
    labelEn: "Low pressure",
    unit: "bar",
    group: "pressure",
    color: "#356b88",
    colorDark: "#79b7d5",
    axis: "pressure",
  },
  H_PRES: {
    code: "H_PRES",
    label: "Yüksek basınç",
    labelEn: "High pressure",
    unit: "bar",
    group: "pressure",
    color: "#b64924",
    colorDark: "#f08a5d",
    axis: "pressure",
  },
  VACUM: {
    code: "VACUM",
    label: "Hazne vakumu",
    labelEn: "Chamber vacuum",
    unit: "mbar",
    group: "vacuum",
    color: "#3f4f4a",
    colorDark: "#b7c6c0",
    axis: "vacuum",
    scale: "log",
  },
  TARTIM: {
    code: "TARTIM",
    label: "Ürün ağırlığı",
    labelEn: "Product weight",
    unit: "kg",
    group: "mass",
    color: "#5b4a79",
    colorDark: "#b8a3dc",
    axis: "mass",
  },
  "E.GUC": {
    code: "E.GUC",
    label: "Anlık güç",
    labelEn: "Instant power",
    unit: "kW",
    group: "power",
    color: "#b85c00",
    colorDark: "#f0a04b",
    axis: "power",
  },
  "E.TUKETIM": {
    code: "E.TUKETIM",
    label: "Toplam enerji",
    labelEn: "Total energy",
    unit: "kWh",
    group: "energy",
    color: "#8a6d1d",
    colorDark: "#d8bd61",
    axis: "energy",
  },
};

export function getChannelConfig(code: string): ChannelConfig {
  return (
    channelConfigs[code] ?? {
      code,
      label: code,
      unit: null,
      group: "other",
      color: "#59645f",
      colorDark: "#b7c0bc",
      axis: "generic",
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

function temperatureChannel(
  code: string,
  label: string,
  labelEn: string,
  color: string,
  colorDark: string,
  group: Extract<ChannelGroup, "shelf_temperature" | "cooling_temperature">,
): ChannelConfig {
  return {
    code,
    label,
    labelEn,
    unit: "°C",
    group,
    color,
    colorDark,
    axis: "temperature",
  };
}
