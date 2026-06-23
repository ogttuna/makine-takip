import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  fetchQualityEvents,
  fetchRunSamples,
  fetchRuns,
  getCollectorUrl,
  getRunExportUrl,
  uploadCsv,
} from "./api";
import type { ImportReport, QualityEvent, RunSummary, SampleFrame } from "./api";
import { getChannelConfig, sortChannels } from "./channelConfig";
import { TelemetryChart } from "./TelemetryChart";

export function App() {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [visibleChannels, setVisibleChannels] = useState<string[]>([]);
  const [lastImportReport, setLastImportReport] = useState<ImportReport | null>(null);
  const runsQuery = useQuery({
    queryKey: ["runs"],
    queryFn: fetchRuns,
    refetchInterval: 10_000,
  });
  const selectedRun = useMemo(
    () => runsQuery.data?.find((run) => run.id === selectedRunId) ?? null,
    [runsQuery.data, selectedRunId],
  );
  const samplesQuery = useQuery({
    queryKey: ["run-samples", selectedRunId],
    queryFn: () => fetchRunSamples(selectedRunId!),
    enabled: selectedRunId !== null,
  });
  const qualityEventsQuery = useQuery({
    queryKey: ["run-quality-events", selectedRunId],
    queryFn: () => fetchQualityEvents(selectedRunId!),
    enabled: selectedRunId !== null,
  });
  const importMutation = useMutation({
    mutationFn: uploadCsv,
    onSuccess: async (report) => {
      setLastImportReport(report);
      setSelectedRunId(report.run_id);
      await queryClient.invalidateQueries({ queryKey: ["runs"] });
      await queryClient.invalidateQueries({ queryKey: ["run-samples", report.run_id] });
      await queryClient.invalidateQueries({
        queryKey: ["run-quality-events", report.run_id],
      });
    },
  });
  const samples = samplesQuery.data ?? [];
  const qualityEvents = qualityEventsQuery.data ?? [];
  const channelCodes = useMemo(() => getChannelCodes(samples), [samples]);
  const activeVisibleChannels = visibleChannels.filter((channel) =>
    channelCodes.includes(channel),
  );

  useEffect(() => {
    const runs = runsQuery.data ?? [];

    if (runs.length === 0) {
      setSelectedRunId(null);
      return;
    }

    if (selectedRunId === null || !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0].id);
    }
  }, [runsQuery.data, selectedRunId]);

  useEffect(() => {
    if (channelCodes.length === 0) {
      setVisibleChannels([]);
      return;
    }

    setVisibleChannels((current) => {
      const filtered = current.filter((channel) => channelCodes.includes(channel));

      if (filtered.length === 0) {
        return channelCodes;
      }

      return filtered;
    });
  }, [channelCodes]);

  const sourceLabel = runsQuery.isError ? "Collector offline" : "Collector online";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">FreezeDryMachine</p>
          <h1>CSV Import ve Grafik</h1>
        </div>
        <div className="connection-strip">
          <span className={runsQuery.isError ? "status-dot" : "status-dot online"} />
          <div>
            <strong>{sourceLabel}</strong>
            <span>{getCollectorUrl()}</span>
          </div>
        </div>
      </header>

      <section className="summary-grid">
        <Metric label="Runs" value={String(runsQuery.data?.length ?? 0)} />
        <Metric label="Samples" value={String(selectedRun?.row_count ?? samples.length)} />
        <Metric label="Channels" value={String(channelCodes.length)} />
        <Metric label="Warnings" value={String(selectedRun?.warning_count ?? qualityEvents.length)} />
      </section>

      <section className="workspace">
        <div className="chart-panel">
          <div className="section-heading">
            <div>
              <h2>{selectedRun?.name ?? "No run selected"}</h2>
              <p>{runRangeLabel(selectedRun)}</p>
            </div>
            <RunActions run={selectedRun} />
          </div>

          <ChannelControls
            channels={channelCodes}
            visibleChannels={activeVisibleChannels}
            onChange={setVisibleChannels}
          />

          {samples.length > 0 ? (
            <TelemetryChart
              qualityEvents={qualityEvents}
              samples={samples}
              visibleChannels={activeVisibleChannels}
            />
          ) : (
            <div className="empty-chart">
              <strong>No samples loaded</strong>
              <span>Import a CSV file or select a stored run.</span>
            </div>
          )}
        </div>

        <aside className="side-panel">
          <ImportPanel
            error={importMutation.error}
            isPending={importMutation.isPending}
            lastReport={lastImportReport}
            onUpload={(file) => importMutation.mutate(file)}
          />

          <div className="section-heading compact">
            <div>
              <h2>Recent Runs</h2>
              <p>{runsQuery.data?.length ?? 0} indexed</p>
            </div>
          </div>
          <RunList
            onSelect={setSelectedRunId}
            runs={runsQuery.data ?? []}
            selectedRunId={selectedRunId}
          />

          <QualitySummary events={qualityEvents} />
        </aside>
      </section>
    </main>
  );
}

function ImportPanel({
  error,
  isPending,
  lastReport,
  onUpload,
}: {
  error: Error | null;
  isPending: boolean;
  lastReport: ImportReport | null;
  onUpload: (file: File) => void;
}) {
  return (
    <section className="import-panel">
      <div className="section-heading compact">
        <div>
          <h2>CSV Import</h2>
          <p>Upload the machine log file from this computer.</p>
        </div>
      </div>
      <label className="file-drop">
        <input
          accept=".csv,text/csv"
          disabled={isPending}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";

            if (file) {
              onUpload(file);
            }
          }}
          type="file"
        />
        <strong>{isPending ? "Importing..." : "Choose CSV"}</strong>
        <span>Expected delimiter is semicolon.</span>
      </label>
      {lastReport ? <ImportReportView report={lastReport} /> : null}
      {error ? <p className="error-text">{error.message}</p> : null}
    </section>
  );
}

