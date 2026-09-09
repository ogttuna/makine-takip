import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createMachine,
  fetchMachines,
  fetchQualityEvents,
  fetchRunAnalysis,
  fetchRunSamples,
  fetchRuns,
  getCollectorUrl,
  uploadCsv,
  type CreateMachinePayload,
  type ImportReport,
  type MachineSummary,
  type SampleFrame,
} from "./api";
import {
  samplesForChartRange,
  segmentsForVisibleSamples,
} from "./chartTimeRange";
import { getChannelConfig } from "./channelConfig";
import { ChartState } from "./components/StatusViews";
import { AnalysisSummary } from "./features/analysis/AnalysisSummary";
import {
  ChartArea,
  ChartViewControls,
  ChannelControls,
  UnitNote,
} from "./features/charts/ChartControls";
import {
  getRawChannelCodes,
  withDerivedChannels,
} from "./features/charts/channelSelection";
import { LiveSnapshot } from "./features/dashboard/LiveSnapshot";
import { ImportPanel } from "./features/import/ImportPanel";
import { MachineRail } from "./features/machines/MachineRail";
import { QualitySummary } from "./features/quality/QualitySummary";
import { ProcessHeader } from "./features/runs/ProcessHeader";
import { RunActions } from "./features/runs/RunActions";
import { RunList } from "./features/runs/RunList";
import { SourceAccessControl } from "./features/source/SourceAccessControl";
import { DEFAULT_LOCALE, getCopy, type Locale } from "./i18n";
import { lastSourceSequence, mergeIncrementalSamples } from "./incrementalSamples";
import {
  DEFAULT_SOURCE_MANAGEMENT_MODE,
  hasServerMachineData,
  preferredMachineId,
  preferredRunId,
  readSourceManagementMode,
  type SourceManagementMode,
  writeSourceManagementMode,
} from "./sourceManagementMode";
import type {
  ChartLayout,
  ChartTimeRange,
  InspectorTab,
  QualityFilter,
  ThemeMode,
} from "./types";
import type { BrowserCsvTailState } from "./useBrowserCsvTail";
import { formatDate } from "./utils/format";

const THEME_STORAGE_KEY = "freezedry.theme";
const LOCALE_STORAGE_KEY = "freezedry.locale";
const LIVE_REFETCH_INTERVAL_MS = 30_000;
const MAX_VISIBLE_SAMPLES = 5_000;

