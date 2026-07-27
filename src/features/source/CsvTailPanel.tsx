import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CsvTailConfigPayload, CsvTailStatus } from "../../api";
import type { AppCopy, Locale } from "../../i18n";
import { formatDate } from "../../utils/format";
import {
  physicalPointIsInsideBounds,
  singleDroppedPath,
} from "./folderDrop";

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
  const [isFolderDragActive, setIsFolderDragActive] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [dropNotice, setDropNotice] = useState<string | null>(null);
  const dropZoneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isDirty && status?.directory_path) {
      setDirectoryPath(status.directory_path);
    }
  }, [isDirty, status?.directory_path]);

  const activeFileName = status?.active_file_path
    ? status.active_file_path.split(/[\\/]/).pop()
    : null;
  const statusLabel = copy.statuses[status?.status ?? "stopped"];
  const startDroppedFolder = useCallback(
    async (paths: string[]) => {
      if (isBusy) {
        return;
      }

      const path = singleDroppedPath(paths);

      if (!path) {
        setDropNotice(null);
        setDropError(copy.dropSingleFolder);
        return;
      }

      setDirectoryPath(path);
      setIsDirty(true);
      setDropError(null);
      setDropNotice(copy.dropStarting);

      try {
        await onSaveAndStart({
          directory_path: path,
          file_pattern: "*.csv",
          name: "Freeze dryer CSV",
          scan_interval_ms: 30_000,
        });
        setIsDirty(false);
        setDropNotice(copy.dropStarted);
      } catch {
        setDropNotice(null);
      }
    },
    [
      copy.dropSingleFolder,
      copy.dropStarted,
      copy.dropStarting,
      isBusy,
      onSaveAndStart,
    ],
  );

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setIsFolderDragActive(
            pointIsInsideDropZone(event.payload.position, dropZoneRef.current),
          );
          return;
        }

        setIsFolderDragActive(false);

        if (
          event.payload.type === "drop" &&
          pointIsInsideDropZone(event.payload.position, dropZoneRef.current)
        ) {
          void startDroppedFolder(event.payload.paths);
        }
      })
      .then((stopListening) => {
        if (disposed) {
          stopListening();
        } else {
          unlisten = stopListening;
        }
      })
      .catch(() => {
        setDropError(copy.dropUnavailable);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [copy.dropUnavailable, startDroppedFolder]);

  const handleBrowserDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsFolderDragActive(false);

    if (isTauri()) {
      return;
    }

    const droppedFile = event.dataTransfer.files[0] as
      | (File & { path?: string })
      | undefined;

    if (droppedFile?.path) {
      void startDroppedFolder([droppedFile.path]);
      return;
    }

    setDropNotice(null);
    setDropError(copy.dropBrowserLimitation);
  };

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
        <div
          className={
            isFolderDragActive
              ? "csv-folder-drop active"
              : "csv-folder-drop"
          }
          onDragEnter={(event) => {
            event.preventDefault();
            setIsFolderDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setIsFolderDragActive(false);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsFolderDragActive(true);
          }}
          onDrop={handleBrowserDrop}
          ref={dropZoneRef}
        >
          <strong>
            {isFolderDragActive ? copy.dropRelease : copy.dropTitle}
          </strong>
          <span>{copy.dropHint}</span>
        </div>
        {dropNotice ? (
          <p className="csv-folder-drop-notice" role="status">
            {dropNotice}
          </p>
        ) : null}
        {dropError ? (
          <p className="error-text" role="alert">
            {dropError}
          </p>
        ) : null}
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

function pointIsInsideDropZone(
  position: { x: number; y: number },
  element: HTMLDivElement | null,
): boolean {
  if (!element) {
    return false;
  }

  const scale = window.devicePixelRatio || 1;
  const bounds = element.getBoundingClientRect();

  return physicalPointIsInsideBounds(position, scale, bounds);
}
