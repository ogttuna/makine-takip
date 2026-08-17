import type { RunSummary } from "../../api";
import { InlineError } from "../../components/StatusViews";
import type { AppCopy, Locale } from "../../i18n";
import { formatDate } from "../../utils/format";

export function RunList({
  copy,
  error,
  isLoading,
  locale,
  onSelect,
  onRetry,
  runs,
  selectedRunId,
}: {
  copy: AppCopy["runs"] & { retry: string };
  error: Error | null;
  isLoading: boolean;
  locale: Locale;
  onSelect: (runId: number) => void;
  onRetry: () => void;
  runs: RunSummary[];
  selectedRunId: number | null;
}) {
  if (isLoading) {
    return <p className="empty-state">{copy.loading}</p>;
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

  if (runs.length === 0) {
    return <p className="empty-state">{copy.empty}</p>;
  }

  return (
    <div className="run-list">
      {runs.map((run) => (
        <button
          className={run.id === selectedRunId ? "run-row selected" : "run-row"}
          key={run.id}
          onClick={() => onSelect(run.id)}
          type="button"
        >
          <div>
            <strong>{run.name}</strong>
            <span>{copy.rowSummary(run.row_count, run.warning_count, run.error_count)}</span>
          </div>
          <time>{run.started_at ? formatDate(run.started_at, locale) : "-"}</time>
        </button>
      ))}
    </div>
  );
}
