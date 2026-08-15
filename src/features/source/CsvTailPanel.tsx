import type { AppCopy, Locale } from "../../i18n";
import type { BrowserCsvTailState } from "../../useBrowserCsvTail";
import { formatDate } from "../../utils/format";

export function CsvTailPanel({
  copy,
  locale,
  onChoose,
  onFollowActive,
  onRescan,
  onResume,
  onStop,
  state,
}: {
  copy: AppCopy["csvTail"];
  locale: Locale;
  onChoose: () => Promise<void>;
  onFollowActive: (runId: number) => void;
  onRescan: () => Promise<void>;
  onResume: () => Promise<void>;
  onStop: () => void;
  state: BrowserCsvTailState;
}) {
  const isBusy = state.status === "scanning";
  const needsResume = state.configured && !state.enabled;

  return (
    <section className="csv-tail-panel">
      <div className="section-heading compact">
        <div>
          <h2>{copy.title}</h2>
          <p>{copy.subtitle}</p>
        </div>
        <span className={`source-status ${state.status}`}>
          {copy.statuses[state.status]}
        </span>
      </div>

      <div className="csv-tail-form">
        <div className="selected-directory">
          <span>{copy.directoryLabel}</span>
          <strong>{state.directoryName ?? copy.noDirectory}</strong>
        </div>
        <small>{copy.pathHint}</small>
        <div className="csv-tail-actions">
          {!state.configured ? (
            <button
              className="export-link"
              disabled={!state.supported || isBusy}
              onClick={() => void onChoose()}
              type="button"
            >
              {copy.chooseFolder}
            </button>
          ) : null}
          {needsResume ? (
            <button
              className="export-link"
              disabled={!state.supported || isBusy}
              onClick={() => void onResume()}
              type="button"
            >
              {copy.resume}
            </button>
          ) : null}
          {state.enabled ? (
            <button className="ghost-button" disabled={isBusy} onClick={onStop} type="button">
              {copy.stop}
            </button>
          ) : null}
          {state.enabled ? (
            <button
              className="ghost-button"
              disabled={isBusy}
              onClick={() => void onRescan()}
              type="button"
            >
              {copy.rescan}
            </button>
          ) : null}
          {state.configured ? (
            <button
              className="ghost-button"
              disabled={!state.supported || isBusy}
              onClick={() => void onChoose()}
              type="button"
            >
              {copy.changeFolder}
            </button>
          ) : null}
        </div>
      </div>

      {state.configured ? (
        <dl className="csv-tail-facts">
          <div>
            <dt>{copy.activeFile}</dt>
            <dd>{state.activeFileName ?? copy.waitingFile}</dd>
          </div>
          <div>
            <dt>{copy.lastRow}</dt>
            <dd>{state.lastSourceSequence ?? "-"}</dd>
          </div>
          <div>
            <dt>{copy.lastData}</dt>
            <dd>{state.lastSampledAt ? formatDate(state.lastSampledAt, locale) : copy.noData}</dd>
          </div>
          <div>
            <dt>{copy.lastScan}</dt>
            <dd>{state.lastScanAt ? formatDate(state.lastScanAt, locale) : "-"}</dd>
          </div>
        </dl>
      ) : null}

      {state.activeRunId ? (
        <button
          className="follow-live-button"
          onClick={() => onFollowActive(state.activeRunId!)}
          type="button"
        >
          {copy.followLive}
        </button>
      ) : null}

      {state.lastError ? (
        <p className="error-text" role="alert">
          {state.lastError}
        </p>
      ) : null}
    </section>
  );
}
