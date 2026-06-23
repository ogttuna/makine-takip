import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import {
  fetchQualityEvents,
  fetchRunSamples,
  fetchRuns,
  getCollectorUrl,
  getRunExportUrl,
  uploadCsv,
} from "./api";
import type { ImportReport, QualityEvent, RunSummary, SampleFrame } from "./api";
import type { ChannelGroup } from "./channelConfig";
import {
  getChannelConfig,
  SHELF_AVERAGE_CHANNEL,
  SHELF_CHANNELS,
  sortChannels,
} from "./channelConfig";

type QualityFilter = "all" | "time_gap" | "suspect_value";
type ChartLayout = "overlay" | "grouped";

type AnalysisFunctions = {
  shelfAverage: boolean;
};

const DEFAULT_ANALYSIS_FUNCTIONS: AnalysisFunctions = {
  shelfAverage: true,
};

const CHART_GROUPS: Array<{
  group: ChannelGroup;
  title: string;
  note: string;
}> = [
  { group: "shelf", title: "Shelves", note: "Shelf probes and optional functions" },
  { group: "pressure", title: "Pressure", note: "Low and high pressure channels" },
  { group: "vacuum", title: "Vacuum", note: "Log scale vacuum channel" },
  { group: "cooling", title: "Cooling", note: "Cooling and condenser channels" },
  { group: "other", title: "Other", note: "Unmapped imported signals" },
];

const TelemetryChart = lazy(() =>
  import("./TelemetryChart").then((module) => ({ default: module.TelemetryChart })),
);

export function App() {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [chartLayout, setChartLayout] = useState<ChartLayout>("overlay");
  const [analysisFunctions, setAnalysisFunctions] = useState<AnalysisFunctions>(
    DEFAULT_ANALYSIS_FUNCTIONS,
  );
  const [visibleChannels, setVisibleChannels] = useState<string[]>([]);
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>("all");
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
  const rawChannelCodes = useMemo(() => getRawChannelCodes(samples), [samples]);
  const channelCodes = useMemo(
    () => withDerivedChannels(rawChannelCodes, analysisFunctions),
    [analysisFunctions, rawChannelCodes],
  );
  const shelfAverageAvailable = hasShelfAverageInputs(rawChannelCodes);
  const derivedChannelCount = channelCodes.length - rawChannelCodes.length;
  const pendingUnitChannels = rawChannelCodes.filter(
    (channel) => !getChannelConfig(channel).unit,
  );
  const activeVisibleChannels = visibleChannels.filter((channel) =>
    channelCodes.includes(channel),
  );
  const isRefreshing =
    runsQuery.isFetching || samplesQuery.isFetching || qualityEventsQuery.isFetching;

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

  useEffect(() => {
    setQualityFilter("all");
  }, [selectedRunId]);

  const sourceLabel = runsQuery.isError
    ? "Collector offline"
    : isRefreshing
      ? "Syncing"
      : "Collector online";
  const refreshData = async () => {
    await queryClient.invalidateQueries({ queryKey: ["runs"] });

    if (selectedRunId !== null) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["run-samples", selectedRunId] }),
        queryClient.invalidateQueries({
          queryKey: ["run-quality-events", selectedRunId],
        }),
      ]);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-title">
          <p className="eyebrow">FreezeDryMachine</p>
          <h1>Run Review</h1>
          <p>Local CSV workspace for freeze dry telemetry.</p>
        </div>
        <div className="connection-strip" aria-busy={isRefreshing}>
          <div className="connection-state">
            <span
              aria-hidden="true"
              className={runsQuery.isError ? "status-dot" : "status-dot online"}
            />
            <div>
              <strong>{sourceLabel}</strong>
              <span>{getCollectorUrl()}</span>
            </div>
          </div>
          <button
            className="ghost-button"
            disabled={isRefreshing}
            onClick={refreshData}
            type="button"
          >
            Refresh
          </button>
        </div>
      </header>

      <section className="summary-grid">
        <Metric
          hint="stored"
          label="Runs"
          value={runsQuery.isLoading ? "..." : String(runsQuery.data?.length ?? 0)}
        />
        <Metric
          hint="selected"
          label="Samples"
          value={
            samplesQuery.isLoading
              ? "..."
              : String(selectedRun?.row_count ?? samples.length)
          }
        />
        <Metric
          hint={
            derivedChannelCount > 0
              ? `${rawChannelCodes.length} raw + ${derivedChannelCount} derived`
              : `${rawChannelCodes.length} raw`
          }
          label="Signals"
          value={String(channelCodes.length)}
        />
        <Metric
          hint={selectedRun ? "selected run" : "none selected"}
          label="Warnings"
          value={
            qualityEventsQuery.isLoading
              ? "..."
              : String(selectedRun?.warning_count ?? qualityEvents.length)
          }
        />
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

          <RunOverview
            run={selectedRun}
            samples={samples}
            warningCount={selectedRun?.warning_count ?? qualityEvents.length}
          />
          <UnitNote pendingChannels={pendingUnitChannels} />

          <ChartConfigPanel
            analysisFunctions={analysisFunctions}
            chartLayout={chartLayout}
            onAnalysisFunctionsChange={setAnalysisFunctions}
            onChartLayoutChange={setChartLayout}
            shelfAverageAvailable={shelfAverageAvailable}
          />

          <ChannelControls
            channels={channelCodes}
            visibleChannels={activeVisibleChannels}
            onChange={setVisibleChannels}
          />

          {samplesQuery.isLoading ? (
            <ChartState
              message="Loading stored samples from the collector."
              title="Loading run"
            />
          ) : samplesQuery.isError ? (
            <ChartState
              actionLabel="Retry"
              message={samplesQuery.error.message}
              onAction={() => samplesQuery.refetch()}
              tone="error"
              title="Samples could not be loaded"
            />
          ) : samples.length === 0 ? (
            <ChartState
              message="Import a CSV file or select a stored run."
              title="No samples loaded"
            />
          ) : activeVisibleChannels.length === 0 ? (
            <ChartState
              message="Choose at least one channel to draw the chart."
              title="No channels selected"
            />
          ) : (
            <ChartArea
              layout={chartLayout}
              qualityEvents={qualityEvents}
              samples={samples}
              visibleChannels={activeVisibleChannels}
            />
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
            error={runsQuery.error}
            isLoading={runsQuery.isLoading}
            onSelect={setSelectedRunId}
            onRetry={() => runsQuery.refetch()}
            runs={runsQuery.data ?? []}
            selectedRunId={selectedRunId}
          />

          <QualitySummary
            error={qualityEventsQuery.error}
            events={qualityEvents}
            filter={qualityFilter}
            isLoading={qualityEventsQuery.isLoading}
            onFilterChange={setQualityFilter}
            onRetry={() => qualityEventsQuery.refetch()}
          />
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
  const [isDragActive, setIsDragActive] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const handleFile = (file: File | undefined) => {
    if (!file || isPending) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setLocalError("Use a .csv machine log file.");
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
          <h2>CSV Import</h2>
          <p>Machine log from this computer.</p>
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
          aria-label="Choose CSV file"
          disabled={isPending}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            handleFile(file);
          }}
          type="file"
        />
        <strong>{isPending ? "Importing..." : "Drop or choose CSV"}</strong>
        <span>Semicolon-delimited machine log.</span>
      </label>
      {lastReport ? <ImportReportView report={lastReport} /> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
    </section>
  );
}

