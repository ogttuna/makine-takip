import type { RunSummary } from "../../api";
import { getRunExportUrl } from "../../api";
import type { AppCopy, Locale } from "../../i18n";
import { runStatusLabel, sourceKindLabel } from "../../utils/format";

export function RunActions({
  copy,
  locale,
  run,
}: {
  copy: AppCopy["source"];
  locale: Locale;
  run: RunSummary | null;
}) {
  return (
    <div className="run-actions">
      <div className="run-badge">
        <span>{run ? runStatusLabel(run.status, locale) : copy.pending}</span>
        <strong>{run ? sourceKindLabel(run.source_kind, locale) : copy.none}</strong>
      </div>
      {run ? (
        <a className="export-link" href={getRunExportUrl(run.id)}>
          {copy.exportCsv}
        </a>
      ) : null}
    </div>
  );
}
