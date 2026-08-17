import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  fetchQualityEvents,
  fetchRunAnalysis,
  fetchRunSamples,
  fetchRuns,
  getCollectorUrl,
  uploadCsv,
} from "./api";
import type { ImportReport, SampleFrame } from "./api";
import { getChannelConfig } from "./channelConfig";
import { ChartState } from "./components/StatusViews";
import { AnalysisSummary } from "./features/analysis/AnalysisSummary";
import {
  ChartArea,
  ChartModeControl,
  ChannelControls,
  UnitNote,
} from "./features/charts/ChartControls";
import {
  getRawChannelCodes,
  withDerivedChannels,
} from "./features/charts/channelSelection";
import { ImportPanel } from "./features/import/ImportPanel";
import { QualitySummary } from "./features/quality/QualitySummary";
import { ProcessHeader } from "./features/runs/ProcessHeader";
import { RunActions } from "./features/runs/RunActions";
import { RunList } from "./features/runs/RunList";
import { CsvTailPanel } from "./features/source/CsvTailPanel";
import { DEFAULT_LOCALE, getCopy, type Locale } from "./i18n";
import { lastSourceSequence, mergeIncrementalSamples } from "./incrementalSamples";
import {
  type ChartLayout,
  type InspectorTab,
  type QualityFilter,
  type ThemeMode,
} from "./types";
import { useBrowserCsvTail } from "./useBrowserCsvTail";

const THEME_STORAGE_KEY = "freezedry.theme";
const LOCALE_STORAGE_KEY = "freezedry.locale";
const LIVE_REFETCH_INTERVAL_MS = 30_000;
const MAX_VISIBLE_SAMPLES = 5_000;