function ImportReportView({ report }: { report: ImportReport }) {
  return (
    <div className="import-report">
      <strong>{report.duplicate ? "Already imported" : "Import complete"}</strong>
      <span>{report.file_name}</span>
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

function RunOverview({
  run,
  samples,
  warningCount,
}: {
  run: RunSummary | null;
  samples: SampleFrame[];
  warningCount: number;
}) {
  const firstSample = samples[0];
  const lastSample = samples[samples.length - 1];

  return (
    <div className="run-overview">
      <OverviewItem label="Duration" value={durationLabel(run)} />
      <OverviewItem
        label="First sample"
        value={
          firstSample ? formatDate(firstSample.sampled_at) : shortDate(run?.started_at)
        }
      />
      <OverviewItem
        label="Last sample"
        value={
          lastSample ? formatDate(lastSample.sampled_at) : shortDate(run?.finished_at)
        }
      />
      <OverviewItem label="Warnings" value={String(warningCount)} />
    </div>
  );
}

function OverviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function UnitNote({ pendingChannels }: { pendingChannels: string[] }) {
  if (pendingChannels.length === 0) {
    return (
      <p className="unit-note">
        Units are assigned from channel config. Shelf, cooling and condenser values
        are marked as degC.
      </p>
    );
  }

  return (
    <p className="unit-note">
      Units are not present in the CSV. Temperature channels use configured degC;
      confirm units for {pendingChannels.join(", ")}.
    </p>
  );
}

function ChartConfigPanel({
  analysisFunctions,
  chartLayout,
  onAnalysisFunctionsChange,
  onChartLayoutChange,
  shelfAverageAvailable,
}: {
  analysisFunctions: AnalysisFunctions;
  chartLayout: ChartLayout;
  onAnalysisFunctionsChange: (functions: AnalysisFunctions) => void;
  onChartLayoutChange: (layout: ChartLayout) => void;
  shelfAverageAvailable: boolean;
}) {
  return (
    <div className="chart-config-panel">
      <div className="config-block">
        <div>
          <strong>Chart layout</strong>
          <span>Choose overlay or deterministic grouped panels.</span>
        </div>
        <div className="segmented-control" role="group" aria-label="Chart layout">
          <button
            aria-pressed={chartLayout === "overlay"}
            className={chartLayout === "overlay" ? "active" : ""}
            onClick={() => onChartLayoutChange("overlay")}
            type="button"
          >
            Overlay
          </button>
          <button
            aria-pressed={chartLayout === "grouped"}
            className={chartLayout === "grouped" ? "active" : ""}
            onClick={() => onChartLayoutChange("grouped")}
            type="button"
          >
            By group
          </button>
        </div>
      </div>

      <div className="config-block">
        <div>
          <strong>Analysis functions</strong>
          <span>Derived signals can be switched independently.</span>
        </div>
        <button
          aria-pressed={analysisFunctions.shelfAverage}
          className={analysisFunctions.shelfAverage ? "function-toggle active" : "function-toggle"}
          disabled={!shelfAverageAvailable}
          onClick={() =>
            onAnalysisFunctionsChange({
              ...analysisFunctions,
              shelfAverage: !analysisFunctions.shelfAverage,
            })
          }
          type="button"
        >
          <span>Raf Avg</span>
          <small>Good RAF1-RAF4 values</small>
        </button>
      </div>
    </div>
  );
}

function ChartArea({
  layout,
  qualityEvents,
  samples,
  visibleChannels,
}: {
  layout: ChartLayout;
  qualityEvents: QualityEvent[];
  samples: SampleFrame[];
  visibleChannels: string[];
}) {
  const groupedCharts = chartGroupsFor(visibleChannels);

  return (
    <>
      <div className="chart-hints" aria-label="Chart interaction hints">
        <span>Wheel or pinch to zoom</span>
        <span>Drag to pan</span>
        <span>{layout === "overlay" ? "Use the slider for range" : "Groups share time source"}</span>
      </div>
      <Suspense
        fallback={
          <ChartState
            message="Preparing the chart canvas."
            title="Loading chart"
          />
        }
      >
        {layout === "overlay" ? (
          <TelemetryChart
            qualityEvents={qualityEvents}
            samples={samples}
            visibleChannels={visibleChannels}
          />
        ) : (
          <div className="chart-grid">
            {groupedCharts.map((chart) => (
              <section className="chart-tile" key={chart.group}>
                <div className="chart-tile-heading">
                  <div>
                    <strong>{chart.title}</strong>
                    <span>{chart.note}</span>
                  </div>
                  <small>{signalCountLabel(chart.channels.length)}</small>
                </div>
                <TelemetryChart
                  qualityEvents={qualityEvents}
                  samples={samples}
                  showSlider={false}
                  variant="compact"
                  visibleChannels={chart.channels}
                />
              </section>
            ))}
          </div>
        )}
      </Suspense>
    </>
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
      <div className="control-heading">
        <strong>Signals</strong>
        <span>
          {visibleChannels.length} of {channels.length} visible
        </span>
      </div>
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
          const config = getChannelConfig(channel);
          const secondaryLabel = [
            config.unit,
            config.derived ? "derived" : null,
          ]
            .filter(Boolean)
            .join(" - ");

          return (
            <button
              aria-pressed={active}
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
              <span>{config.label}</span>
              {secondaryLabel ? <small>{secondaryLabel}</small> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Metric({
  hint,
  label,
  value,
}: {
  hint?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
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
  error,
  isLoading,
  onSelect,
  onRetry,
  runs,
  selectedRunId,
}: {
  error: Error | null;
  isLoading: boolean;
  onSelect: (runId: number) => void;
  onRetry: () => void;
  runs: RunSummary[];
  selectedRunId: number | null;
}) {
  if (isLoading) {
    return <p className="empty-state">Loading stored runs...</p>;
  }

  if (error) {
    return (
      <InlineError
        actionLabel="Retry"
        message={error.message}
        onAction={onRetry}
        title="Runs could not be loaded"
      />
    );
  }

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

function QualitySummary({
  error,
  events,
  filter,
  isLoading,
  onFilterChange,
  onRetry,
}: {
  error: Error | null;
  events: QualityEvent[];
  filter: QualityFilter;
  isLoading: boolean;
  onFilterChange: (filter: QualityFilter) => void;
  onRetry: () => void;
}) {
  const counts = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.event_type] = (acc[event.event_type] ?? 0) + 1;
    return acc;
  }, {});
  const filteredEvents =
    filter === "all" ? events : events.filter((event) => event.event_type === filter);
  const visibleEvents = filteredEvents.slice(0, 16);

  return (
    <div className="quality-summary">
      <div className="quality-header">
        <strong>Quality</strong>
        <span>{events.length} warnings</span>
      </div>
      <div className="quality-filters">
        <FilterButton
          active={filter === "all"}
          count={events.length}
          label="All"
          onClick={() => onFilterChange("all")}
        />
        <FilterButton
          active={filter === "time_gap"}
          count={counts.time_gap ?? 0}
          label="Gaps"
          onClick={() => onFilterChange("time_gap")}
        />
        <FilterButton
          active={filter === "suspect_value"}
          count={counts.suspect_value ?? 0}
          label="Suspect"
          onClick={() => onFilterChange("suspect_value")}
        />
      </div>
      {isLoading ? (
        <span>Loading warnings...</span>
      ) : error ? (
        <InlineError
          actionLabel="Retry"
          message={error.message}
          onAction={onRetry}
          title="Warnings could not be loaded"
        />
      ) : events.length === 0 ? (
        <span>No warnings for selected run.</span>
      ) : filteredEvents.length === 0 ? (
        <span>No warnings in this filter.</span>
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
              <p>{cleanQualityMessage(event.message)}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {filteredEvents.length > visibleEvents.length ? (
        <span>{filteredEvents.length - visibleEvents.length} more warnings hidden.</span>
      ) : null}
    </div>
  );
}

function FilterButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={active ? "filter-button active" : "filter-button"}
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
  );
}

function ChartState({
  actionLabel,
  message,
  onAction,
  title,
  tone = "idle",
}: {
  actionLabel?: string;
  message: string;
  onAction?: () => void;
  title: string;
  tone?: "idle" | "error";
}) {
  return (
    <div
      className={tone === "error" ? "chart-state error" : "chart-state"}
      role={tone === "error" ? "alert" : "status"}
    >
      <strong>{title}</strong>
      <span>{message}</span>
      {actionLabel && onAction ? (
        <button onClick={onAction} type="button">
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function InlineError({
  actionLabel,
  message,
  onAction,
  title,
}: {
  actionLabel: string;
  message: string;
  onAction: () => void;
  title: string;
}) {
  return (
    <div className="inline-error" role="alert">
      <strong>{title}</strong>
      <span>{message}</span>
      <button onClick={onAction} type="button">
        {actionLabel}
      </button>
    </div>
  );
}

function getRawChannelCodes(samples: SampleFrame[]): string[] {
  const channels = new Set<string>();

  for (const sample of samples) {
    for (const measurement of sample.measurements) {
      channels.add(measurement.channel_code);
    }
  }

  return sortChannels([...channels]);
}

function hasShelfAverageInputs(channels: string[]): boolean {
  const shelfChannelCount = SHELF_CHANNELS.filter((channel) =>
    channels.includes(channel),
  ).length;

  return shelfChannelCount >= 2;
}

function withDerivedChannels(
  channels: string[],
  analysisFunctions: AnalysisFunctions,
): string[] {
  const shelfAverageEnabled =
    analysisFunctions.shelfAverage && hasShelfAverageInputs(channels);

  if (!shelfAverageEnabled || channels.includes(SHELF_AVERAGE_CHANNEL)) {
    return sortChannels(channels);
  }

  return sortChannels([...channels, SHELF_AVERAGE_CHANNEL]);
}

function chartGroupsFor(channels: string[]) {
  return CHART_GROUPS.map((groupConfig) => ({
    ...groupConfig,
    channels: sortChannels(
      channels.filter(
        (channel) => getChannelConfig(channel).group === groupConfig.group,
      ),
    ),
  })).filter((groupConfig) => groupConfig.channels.length > 0);
}

function signalCountLabel(count: number): string {
  return count === 1 ? "1 signal" : `${count} signals`;
}

function runRangeLabel(run: RunSummary | null): string {
  if (!run?.started_at || !run.finished_at) {
    return "Import a run to inspect its samples.";
  }

  return `${formatDate(run.started_at)} - ${formatDate(run.finished_at)}`;
}

function durationLabel(run: RunSummary | null): string {
  if (!run?.started_at || !run.finished_at) {
    return "-";
  }

  const start = Date.parse(run.started_at);
  const end = Date.parse(run.finished_at);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return "-";
  }

  const totalMinutes = Math.round((end - start) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  return `${hours}h ${minutes}m`;
}

function shortDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return formatDate(value);
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

function cleanQualityMessage(message: string): string {
  return message.replaceAll("`", "");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