function ImportReportView({ report }: { report: ImportReport }) {
  return (
    <div className="import-report">
      <strong>{report.duplicate ? "Already imported" : "Import complete"}</strong>
      <dl>
        <div>
          <dt>Rows</dt>
          <dd>{report.row_count}</dd>
        </div>
        <div>
          <dt>Channels</dt>
          <dd>{report.channel_count}</dd>
        </div>
        <div>
          <dt>Warnings</dt>
          <dd>{report.warning_count}</dd>
        </div>
      </dl>
    </div>
  );
}

function ChannelControls({
  channels,
  visibleChannels,
  onChange,
}: {
  channels: string[];
  visibleChannels: string[];
  onChange: (channels: string[]) => void;
}) {
  if (channels.length === 0) {
    return null;
  }

  const chooseGroup = (group: ReturnType<typeof getChannelConfig>["group"]) => {
    onChange(
      sortChannels(
        channels.filter((channel) => getChannelConfig(channel).group === group),
      ),
    );
  };

  return (
    <div className="channel-control-shell">
      <div className="channel-quick-actions">
        <button onClick={() => onChange(channels)} type="button">
          All
        </button>
        <button onClick={() => chooseGroup("shelf")} type="button">
          Shelves
        </button>
        <button onClick={() => chooseGroup("pressure")} type="button">
          Pressure
        </button>
        <button onClick={() => chooseGroup("cooling")} type="button">
          Cooling
        </button>
        <button onClick={() => onChange([])} type="button">
          Clear
        </button>
      </div>
      <div className="channel-controls">
        {channels.map((channel) => {
          const active = visibleChannels.includes(channel);

          return (
            <button
              className={active ? "channel-button active" : "channel-button"}
              key={channel}
              onClick={() => {
                if (active) {
                  onChange(visibleChannels.filter((item) => item !== channel));
                } else {
                  onChange(sortChannels([...visibleChannels, channel]));
                }
              }}
              type="button"
            >
              {channel}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RunActions({ run }: { run: RunSummary | null }) {
  return (
    <div className="run-actions">
      <div className="run-badge">
        <span>{run?.status ?? "idle"}</span>
        <strong>{run?.source_kind ?? "No source"}</strong>
      </div>
      {run ? (
        <a className="export-link" href={getRunExportUrl(run.id)}>
          Export CSV
        </a>
      ) : null}
    </div>
  );
}

function RunList({
  onSelect,
  runs,
  selectedRunId,
}: {
  onSelect: (runId: number) => void;
  runs: RunSummary[];
  selectedRunId: number | null;
}) {
  if (runs.length === 0) {
    return <p className="empty-state">No runs stored yet.</p>;
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
            <span>
              {run.row_count} rows, {run.warning_count} warnings
            </span>
          </div>
          <time>{run.started_at ? formatDate(run.started_at) : "-"}</time>
        </button>
      ))}
    </div>
  );
}

function QualitySummary({ events }: { events: QualityEvent[] }) {
  const counts = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.event_type] = (acc[event.event_type] ?? 0) + 1;
    return acc;
  }, {});
  const visibleEvents = events.slice(0, 16);

  return (
    <div className="quality-summary">
      <strong>Quality</strong>
      {events.length === 0 ? (
        <span>No warnings for selected run.</span>
      ) : (
        <dl>
          {Object.entries(counts).map(([eventType, count]) => (
            <div key={eventType}>
              <dt>{eventType}</dt>
              <dd>{count}</dd>
            </div>
          ))}
        </dl>
      )}
      {visibleEvents.length > 0 ? (
        <ul className="quality-event-list">
          {visibleEvents.map((event) => (
            <li className="quality-event" key={event.id}>
              <div>
                <strong>{qualityEventLabel(event.event_type)}</strong>
                <span>
                  {event.channel_code ?? "run"} - {qualityEventTimeLabel(event)}
                </span>
              </div>
              <p>{event.message}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {events.length > visibleEvents.length ? (
        <span>{events.length - visibleEvents.length} more warnings hidden.</span>
      ) : null}
    </div>
  );
}

function getChannelCodes(samples: SampleFrame[]): string[] {
  const channels = new Set<string>();

  for (const sample of samples) {
    for (const measurement of sample.measurements) {
      channels.add(measurement.channel_code);
    }
  }

  return sortChannels([...channels]);
}

function runRangeLabel(run: RunSummary | null): string {
  if (!run?.started_at || !run.finished_at) {
    return "Import a run to inspect its samples.";
  }

  return `${formatDate(run.started_at)} - ${formatDate(run.finished_at)}`;
}

function qualityEventLabel(eventType: string): string {
  if (eventType === "time_gap") {
    return "Time gap";
  }

  if (eventType === "suspect_value") {
    return "Suspect value";
  }

  return eventType;
}

function qualityEventTimeLabel(event: QualityEvent): string {
  const rowLabel =
    event.source_row_number !== null ? `row ${event.source_row_number}` : null;
  const timeLabel =
    event.source_timestamp_text ?? (event.sampled_at ? formatDate(event.sampled_at) : null);

  return [timeLabel, rowLabel].filter(Boolean).join(" - ") || "no timestamp";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
