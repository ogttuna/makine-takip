import { useState } from "react";

import type { ImportReport } from "../../api";
import type { AppCopy } from "../../i18n";

export function ImportPanel({
  copy,
  error,
  isPending,
  lastReport,
  onUpload,
}: {
  copy: AppCopy["import"];
  error: Error | null;
  isPending: boolean;
  lastReport: ImportReport | null;
  onUpload: (file: File) => void;
}) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const handleFile = (file: File | undefined) => {
    if (!file || isPending) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setLocalError(copy.badExtension);
      return;
    }

    setLocalError(null);
    onUpload(file);
  };
  const errorMessage = localError ?? error?.message ?? null;

  return (
    <section className="import-panel">
      <div className="section-heading compact">
        <div>
          <h2>{copy.title}</h2>
          <p>{copy.subtitle}</p>
        </div>
      </div>
      <label
        className={isDragActive ? "file-drop active" : "file-drop"}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setIsDragActive(false);
        }}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragActive(false);
          handleFile(event.dataTransfer.files[0]);
        }}
      >
        <input
          accept=".csv,text/csv"
          aria-label={copy.chooseAria}
          disabled={isPending}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            handleFile(file);
          }}
          type="file"
        />
        <strong>{isPending ? copy.pending : copy.choose}</strong>
        <span>{copy.hint}</span>
      </label>
      {lastReport ? <ImportReportView copy={copy} report={lastReport} /> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
    </section>
  );
}

function ImportReportView({
  copy,
  report,
}: {
  copy: AppCopy["import"];
  report: ImportReport;
}) {
  return (
    <div className="import-report">
      <strong>{report.duplicate ? copy.duplicate : copy.complete}</strong>
      <span>{report.file_name}</span>
      <dl>
        <div>
          <dt>{copy.rows}</dt>
          <dd>{report.row_count}</dd>
        </div>
        <div>
          <dt>{copy.channels}</dt>
          <dd>{report.channel_count}</dd>
        </div>
        <div>
          <dt>{copy.warnings}</dt>
          <dd>{report.warning_count}</dd>
        </div>
      </dl>
    </div>
  );
}