export function App() {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [chartLayout, setChartLayout] = useState<ChartLayout>("overlay");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => initialThemeMode());
  const [locale, setLocale] = useState<Locale>(() => initialLocale());
  const [visibleChannels, setVisibleChannels] = useState<string[]>([]);
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>("all");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("quality");
  const [isOperationsMenuOpen, setOperationsMenuOpen] = useState(false);
  const [lastImportReport, setLastImportReport] = useState<ImportReport | null>(null);
  const [followLive, setFollowLive] = useState(true);
  const operationsMenuRef = useRef<HTMLDivElement>(null);
  const browserTail = useBrowserCsvTail({
    onSynced: (runId, insertedCount, rejectedCount) => {
      if (runId !== null) {
        if (followLive) {
          setSelectedRunId(runId);
        }
        void queryClient.invalidateQueries({ queryKey: ["runs"] });
      }

      if (runId !== null && insertedCount > 0) {
        void queryClient.invalidateQueries({ queryKey: ["run-samples", runId] });
      }

      if (runId !== null && insertedCount + rejectedCount > 0) {
        void queryClient.invalidateQueries({
          queryKey: ["run-quality-events", runId],
        });
        void queryClient.invalidateQueries({
          queryKey: ["run-analysis", runId],
        });
      }
    },
  });

  const runsQuery = useQuery({
    queryKey: ["runs"],
    queryFn: fetchRuns,
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
  const importMutation = useMutation({
    mutationFn: uploadCsv,
    onSuccess: async (report) => {
      setLastImportReport(report);
      setFollowLive(false);
      setSelectedRunId(report.run_id);
      setInspectorTab("quality");
      setOperationsMenuOpen(true);
      await queryClient.invalidateQueries({ queryKey: ["runs"] });
      await queryClient.invalidateQueries({ queryKey: ["run-samples", report.run_id] });
      await queryClient.invalidateQueries({
        queryKey: ["run-quality-events", report.run_id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["run-analysis", report.run_id],
      });
    },
  });
  const samples = samplesQuery.data ?? [];
  const qualityEvents = qualityEventsQuery.data ?? [];
  const analysis = analysisQuery.data ?? null;
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
  const isRefreshing =
    runsQuery.isFetching ||
    samplesQuery.isFetching ||
    qualityEventsQuery.isFetching ||
    analysisQuery.isFetching ||
    browserTail.state.status === "scanning";

  useEffect(() => {
    const activeRunId = browserTail.state.activeRunId;

    if (!followLive || activeRunId === null || activeRunId === undefined) {
      return;
    }

    if (!(runsQuery.data ?? []).some((run) => run.id === activeRunId)) {
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      return;
    }

    if (selectedRunId !== activeRunId) {
      setSelectedRunId(activeRunId);
    }
  }, [
    browserTail.state.activeRunId,
    followLive,
    queryClient,
    runsQuery.data,
    selectedRunId,
  ]);

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
      const target = event.target;

      if (
        target instanceof Node &&
        operationsMenuRef.current &&
        !operationsMenuRef.current.contains(target)
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
      // Theme persistence is optional; the UI still works if storage is blocked.
    }
  }, [themeMode]);

  useEffect(() => {
    document.documentElement.lang = locale;

    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Locale persistence is optional; the UI still works if storage is blocked.
    }
  }, [locale]);

  const sourceLabel = runsQuery.isError
    ? copy.connection.error
    : isRefreshing
      ? copy.connection.syncing
      : copy.connection.connected;
  const refreshData = async () => {
    await browserTail.rescan();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["runs"] }),
    ]);

    if (selectedRunId !== null) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["run-samples", selectedRunId] }),
        queryClient.invalidateQueries({
          queryKey: ["run-quality-events", selectedRunId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["run-analysis", selectedRunId],
        }),
      ]);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-title">
          <p className="eyebrow">{copy.app.eyebrow}</p>
          <h1>{copy.app.title}</h1>
          <p>{copy.app.subtitle}</p>
        </div>
        <div className="topbar-actions">
          <ThemeToggle
            copy={copy.theme}
            themeMode={themeMode}
            onToggle={() =>
              setThemeMode((current) => (current === "dark" ? "light" : "dark"))
            }
          />
          <LanguageToggle
            copy={copy.language}
            locale={locale}
            onChange={setLocale}
          />
          <div className="connection-strip" aria-busy={isRefreshing}>
            <div className="connection-state">
              <span
                aria-hidden="true"
                className={runsQuery.isError ? "status-dot" : "status-dot online"}
              />
              <strong>{sourceLabel}</strong>
              <span>{getCollectorUrl().replace(/^https?:\/\//, "")}</span>
            </div>
            <button
              className="ghost-button"
              disabled={isRefreshing}
              onClick={refreshData}
              type="button"
            >
              {copy.connection.refresh}
            </button>
          </div>
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
                    <span>{selectedRun?.name ?? copy.operations.noRun}</span>
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
                  <InspectorTabButton
                    active={inspectorTab === "quality"}
                    label={copy.operations.tabs.quality}
                    onClick={() => setInspectorTab("quality")}
                  />
                  <InspectorTabButton
                    active={inspectorTab === "analysis"}
                    label={copy.operations.tabs.analysis}
                    onClick={() => setInspectorTab("analysis")}
                  />
                  <InspectorTabButton
                    active={inspectorTab === "runs"}
                    label={copy.operations.tabs.runs}
                    onClick={() => setInspectorTab("runs")}
                  />
                  <InspectorTabButton
                    active={inspectorTab === "source"}
                    label={copy.operations.tabs.source}
                    onClick={() => setInspectorTab("source")}
                  />
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
                    visibleLimit={2}
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
                        setInspectorTab("quality");
                        setOperationsMenuOpen(false);
                      }}
                      onRetry={() => runsQuery.refetch()}
                      runs={runsQuery.data ?? []}
                      selectedRunId={selectedRunId}
                    />
                  </div>
                ) : null}

                {inspectorTab === "source" ? (
                  <div className="operations-panel-section">
                    <CsvTailPanel
                      copy={copy.csvTail}
                      locale={locale}
                      onChoose={browserTail.chooseDirectory}
                      onFollowActive={(runId) => {
                        setFollowLive(true);
                        setSelectedRunId(runId);
                        setOperationsMenuOpen(false);
                      }}
                      onRescan={browserTail.rescan}
                      onResume={browserTail.resume}
                      onStop={browserTail.stop}
                      state={browserTail.state}
                    />
                    <RunActions copy={copy.source} locale={locale} run={selectedRun} />
                    <ImportPanel
                      copy={copy.import}
                      error={importMutation.error}
                      isPending={importMutation.isPending}
                      lastReport={lastImportReport}
                      onUpload={(file) => importMutation.mutate(file)}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <section className="workspace">
        <div className="chart-panel">
          <ProcessHeader
            activeChannelCount={activeVisibleChannels.length}
            copy={copy.process}
            locale={locale}
            qualityEvents={qualityEvents}
            run={selectedRun}
            samples={samples}
            analysis={analysis}
          />

          <div className="section-heading chart-heading">
            <div className="chart-heading-copy">
              <h2>{copy.chart.title}</h2>
              <p>{copy.chart.subtitle}</p>
              {samples.length > 0 ? (
                <div className="chart-context" aria-live="polite">
                  <span>
                    {copy.chart.visibleSamples(samples.length, selectedRun?.row_count ?? samples.length)}
                  </span>
                  {selectedRunId === browserTail.state.activeRunId &&
                  browserTail.state.activeFileName ? (
                    <span title={browserTail.state.activeFileName}>
                      {copy.chart.activeFile(browserTail.state.activeFileName)}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <ChartModeControl
              chartLayout={chartLayout}
              copy={copy.chart}
              onChartLayoutChange={setChartLayout}
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
            visibleChannels={activeVisibleChannels}
            onChange={setVisibleChannels}
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
              qualityEvents={qualityEvents}
              processSegments={analysis?.segments ?? []}
              samples={samples}
              themeMode={themeMode}
              visibleChannels={activeVisibleChannels}
            />
          )}
        </div>
      </section>
    </main>
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
