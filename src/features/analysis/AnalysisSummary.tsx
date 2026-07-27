import type { ProcessCycle, ProcessStateSegment, RunAnalysis } from "../../api";
import { InlineError } from "../../components/StatusViews";
import type { AppCopy, Locale } from "../../i18n";
import { formatDate } from "../../utils/format";

export function AnalysisSummary({
  analysis,
  copy,
  error,
  isLoading,
  locale,
  onRetry,
}: {
  analysis: RunAnalysis | null;
  copy: AppCopy["analysis"] & { retry: string };
  error: Error | null;
  isLoading: boolean;
  locale: Locale;
  onRetry: () => void;
}) {
  if (isLoading) {
    return <span className="analysis-empty">{copy.loading}</span>;
  }

  if (error) {
    return (
      <InlineError
        actionLabel={copy.retry}
        message={error.message}
        onAction={onRetry}
        title={copy.loadError}
      />
    );
  }

  if (!analysis) {
    return <span className="analysis-empty">{copy.empty}</span>;
  }

  const currentSegment = latestSegment(analysis.segments);
  const visibleCycles = [...analysis.cycles].reverse().slice(0, 5);
  const recoveryCount = analysis.events.filter(
    (event) => event.event_type === "fd750_s4_vacuum_recovery",
  ).length;
  const riseCount = analysis.events.filter(
    (event) => event.event_type === "fd750_s4_vacuum_rise",
  ).length;
  const resetCount = analysis.events.filter(
    (event) => event.event_type === "fd750_state_chain_reset",
  ).length;

  return (
    <section className="analysis-summary">
      <div className="analysis-profile">
        <div>
          <span>{copy.profile}</span>
          <strong>{analysis.profile.machine_model}</strong>
        </div>
        <small>v{analysis.profile.version}</small>
      </div>

      <div className="analysis-current">
        <span>{copy.currentState}</span>
        <strong>
          {currentSegment
            ? stateLabel(currentSegment.state_code, copy)
            : copy.noState}
        </strong>
        <small>
          {currentSegment?.loop_number
            ? copy.loop(currentSegment.loop_number)
            : copy.noLoop}
        </small>
      </div>

      <div className="analysis-event-counts">
        <AnalysisCount label={copy.recovery} value={recoveryCount} />
        <AnalysisCount label={copy.rise} value={riseCount} />
        <AnalysisCount label={copy.resets} value={resetCount} />
      </div>

      <div className="analysis-cycle-list">
        <div className="section-heading compact">
          <div>
            <h2>{copy.cycles}</h2>
            <p>{copy.cycleCount(analysis.cycles.length)}</p>
          </div>
        </div>
        {visibleCycles.length === 0 ? (
          <span className="analysis-empty">{copy.noCycles}</span>
        ) : (
          visibleCycles.map((cycle) => (
            <CycleRow copy={copy} cycle={cycle} key={cycle.id} locale={locale} />
          ))
        )}
      </div>
    </section>
  );
}

function AnalysisCount({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CycleRow({
  copy,
  cycle,
  locale,
}: {
  copy: AppCopy["analysis"];
  cycle: ProcessCycle;
  locale: Locale;
}) {
  return (
    <article className="analysis-cycle">
      <div>
        <strong>{copy.loop(cycle.loop_number)}</strong>
        <span>{formatDate(cycle.started_at, locale)}</span>
      </div>
      <div>
        <span className={`cycle-status ${cycle.status}`}>
          {copy.statuses[cycle.status]}
        </span>
        <small>{duration(cycle, copy)}</small>
      </div>
    </article>
  );
}

function latestSegment(segments: ProcessStateSegment[]): ProcessStateSegment | null {
  return segments.length > 0 ? segments[segments.length - 1] : null;
}

function stateLabel(
  state: ProcessStateSegment["state_code"],
  copy: AppCopy["analysis"],
): string {
  return copy.states[state];
}

function duration(cycle: ProcessCycle, copy: AppCopy["analysis"]): string {
  const end = cycle.finished_at ? Date.parse(cycle.finished_at) : Date.now();
  const start = Date.parse(cycle.started_at);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return copy.durationUnknown;
  }

  const hours = (end - start) / 3_600_000;
  return copy.durationHours(hours);
}
