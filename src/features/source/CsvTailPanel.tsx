import { useEffect, useState } from "react";

import type { CsvTailConfigPayload, CsvTailStatus } from "../../api";
import type { AppCopy, Locale } from "../../i18n";
import { formatDate } from "../../utils/format";

export function CsvTailPanel({
  copy,
  error,
  isBusy,
  isLoading,
  locale,
  onFollowActive,
  onRescan,
  onSaveAndStart,
  onStop,
  status,
}: {
  copy: AppCopy["csvTail"];
  error: Error | null;
  isBusy: boolean;
  isLoading: boolean;
  locale: Locale;
  onFollowActive: (runId: number) => void;
  onRescan: () => Promise<void>;
  onSaveAndStart: (payload: CsvTailConfigPayload) => Promise<void>;
  onStop: () => Promise<void>;
  status: CsvTailStatus | null;
}) {
  const [directoryPath, setDirectoryPath] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (!isDirty && status?.directory_path) {
      setDirectoryPath(status.directory_path);
    }
  }, [isDirty, status?.directory_path]);

  const activeFileName = status?.active_file_path
    ? status.active_file_path.split(/[\\/]/).pop()
    : null;
  const statusLabel = copy.statuses[status?.status ?? "stopped"];

  return (
    <section className="csv-tail-panel">
      <div className="section-heading compact">
        <div>
          <h2>{copy.title}</h2>
          <p>{copy.subtitle}</p>
        </div>
        <span className={`source-status ${status?.status ?? "stopped"}`}>
          {isLoading ? copy.loading : statusLabel}
        </span>
      </div>

      <form
        className="csv-tail-form"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await onSaveAndStart({
              directory_path: directoryPath,
              file_pattern: "*.csv",
              name: "Freeze dryer CSV",
              scan_interval_ms: 30_000,
            });
            setIsDirty(false);
          } catch {
            // The mutation error is rendered inline below the form.
          }
        }}
      >
        <label>
          <span>{copy.pathLabel}</span>
          <input
            disabled={isBusy}
            onChange={(event) => {
              setDirectoryPath(event.target.value);
              setIsDirty(true);
            }}
            placeholder={copy.pathPlaceholder}
            required
            type="text"
            value={directoryPath}
          />
        </label>
        <small>{copy.pathHint}</small>
        <div className="csv-tail-actions">
          <button className="export-link" disabled={isBusy} type="submit">
            {isBusy ? copy.working : copy.saveAndStart}
          </button>
          {status?.enabled ? (
            <button
              className="ghost-button"
              disabled={isBusy}
              onClick={() => void onStop().catch(() => undefined)}
              type="button"
            >
              {copy.stop}
            </button>
          ) : null}
          {status?.configured ? (
            <button
              className="ghost-button"
              disabled={isBusy}
              onClick={() => void onRescan().catch(() => undefined)}
              type="button"
            >
              {copy.rescan}
            </button>
          ) : null}
        </div>
      </form>

      {status?.configured ? (
        <dl className="csv-tail-facts">
          <div>
            <dt>{copy.activeFile}</dt>
            <dd>{activeFileName ?? copy.waitingFile}</dd>
          </div>
          <div>
            <dt>{copy.lastRow}</dt>
            <dd>{status.last_source_sequence ?? "-"}</dd>
          </div>
          <div>
            <dt>{copy.lastData}</dt>
            <dd>
              {status.last_sampled_at
                ? formatDate(status.last_sampled_at, locale)
                : copy.noData}
            </dd>
          </div>
        </dl>
      ) : null}

      {status?.active_run_id ? (
        <button
          className="follow-live-button"
          onClick={() => onFollowActive(status.active_run_id!)}
          type="button"
        >
          {copy.followLive}
        </button>
      ) : null}

      {status?.last_error || error ? (
        <p className="error-text" role="alert">
          {status?.last_error ?? error?.message}
        </p>
      ) : null}
    </section>
  );
}