export function App() {
  const queryClient = useQueryClient();
  const [selectedMachineId, setSelectedMachineId] = useState<number | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [machineRuntime, setMachineRuntime] = useState<
    Record<number, BrowserCsvTailState>
  >({});
  const [chartLayout, setChartLayout] = useState<ChartLayout>("dashboard");
  const [chartTimeRange, setChartTimeRange] = useState<ChartTimeRange>("24h");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => initialThemeMode());
  const [locale, setLocale] = useState<Locale>(() => initialLocale());
  const [sourceManagementMode, setSourceManagementMode] =
    useState<SourceManagementMode>(() => initialSourceManagementMode());
  const [visibleChannels, setVisibleChannels] = useState<string[]>([]);
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>("all");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("quality");
  const [isOperationsMenuOpen, setOperationsMenuOpen] = useState(false);
  const [lastImportReport, setLastImportReport] = useState<ImportReport | null>(null);
  const [followLive, setFollowLive] = useState(true);
  const operationsMenuRef = useRef<HTMLDivElement>(null);

  const machinesQuery = useQuery({
    queryKey: ["machines"],
    queryFn: fetchMachines,
    refetchInterval: LIVE_REFETCH_INTERVAL_MS,
  });
  const selectedMachine = useMemo(
    () =>
      machinesQuery.data?.find((machine) => machine.id === selectedMachineId) ?? null,
    [machinesQuery.data, selectedMachineId],
  );
  const selectedRuntime = selectedMachineId
    ? machineRuntime[selectedMachineId] ?? null
    : null;
  const runsQuery = useQuery({
    queryKey: ["runs", selectedMachineId],
    queryFn: () => fetchRuns(selectedMachineId!),
    enabled: selectedMachineId !== null,
    refetchInterval: LIVE_REFETCH_INTERVAL_MS,
  });
  const selectedRun = useMemo(
    () => runsQuery.data?.find((run) => run.id === selectedRunId) ?? null,
    [runsQuery.data, selectedRunId],
  );
  const selectedRunIsLive = selectedRun?.status === "running";
  const samplesQuery = useQuery({
    queryKey: ["run-samples", selectedRunId],
    queryFn: async () => {
      const queryKey = ["run-samples", selectedRunId] as const;
      const current = queryClient.getQueryData<SampleFrame[]>(queryKey) ?? [];
      const afterSequence = lastSourceSequence(current);

      if (afterSequence === null) {
        return fetchRunSamples(selectedRunId!, { latest: MAX_VISIBLE_SAMPLES });
      }

      const incoming = await fetchRunSamples(selectedRunId!, {
        afterSequence,
        limit: MAX_VISIBLE_SAMPLES,
      });
      return mergeIncrementalSamples(current, incoming, MAX_VISIBLE_SAMPLES);
    },
    enabled: selectedRunId !== null,
    refetchInterval: selectedRunIsLive ? LIVE_REFETCH_INTERVAL_MS : false,
  });
  const qualityEventsQuery = useQuery({
    queryKey: ["run-quality-events", selectedRunId],
    queryFn: () => fetchQualityEvents(selectedRunId!),
    enabled: selectedRunId !== null,
    refetchInterval: selectedRunIsLive ? LIVE_REFETCH_INTERVAL_MS : false,
  });
  const analysisQuery = useQuery({
    queryKey: ["run-analysis", selectedRunId],
    queryFn: () => fetchRunAnalysis(selectedRunId!),
    enabled: selectedRunId !== null,
    refetchInterval: selectedRunIsLive ? LIVE_REFETCH_INTERVAL_MS : false,
  });
  const createMachineMutation = useMutation({
    mutationFn: createMachine,
    onSuccess: async (machine) => {
      setSelectedMachineId(machine.id);
      setSelectedRunId(null);
      setFollowLive(true);
      await queryClient.invalidateQueries({ queryKey: ["machines"] });
    },
  });
  const importMutation = useMutation({
    mutationFn: ({ file, machineId }: { file: File; machineId: number }) =>
      uploadCsv(file, machineId),
    onSuccess: async (report) => {
      setLastImportReport(report);
      setFollowLive(false);
      setSelectedRunId(report.run_id);
      setInspectorTab("quality");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["machines"] }),
        queryClient.invalidateQueries({ queryKey: ["runs", selectedMachineId] }),
        queryClient.invalidateQueries({ queryKey: ["run-samples", report.run_id] }),
        queryClient.invalidateQueries({
          queryKey: ["run-quality-events", report.run_id],
        }),
        queryClient.invalidateQueries({ queryKey: ["run-analysis", report.run_id] }),
      ]);
    },
  });

  const samples = samplesQuery.data ?? [];
  const qualityEvents = qualityEventsQuery.data ?? [];
  const analysis = analysisQuery.data ?? null;
  const chartSamples = useMemo(
    () => samplesForChartRange(samples, chartTimeRange),
    [chartTimeRange, samples],
  );
  const chartProcessSegments = useMemo(
    () => segmentsForVisibleSamples(analysis?.segments ?? [], chartSamples, chartTimeRange),
    [analysis?.segments, chartSamples, chartTimeRange],
  );
  const copy = getCopy(locale);
  const rawChannelCodes = useMemo(() => getRawChannelCodes(samples), [samples]);
  const channelCodes = useMemo(
    () => withDerivedChannels(rawChannelCodes),
    [rawChannelCodes],
  );
  const pendingUnitChannels = rawChannelCodes.filter(
    (channel) => !getChannelConfig(channel).unit,
  );
  const activeVisibleChannels = visibleChannels.filter((channel) =>
    channelCodes.includes(channel),
  );
  const runtimeScanning = Object.values(machineRuntime).some(
    (runtime) => runtime.status === "scanning",
  );
  const isRefreshing =
    machinesQuery.isFetching ||
    runsQuery.isFetching ||
    samplesQuery.isFetching ||
    qualityEventsQuery.isFetching ||
    analysisQuery.isFetching ||
    runtimeScanning;
  const isSourceManagementUnlocked = sourceManagementMode === "manager";

  const handleRuntimeChange = useCallback(
    (machineId: number, state: BrowserCsvTailState) => {
      setMachineRuntime((current) => ({ ...current, [machineId]: state }));
    },
    [],
  );
  const handleMachineSync = useCallback(
    (
      machineId: number,
      runId: number | null,
      insertedCount: number,
      rejectedCount: number,
    ) => {
      void queryClient.invalidateQueries({ queryKey: ["machines"] });
      void queryClient.invalidateQueries({ queryKey: ["runs", machineId] });

      if (runId !== null && machineId === selectedMachineId && followLive) {
        setSelectedRunId(runId);
      }
      if (runId !== null && insertedCount > 0) {
        void queryClient.invalidateQueries({ queryKey: ["run-samples", runId] });
      }
      if (runId !== null && insertedCount + rejectedCount > 0) {
        void queryClient.invalidateQueries({ queryKey: ["run-quality-events", runId] });
        void queryClient.invalidateQueries({ queryKey: ["run-analysis", runId] });
      }
    },
    [followLive, queryClient, selectedMachineId],
  );
  const toggleSourceManagement = useCallback(() => {
    setSourceManagementMode((current) =>
      current === "manager" ? "viewer" : "manager",
    );
  }, []);

  useEffect(() => {
    const machines = machinesQuery.data ?? [];
    if (machines.length === 0) {
      setSelectedMachineId(null);
      return;
    }
    if (
      selectedMachineId === null ||
      !machines.some((machine) => machine.id === selectedMachineId)
    ) {
      setSelectedMachineId(preferredMachineId(machines));
    }
  }, [machinesQuery.data, selectedMachineId]);

  useEffect(() => {
    const runs = runsQuery.data ?? [];
    if (runs.length === 0) {
      setSelectedRunId(null);
      return;
    }

    const liveRunId = selectedRuntime?.activeRunId ?? selectedMachine?.active_run_id;
    if (followLive && liveRunId && runs.some((run) => run.id === liveRunId)) {
      setSelectedRunId(liveRunId);
      return;
    }
    if (selectedRunId === null || !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(preferredRunId(runs));
    }
  }, [followLive, runsQuery.data, selectedMachine?.active_run_id, selectedRunId, selectedRuntime?.activeRunId]);

  useEffect(() => {
    if (channelCodes.length === 0) {
      setVisibleChannels([]);
      return;
    }
    setVisibleChannels((current) => {
      const filtered = current.filter((channel) => channelCodes.includes(channel));
      return filtered.length === 0 ? channelCodes : filtered;
    });
  }, [channelCodes]);

  useEffect(() => {
    setQualityFilter("all");
  }, [selectedRunId]);

  useEffect(() => {
    if (!isOperationsMenuOpen) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOperationsMenuOpen(false);
      }
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        operationsMenuRef.current &&
        !operationsMenuRef.current.contains(event.target)
      ) {
        setOperationsMenuOpen(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [isOperationsMenuOpen]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // The selected theme still applies for this page view.
    }
  }, [themeMode]);

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // The selected locale still applies for this page view.
    }
  }, [locale]);

  useEffect(() => {
    try {
      writeSourceManagementMode(window.localStorage, sourceManagementMode);
    } catch {
      writeSourceManagementMode(null, sourceManagementMode);
    }
  }, [sourceManagementMode]);

  const sourceLabel = machinesQuery.isError
    ? copy.connection.error
    : isRefreshing
      ? copy.connection.syncing
      : copy.connection.connected;
  const refreshData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["machines"] }),
      queryClient.invalidateQueries({ queryKey: ["runs", selectedMachineId] }),
    ]);
    if (selectedRunId !== null) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["run-samples", selectedRunId] }),
        queryClient.invalidateQueries({
          queryKey: ["run-quality-events", selectedRunId],
        }),
        queryClient.invalidateQueries({ queryKey: ["run-analysis", selectedRunId] }),
      ]);
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {locale === "en" ? "Skip to process" : "Prosese geç"}
      </a>
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <span>FD</span>
            <b>°</b>
          </div>
          <div className="topbar-title">
            <p className="eyebrow">{copy.app.eyebrow}</p>
            <h1>{copy.app.title}</h1>
            <p>{copy.app.subtitle}</p>
          </div>
        </div>

        <FleetPulse
          locale={locale}
          machines={machinesQuery.data ?? []}
          runtime={machineRuntime}
        />

        <div className="topbar-actions">
          <div className="connection-strip" aria-busy={isRefreshing}>
            <div className="connection-state">
              <span
                aria-hidden="true"
                className={machinesQuery.isError ? "status-dot" : "status-dot online"}
              />
              <span>
                <strong>{sourceLabel}</strong>
                <small>{getCollectorUrl().replace(/^https?:\/\//, "")}</small>
              </span>
            </div>
            <button
              aria-label={copy.connection.refresh}
              className="refresh-button"
              disabled={isRefreshing}
              onClick={() => void refreshData()}
              type="button"
            >
              ↻
            </button>
          </div>
          <ThemeToggle
            copy={copy.theme}
            themeMode={themeMode}
            onToggle={() =>
              setThemeMode((current) => (current === "dark" ? "light" : "dark"))
            }
          />
          <LanguageToggle copy={copy.language} locale={locale} onChange={setLocale} />
          <div className="operations-menu-shell" ref={operationsMenuRef}>
            <button
              aria-expanded={isOperationsMenuOpen}
              aria-haspopup="dialog"
              className="menu-button"
              onClick={() => setOperationsMenuOpen((open) => !open)}
              type="button"
            >
              <span className="menu-icon" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span>{copy.operations.button}</span>
              {qualityEvents.length > 0 ? <strong>{qualityEvents.length}</strong> : null}
            </button>

            {isOperationsMenuOpen ? (
              <div
                aria-label={copy.operations.dialogLabel}
                className="operations-menu"
                role="dialog"
              >
                <div className="operations-menu-header">
                  <div>
                    <strong>{copy.operations.title}</strong>
                    <span>
                      {selectedMachine?.name ?? copy.operations.noRun}
                      {selectedRun ? ` · ${selectedRun.name}` : ""}
                    </span>
                  </div>
                  <button
                    className="ghost-button compact"
                    onClick={() => setOperationsMenuOpen(false)}
                    type="button"
                  >
                    {copy.operations.close}
                  </button>
                </div>

                <div className="inspector-tabs" role="tablist" aria-label={copy.operations.tabLabel}>
                  {(["quality", "analysis", "runs", "source"] as InspectorTab[]).map(
                    (tab) => (
                      <InspectorTabButton
                        active={inspectorTab === tab}
                        key={tab}
                        label={copy.operations.tabs[tab]}
                        onClick={() => setInspectorTab(tab)}
                      />
                    ),
                  )}
                </div>

                {inspectorTab === "quality" ? (
                  <QualitySummary
                    copy={{ ...copy.quality, retry: copy.common.retry }}
                    error={qualityEventsQuery.error}
                    events={qualityEvents}
                    filter={qualityFilter}
                    isLoading={qualityEventsQuery.isLoading}
                    locale={locale}
                    onFilterChange={setQualityFilter}
                    onRetry={() => qualityEventsQuery.refetch()}
                    visibleLimit={5}
                  />
                ) : null}
                {inspectorTab === "analysis" ? (
                  <AnalysisSummary
                    analysis={analysis}
                    copy={{ ...copy.analysis, retry: copy.common.retry }}
                    error={analysisQuery.error}
                    isLoading={analysisQuery.isLoading}
                    locale={locale}
                    onRetry={() => analysisQuery.refetch()}
                  />
                ) : null}
                {inspectorTab === "runs" ? (
                  <div className="operations-panel-section">
                    <div className="section-heading compact">
                      <div>
                        <h2>{copy.runs.title}</h2>
                        <p>{copy.runs.count(runsQuery.data?.length ?? 0)}</p>
                      </div>
                    </div>
                    <RunList
                      copy={{ ...copy.runs, retry: copy.common.retry }}
                      error={runsQuery.error}
                      isLoading={runsQuery.isLoading}
                      locale={locale}
                      onSelect={(runId) => {
                        setFollowLive(false);
                        setSelectedRunId(runId);
                        setOperationsMenuOpen(false);
                      }}
                      onRetry={() => runsQuery.refetch()}
                      runs={runsQuery.data ?? []}
                      selectedRunId={selectedRunId}
                    />
                  </div>
                ) : null}
                {inspectorTab === "source" ? (
                  <div className="operations-panel-section source-operations">
                    <SourceAccessControl
                      copy={copy.fleet.sourceAccess}
                      isUnlocked={isSourceManagementUnlocked}
                      onToggle={toggleSourceManagement}
                      variant="panel"
                    />
                    <SourceStatus
                      copy={copy.fleet}
                      locale={locale}
                      machine={selectedMachine}
                      state={selectedRuntime}
                    />
                    <RunActions copy={copy.source} locale={locale} run={selectedRun} />
                    {isSourceManagementUnlocked ? (
                      <ImportPanel
                        copy={copy.import}
                        error={importMutation.error}
                        isPending={importMutation.isPending}
                        lastReport={lastImportReport}
                        onUpload={(file) => {
                          if (selectedMachineId !== null) {
                            importMutation.mutate({ file, machineId: selectedMachineId });
                          }
                        }}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="control-room">
        <MachineRail
          copy={copy.fleet}
          createError={createMachineMutation.error}
          error={machinesQuery.error}
          isCreating={createMachineMutation.isPending}
          isLoading={machinesQuery.isLoading}
          isSourceManagementUnlocked={isSourceManagementUnlocked}
          locale={locale}
          machines={machinesQuery.data ?? []}
          onCreate={async (payload: CreateMachinePayload) => {
            await createMachineMutation.mutateAsync(payload);
          }}
          onRetry={() => void machinesQuery.refetch()}
          onRuntimeChange={handleRuntimeChange}
          onSelect={(machineId) => {
            setSelectedMachineId(machineId);
            setSelectedRunId(null);
            setFollowLive(true);
          }}
          onSynced={handleMachineSync}
          onToggleSourceManagement={toggleSourceManagement}
          selectedMachineId={selectedMachineId}
        />

        <main className="workspace" id="main-content">
          {selectedMachine ? (
            <>
              <MachineMasthead
                copy={copy}
                locale={locale}
                machine={selectedMachine}
                onRunChange={(runId) => {
                  setFollowLive(false);
                  setSelectedRunId(runId);
                }}
                runs={runsQuery.data ?? []}
                selectedRunId={selectedRunId}
                state={selectedRuntime}
              />

              <ProcessHeader
                activeChannelCount={activeVisibleChannels.length}
                analysis={analysis}
                copy={copy.process}
                locale={locale}
                qualityEvents={qualityEvents}
                run={selectedRun}
                samples={samples}
              />

              <LiveSnapshot copy={copy.snapshot} locale={locale} samples={samples} />

              <section className="chart-panel">
                <div className="section-heading chart-heading">
                  <div className="chart-heading-copy">
                    <p className="section-index">
                      {locale === "en" ? "02 / TELEMETRY" : "02 / TELEMETRİ"}
                    </p>
                    <h2>{copy.chart.title}</h2>
                    <p>{copy.chart.subtitle}</p>
                    {samples.length > 0 ? (
                      <div className="chart-context" aria-live="polite">
                        <span>
                          {copy.chart.visibleSamples(
                            chartSamples.length,
                            selectedRun?.row_count ?? samples.length,
                          )}
                        </span>
                        {selectedRuntime?.activeFileName &&
                        selectedRunId === selectedRuntime.activeRunId ? (
                          <span title={selectedRuntime.activeFileName}>
                            {copy.chart.activeFile(selectedRuntime.activeFileName)}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <ChartViewControls
                    chartLayout={chartLayout}
                    chartTimeRange={chartTimeRange}
                    copy={copy.chart}
                    onChartLayoutChange={setChartLayout}
                    onChartTimeRangeChange={setChartTimeRange}
                  />
                </div>

                <UnitNote
                  copy={copy.chart}
                  locale={locale}
                  pendingChannels={pendingUnitChannels}
                />
                <ChannelControls
                  channels={channelCodes}
                  copy={copy.chart}
                  locale={locale}
                  onChange={setVisibleChannels}
                  visibleChannels={activeVisibleChannels}
                />

                {samplesQuery.isLoading ? (
                  <ChartState
                    message={copy.chart.states.runLoadingMessage}
                    title={copy.chart.states.runLoadingTitle}
                  />
                ) : samplesQuery.isError ? (
                  <ChartState
                    actionLabel={copy.common.retry}
                    message={samplesQuery.error.message}
                    onAction={() => samplesQuery.refetch()}
                    tone="error"
                    title={copy.chart.states.samplesErrorTitle}
                  />
                ) : samples.length === 0 ? (
                  <ChartState
                    message={copy.chart.states.emptyMessage}
                    title={copy.chart.states.emptyTitle}
                  />
                ) : activeVisibleChannels.length === 0 ? (
                  <ChartState
                    message={copy.chart.states.noChannelMessage}
                    title={copy.chart.states.noChannelTitle}
                  />
                ) : (
                  <ChartArea
                    copy={copy.chart}
                    layout={chartLayout}
                    locale={locale}
                    processSegments={chartProcessSegments}
                    qualityEvents={qualityEvents}
                    samples={chartSamples}
                    themeMode={themeMode}
                    visibleChannels={activeVisibleChannels}
                  />
                )}
              </section>
            </>
          ) : (
            <ChartState
              message={copy.fleet.empty}
              title={copy.fleet.add}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function FleetPulse({
  locale,
  machines,
  runtime,
}: {
  locale: Locale;
  machines: MachineSummary[];
  runtime: Record<number, BrowserCsvTailState>;
}) {
  const live = machines.filter(
    (machine) => runtime[machine.id]?.status === "tailing" || machine.active_run_id !== null,
  ).length;
  const issues = machines.reduce(
    (total, machine) => total + machine.warning_count + machine.error_count,
    0,
  );

  return (
    <div className="fleet-pulse" aria-label={locale === "en" ? "Fleet status" : "Filo durumu"}>
      <div>
        <span>{locale === "en" ? "Fleet" : "Filo"}</span>
        <strong>{machines.length.toString().padStart(2, "0")}</strong>
      </div>
      <div>
        <span>{locale === "en" ? "Live" : "Canlı"}</span>
        <strong>{live.toString().padStart(2, "0")}</strong>
      </div>
      <div className={issues > 0 ? "has-issues" : ""}>
        <span>{locale === "en" ? "Alerts" : "Uyarı"}</span>
        <strong>{issues.toString().padStart(2, "0")}</strong>
      </div>
    </div>
  );
}

function MachineMasthead({
  copy,
  locale,
  machine,
  onRunChange,
  runs,
  selectedRunId,
  state,
}: {
  copy: ReturnType<typeof getCopy>;
  locale: Locale;
  machine: MachineSummary;
  onRunChange: (runId: number) => void;
  runs: Awaited<ReturnType<typeof fetchRuns>>;
  selectedRunId: number | null;
  state: BrowserCsvTailState | null;
}) {
  const isLive = state?.status === "tailing" || machine.active_run_id !== null;

  return (
    <section className="machine-masthead">
      <div className="machine-masthead-identity">
        <p className="section-index">
          {locale === "en" ? "01 / MACHINE" : "01 / MAKİNE"}
        </p>
        <div>
          <h2>{machine.name}</h2>
          <span>{machine.code}</span>
        </div>
        <p>
          {[machine.model, machine.location].filter(Boolean).join(" · ") || copy.fleet.noLocation}
        </p>
      </div>
      <div className="machine-masthead-status">
        <span className={isLive ? "status-dot online" : "status-dot idle"} />
        <div>
          <strong>{isLive ? copy.fleet.statuses.live : copy.fleet.statuses.paused}</strong>
          <span>
            {state?.lastSampledAt
              ? formatDate(state.lastSampledAt, locale)
              : machine.last_sampled_at
                ? formatDate(machine.last_sampled_at, locale)
                : copy.csvTail.noData}
          </span>
        </div>
      </div>
      <label className="run-select">
        <span>{copy.process.selectedRun}</span>
        <select
          disabled={runs.length === 0}
          onChange={(event) => onRunChange(Number(event.target.value))}
          value={selectedRunId ?? ""}
        >
          {runs.length === 0 ? <option value="">{copy.process.noRun}</option> : null}
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.name} · {run.started_at ? formatDate(run.started_at, locale) : "—"}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

function SourceStatus({
  copy,
  locale,
  machine,
  state,
}: {
  copy: ReturnType<typeof getCopy>["fleet"];
  locale: Locale;
  machine: MachineSummary | null;
  state: BrowserCsvTailState | null;
}) {
  return (
    <div className="source-status-summary">
      <span>{locale === "en" ? "Selected machine" : "Seçili makine"}</span>
      <strong>{machine?.name ?? "—"}</strong>
      <p>
        {state?.directoryName ??
          (machine && hasServerMachineData(machine)
            ? copy.remoteSource
            : locale === "en"
              ? "No folder connected"
              : "Klasör bağlı değil")}
      </p>
      {state?.activeFileName ? <code>{state.activeFileName}</code> : null}
    </div>
  );
}

function ThemeToggle({
  copy,
  onToggle,
  themeMode,
}: {
  copy: ReturnType<typeof getCopy>["theme"];
  onToggle: () => void;
  themeMode: ThemeMode;
}) {
  const isDark = themeMode === "dark";
  return (
    <button
      aria-label={isDark ? copy.toLight : copy.toDark}
      aria-pressed={isDark}
      className="theme-toggle"
      onClick={onToggle}
      type="button"
    >
      <span className="theme-toggle-track" aria-hidden="true">
        <span className="theme-toggle-thumb" />
      </span>
      <span>{isDark ? copy.dark : copy.light}</span>
    </button>
  );
}

function LanguageToggle({
  copy,
  locale,
  onChange,
}: {
  copy: ReturnType<typeof getCopy>["language"];
  locale: Locale;
  onChange: (locale: Locale) => void;
}) {
  return (
    <div className="language-toggle" aria-label={copy.label} role="group">
      <button
        aria-pressed={locale === "tr"}
        className={locale === "tr" ? "active" : ""}
        onClick={() => onChange("tr")}
        type="button"
      >
        {copy.tr}
      </button>
      <button
        aria-pressed={locale === "en"}
        className={locale === "en" ? "active" : ""}
        onClick={() => onChange("en")}
        type="button"
      >
        {copy.en}
      </button>
    </div>
  );
}

function InspectorTabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-selected={active}
      className={active ? "active" : ""}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {label}
    </button>
  );
}

function initialThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme;
    }
  } catch {
    // Fall through to system preference.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function initialLocale(): Locale {
  if (typeof window === "undefined") {
    return DEFAULT_LOCALE;
  }
  try {
    const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (storedLocale === "tr" || storedLocale === "en") {
      return storedLocale;
    }
  } catch {
    // Fall through to the application default.
  }
  return DEFAULT_LOCALE;
}

function initialSourceManagementMode(): SourceManagementMode {
  if (typeof window === "undefined") {
    return DEFAULT_SOURCE_MANAGEMENT_MODE;
  }

  try {
    return readSourceManagementMode(window.localStorage);
  } catch {
    return DEFAULT_SOURCE_MANAGEMENT_MODE;
  }
}
