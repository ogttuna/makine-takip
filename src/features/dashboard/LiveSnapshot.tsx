import type { SampleFrame } from "../../api";
import { chronologicalSamples } from "../../chartTimeline";
import type { AppCopy, Locale } from "../../i18n";
import { formatDate } from "../../utils/format";

const SHELF_CHANNELS = ["RAF1", "RAF2", "RAF3", "RAF4"];
const SENSOR_CHANNELS = ["S1", "S2", "S3", "S4"];

export function LiveSnapshot({
  copy,
  locale,
  samples,
}: {
  copy: AppCopy["snapshot"];
  locale: Locale;
  samples: SampleFrame[];
}) {
  const ordered = chronologicalSamples(samples);
  const latest = ordered[ordered.length - 1];
  const readings = [
    {
      key: "shelf",
      label: copy.shelf,
      unit: "°C",
      value: averageMeasurement(latest, SHELF_CHANNELS, true),
    },
    {
      key: "sensor",
      label: copy.sensor,
      unit: "°C",
      value: averageMeasurement(latest, SENSOR_CHANNELS),
    },
    {
      key: "condenser",
      label: copy.condenser,
      unit: "°C",
      value: numericMeasurement(latest, "KONDANSER"),
    },
    {
      key: "vacuum",
      label: copy.vacuum,
      unit: "mbar",
      value: numericMeasurement(latest, "VACUM"),
    },
    {
      key: "weight",
      label: copy.weight,
      unit: "kg",
      value: numericMeasurement(latest, "TARTIM"),
    },
    {
      key: "power",
      label: copy.power,
      unit: "kW",
      value: numericMeasurement(latest, "E.GUC"),
    },
    {
      key: "energy",
      label: copy.energy,
      unit: "kWh",
      value: numericMeasurement(latest, "E.TUKETIM"),
    },
  ];

  return (
    <section className="process-instruments" aria-label={copy.title}>
      <div className="instrument-heading">
        <span>{copy.title}</span>
        <time>
          {latest ? `${copy.lastSample} · ${formatDate(latest.sampled_at, locale)}` : copy.noData}
        </time>
      </div>
      <div className="instrument-grid">
        {readings.map((reading) => (
          <div className={`instrument instrument-${reading.key}`} key={reading.key}>
            <span>{reading.label}</span>
            <strong>{formatReading(reading.value, locale, copy.noData)}</strong>
            <small>{reading.value === null ? "" : reading.unit}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function averageMeasurement(
  sample: SampleFrame | undefined,
  channels: string[],
  ignoreShelfOff = false,
): number | null {
  const values = channels.flatMap((channel) => {
    const value = numericMeasurement(sample, channel);
    if (value === null || (ignoreShelfOff && Math.abs(value - 850) <= 0.5)) {
      return [];
    }
    return [value];
  });

  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function numericMeasurement(
  sample: SampleFrame | undefined,
  channelCode: string,
): number | null {
  const measurement = sample?.measurements.find(
    (candidate) => candidate.channel_code === channelCode,
  );
  return measurement?.quality === "good" ? measurement.numeric_value : null;
}

function formatReading(value: number | null, locale: Locale, fallback: string): string {
  if (value === null) {
    return fallback;
  }

  const absolute = Math.abs(value);
  if (absolute > 0 && absolute < 0.001) {
    return value.toExponential(2);
  }

  return new Intl.NumberFormat(locale === "en" ? "en-US" : "tr-TR", {
    maximumFractionDigits:
      absolute > 0 && absolute < 0.01 ? 5 : absolute < 1 ? 3 : absolute >= 100 ? 1 : 2,
  }).format(value);
}
