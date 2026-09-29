import { useEffect, useId, useState } from "react";

import {
  downloadMachineExport,
  MachineExportRequestError,
  type MachineExportFormat,
  type MachineSummary,
} from "../../api";
import {
  defaultExportRange,
  exportRangeQuery,
  timestampDateTimeInputValue,
  validateExportRange,
  type ExportDateTimeRange,
  type ExportRangeError,
} from "../../exportRange";
import type { AppCopy } from "../../i18n";

type ExportStatus =
  | { state: "idle" }
  | { state: "preparing" }
  | { state: "success"; fileName: string; rowCount: number }
  | { state: "error"; message: string };

export function MachineExportPanel({
  availableFrom,
  availableTo,
  copy,
  machine,
}: {
  availableFrom: string | null;
  availableTo: string | null;
  copy: AppCopy["dataExport"];
  machine: MachineSummary;
}) {
  const errorId = useId();
  const [format, setFormat] = useState<MachineExportFormat>("xlsx");
  const [range, setRange] = useState<ExportDateTimeRange>(() =>
    defaultExportRange(availableTo, availableFrom),
  );
  const [rangeError, setRangeError] = useState<ExportRangeError | null>(null);
  const [status, setStatus] = useState<ExportStatus>({ state: "idle" });
  const minDateTime = timestampDateTimeInputValue(availableFrom) ?? undefined;
  const maxDateTime = timestampDateTimeInputValue(availableTo, "end") ?? undefined;

  useEffect(() => {
    if (!minDateTime) {
      return;
    }

    setRange((current) =>
      current.startDateTime < minDateTime
        ? { ...current, startDateTime: minDateTime }
        : current,
    );
  }, [minDateTime]);

  const updateRange = (field: keyof ExportDateTimeRange, value: string) => {
    setRange((current) => ({ ...current, [field]: value }));
    setRangeError(null);
    setStatus({ state: "idle" });
  };

  const submitExport = async () => {
    const validationError = validateExportRange(range);
    if (validationError) {
      setRangeError(validationError);
      setStatus({ state: "idle" });
      return;
    }

    const query = exportRangeQuery(range);
    if (!query) {
      setRangeError("invalid");
      return;
    }

    setRangeError(null);
    setStatus({ state: "preparing" });

    try {
      const result = await downloadMachineExport(machine.id, query, format);
      const objectUrl = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = result.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setStatus({
        state: "success",
        fileName: result.fileName,
        rowCount: result.rowCount,
      });
    } catch (error) {
      const message =
        error instanceof MachineExportRequestError && error.status === 404
          ? copy.errors.noData
          : error instanceof Error
            ? `${copy.errors.download} ${error.message}`
            : copy.errors.download;
      setStatus({ state: "error", message });
    }
  };

  const downloadLabel = format === "xlsx" ? copy.downloadExcel : copy.downloadCsv;

  return (
    <details className="export-panel">
      <summary>
        <span className="export-summary-icon" aria-hidden="true">
          ↓
        </span>
        <span>
          <strong>{copy.title}</strong>
          <small>{copy.summary}</small>
        </span>
        <span className="export-summary-limit">{copy.limit}</span>
        <span className="export-summary-toggle" aria-hidden="true">
          +
        </span>
      </summary>

      <form
        className="export-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submitExport();
        }}
      >
        <div className="export-intro">
          <p>{copy.description}</p>
          <div className="export-machine">
            <span>{copy.machine}</span>
            <strong>{machine.name}</strong>
            <code>{machine.code}</code>
          </div>
        </div>

        <div className="export-range-fields">
          <label>
            <span>{copy.start}</span>
            <input
              aria-describedby={rangeError ? errorId : undefined}
              max={maxDateTime}
              min={minDateTime}
              onChange={(event) =>
                updateRange("startDateTime", event.target.value)
              }
              required
              step="60"
              type="datetime-local"
              value={range.startDateTime}
            />
          </label>
          <span className="export-range-arrow" aria-hidden="true">
            →
          </span>
          <label>
            <span>{copy.end}</span>
            <input
              aria-describedby={rangeError ? errorId : undefined}
              max={maxDateTime}
              min={minDateTime}
              onChange={(event) => updateRange("endDateTime", event.target.value)}
              required
              step="60"
              type="datetime-local"
              value={range.endDateTime}
            />
          </label>
          <small>{copy.timezone}</small>
          {rangeError ? (
            <p className="export-message error" id={errorId} role="alert">
              {copy.errors[rangeError]}
            </p>
          ) : null}
        </div>

        <fieldset className="export-format">
          <legend>{copy.format}</legend>
          <label className={format === "xlsx" ? "selected" : ""}>
            <input
              checked={format === "xlsx"}
              name="export-format"
              onChange={() => {
                setFormat("xlsx");
                setStatus({ state: "idle" });
              }}
              type="radio"
              value="xlsx"
            />
            <span>
              <strong>{copy.excel}</strong>
              <small>{copy.excelHint}</small>
            </span>
          </label>
          <label className={format === "csv" ? "selected" : ""}>
            <input
              checked={format === "csv"}
              name="export-format"
              onChange={() => {
                setFormat("csv");
                setStatus({ state: "idle" });
              }}
              type="radio"
              value="csv"
            />
            <span>
              <strong>{copy.csv}</strong>
              <small>{copy.csvHint}</small>
            </span>
          </label>
        </fieldset>

        <div className="export-submit">
          <button disabled={status.state === "preparing"} type="submit">
            <span aria-hidden="true">↓</span>
            {status.state === "preparing" ? copy.preparing : downloadLabel}
          </button>
          <div aria-live="polite">
            {status.state === "success" ? (
              <p className="export-message success">
                {copy.success(status.fileName, status.rowCount)}
              </p>
            ) : status.state === "error" ? (
              <p className="export-message error" role="alert">
                {status.message}
              </p>
            ) : null}
          </div>
        </div>
      </form>
    </details>
  );
}
