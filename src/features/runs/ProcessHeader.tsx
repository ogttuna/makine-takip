import type { QualityEvent, RunSummary, SampleFrame } from "../../api";
import type { AppCopy, Locale } from "../../i18n";
import { durationLabel, formatDate, sourceKindLabel } from "../../utils/format";

export function ProcessHeader({
  activeChannelCount,
  copy,
  locale,
  qualityEvents,
  run,
  samples,
}: {
  activeChannelCount: number;
  copy: AppCopy["process"];
  locale: Locale;
  qualityEvents: QualityEvent[];
  run: RunSummary | null;
  samples: SampleFrame[];
}) {
  const quality = qualityCounts(qualityEvents);
  const firstSample = samples[0]?.sampled_at ?? run?.started_at ?? null;
  const lastSample = samples[samples.length - 1]?.sampled_at ?? run?.finished_at ?? null;

  return (
    <section className="process-header" aria-label={copy.ariaLabel}>
      <div className="process-title">
        <span>{copy.selectedRun}</span>
        <h2>{run?.name ?? copy.noRun}</h2>
      </div>
      <div className="process-facts">
        <ProcessFact label={copy.duration} value={durationLabel(run, locale)} />
        <ProcessFact
          label={copy.range}
          value={
            firstSample && lastSample
              ? `${formatDate(firstSample, locale)} - ${formatDate(lastSample, locale)}`
              : "-"
          }
        />
        <ProcessFact
          label={copy.quality}
          tone={quality.total > 0 ? "warning" : "ok"}
          value={
            quality.total > 0
              ? copy.qualityValue(quality.timeGap, quality.suspect)
              : copy.noWarning
          }
        />
        <ProcessFact
          label={copy.view}
          value={copy.activeSignals(activeChannelCount)}
        />
        <ProcessFact
          label={copy.source}
          value={run ? sourceKindLabel(run.source_kind, locale) : "-"}
        />
      </div>
    </section>
  );
}

function ProcessFact({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: "ok" | "warning";
  value: string;
}) {
  return (
    <div className={tone ? `process-fact ${tone}` : "process-fact"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function qualityCounts(events: QualityEvent[]) {
  return events.reduce(
    (acc, event) => {
      acc.total += 1;

      if (event.event_type === "time_gap") {
        acc.timeGap += 1;
      }

      if (event.event_type === "suspect_value") {
        acc.suspect += 1;
      }

      return acc;
    },
    { suspect: 0, timeGap: 0, total: 0 },
  );
}
