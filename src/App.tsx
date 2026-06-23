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
type ThemeMode = "light" | "dark";

type AnalysisFunctions = {
  shelfAverage: boolean;
};

const THEME_STORAGE_KEY = "freezedry.theme";

const DEFAULT_ANALYSIS_FUNCTIONS: AnalysisFunctions = {
  shelfAverage: true,
};

const CHART_GROUPS: Array<{
  group: ChannelGroup;
  title: string;
  note: string;
}> = [
  { group: "shelf", title: "Raflar", note: "Raf probları ve seçili analiz fonksiyonları" },
  { group: "pressure", title: "Basınç", note: "Düşük ve yüksek basınç kanalları" },
  { group: "vacuum", title: "Vakum", note: "Log ölçekte vakum kanalı" },
  { group: "cooling", title: "Soğutma", note: "Soğutma ve kondenser kanalları" },
  { group: "other", title: "Diğer", note: "Henüz eşlenmemiş import sinyalleri" },
];

const TelemetryChart = lazy(() =>
  import("./TelemetryChart").then((module) => ({ default: module.TelemetryChart })),
);

export function App() {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [chartLayout, setChartLayout] = useState<ChartLayout>("overlay");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => initialThemeMode());
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

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // Theme persistence is optional; the UI still works if storage is blocked.
    }
  }, [themeMode]);

  const sourceLabel = runsQuery.isError
    ? "Collector erişilemiyor"
    : isRefreshing
      ? "Senkronize ediliyor"
      : "Collector bağlı";
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
          <h1>Çalışma İncelemesi</h1>
          <p>Freeze dry makine loglarını yerel olarak incele.</p>
        </div>
        <div className="topbar-actions">
          <ThemeToggle
            themeMode={themeMode}
            onToggle={() =>
              setThemeMode((current) => (current === "dark" ? "light" : "dark"))
            }
          />
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
              Yenile
            </button>
          </div>
        </div>
      </header>

      <section className="summary-grid">
        <Metric
          hint="kayıtlı"
          label="Çalışmalar"
          value={runsQuery.isLoading ? "..." : String(runsQuery.data?.length ?? 0)}
        />
        <Metric
          hint="seçili"
          label="Örnekler"
          value={
            samplesQuery.isLoading
              ? "..."
              : String(selectedRun?.row_count ?? samples.length)
          }
        />
        <Metric
          hint={
            derivedChannelCount > 0
              ? `${rawChannelCodes.length} ham + ${derivedChannelCount} türetilmiş`
              : `${rawChannelCodes.length} ham`
          }
          label="Sinyaller"
          value={String(channelCodes.length)}
        />
        <Metric
          hint={selectedRun ? "seçili çalışma" : "seçili çalışma yok"}
          label="Uyarılar"
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
              <h2>{selectedRun?.name ?? "Çalışma seçilmedi"}</h2>
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
              message="Kayıtlı örnekler collector servisinden yükleniyor."
              title="Çalışma yükleniyor"
            />
          ) : samplesQuery.isError ? (
            <ChartState
              actionLabel="Tekrar dene"
              message={samplesQuery.error.message}
              onAction={() => samplesQuery.refetch()}
              tone="error"
              title="Örnekler yüklenemedi"
            />
          ) : samples.length === 0 ? (
            <ChartState
              message="Bir CSV dosyası içe aktar veya kayıtlı bir çalışma seç."
              title="Örnek yok"
            />
          ) : activeVisibleChannels.length === 0 ? (
            <ChartState
              message="Grafik çizmek için en az bir kanal seç."
              title="Kanal seçilmedi"
            />
          ) : (
            <ChartArea
              layout={chartLayout}
              qualityEvents={qualityEvents}
              samples={samples}
              themeMode={themeMode}
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
              <h2>Kayıtlı Çalışmalar</h2>
              <p>{runsQuery.data?.length ?? 0} indeksli</p>
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

function ThemeToggle({
  onToggle,
  themeMode,
}: {
  onToggle: () => void;
  themeMode: ThemeMode;
}) {
  const isDark = themeMode === "dark";

  return (
    <button
      aria-label={isDark ? "Aydınlık moda geç" : "Koyu moda geç"}
      aria-pressed={isDark}
      className="theme-toggle"
      onClick={onToggle}
      type="button"
    >
      <span className="theme-toggle-track" aria-hidden="true">
        <span className="theme-toggle-thumb" />
      </span>
      <span>{isDark ? "Koyu" : "Aydınlık"}</span>
    </button>
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
      setLocalError("Makine logu için .csv uzantılı dosya seç.");
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
          <h2>CSV İçe Aktar</h2>
          <p>Bu bilgisayardaki makine logu.</p>
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
          aria-label="CSV dosyası seç"
          disabled={isPending}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            handleFile(file);
          }}
          type="file"
        />
        <strong>{isPending ? "İçe aktarılıyor..." : "CSV sürükle veya seç"}</strong>
        <span>Noktalı virgül ayraçlı makine logu.</span>
      </label>
      {lastReport ? <ImportReportView report={lastReport} /> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
    </section>
  );
}

function ImportReportView({ report }: { report: ImportReport }) {
  return (
    <div className="import-report">
      <strong>{report.duplicate ? "Zaten içe aktarılmış" : "İçe aktarma tamamlandı"}</strong>
      <span>{report.file_name}</span>
      <dl>
        <div>
          <dt>Satır</dt>
          <dd>{report.row_count}</dd>
        </div>
        <div>
          <dt>Kanal</dt>
          <dd>{report.channel_count}</dd>
        </div>
        <div>
          <dt>Uyarı</dt>
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
      <OverviewItem label="Süre" value={durationLabel(run)} />
      <OverviewItem
        label="İlk örnek"
        value={
          firstSample ? formatDate(firstSample.sampled_at) : shortDate(run?.started_at)
        }
      />
      <OverviewItem
        label="Son örnek"
        value={
          lastSample ? formatDate(lastSample.sampled_at) : shortDate(run?.finished_at)
        }
      />
      <OverviewItem label="Uyarı" value={String(warningCount)} />
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
        Birimler kanal ayarlarından geliyor. Raf, soğutma ve kondenser değerleri
        degC olarak işaretlendi.
      </p>
    );
  }

  return (
    <p className="unit-note">
      CSV içinde birim bilgisi yok. Sıcaklık kanalları degC kabul edildi;
      {" "}
      {pendingChannels.join(", ")} kanallarının birimini doğrulamak gerekiyor.
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
          <strong>Grafik düzeni</strong>
          <span>Tek grafik veya gruplu paneller arasında seç.</span>
        </div>
        <div className="segmented-control" role="group" aria-label="Grafik düzeni">
          <button
            aria-pressed={chartLayout === "overlay"}
            className={chartLayout === "overlay" ? "active" : ""}
            onClick={() => onChartLayoutChange("overlay")}
            type="button"
          >
            Tek grafik
          </button>
          <button
            aria-pressed={chartLayout === "grouped"}
            className={chartLayout === "grouped" ? "active" : ""}
            onClick={() => onChartLayoutChange("grouped")}
            type="button"
          >
            Grupla
          </button>
        </div>
      </div>

      <div className="config-block">
        <div>
          <strong>Analiz fonksiyonları</strong>
          <span>Türetilmiş sinyaller ayrı ayrı açılıp kapatılabilir.</span>
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
          <small>Geçerli RAF1-RAF4 değerleri</small>
        </button>
      </div>
    </div>
  );
}

function ChartArea({
  layout,
  qualityEvents,
  samples,
  themeMode,
  visibleChannels,
}: {
  layout: ChartLayout;
  qualityEvents: QualityEvent[];
  samples: SampleFrame[];
  themeMode: ThemeMode;
  visibleChannels: string[];
}) {
  const groupedCharts = chartGroupsFor(visibleChannels);

  return (
    <>
      <div className="chart-hints" aria-label="Grafik etkileşim ipuçları">
        <span>Tekerlek veya iki parmakla yakınlaştır</span>
        <span>Sürükleyerek kaydır</span>
        <span>{layout === "overlay" ? "Aralık için slider kullan" : "Gruplar aynı zaman eksenini kullanır"}</span>
      </div>
      <Suspense
        fallback={
          <ChartState
            message="Grafik alanı hazırlanıyor."
            title="Grafik yükleniyor"
          />
        }
      >
        {layout === "overlay" ? (
          <TelemetryChart
            qualityEvents={qualityEvents}
            samples={samples}
            themeMode={themeMode}
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
                  themeMode={themeMode}
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
        <strong>Sinyaller</strong>
        <span>
          {channels.length} sinyalin {visibleChannels.length} tanesi görünür
        </span>
      </div>
      <div className="channel-quick-actions">
        <button onClick={() => onChange(channels)} type="button">
          Tümü
        </button>
        <button onClick={() => chooseGroup("shelf")} type="button">
          Raflar
        </button>
        <button onClick={() => chooseGroup("pressure")} type="button">
          Basınç
        </button>
        <button onClick={() => chooseGroup("cooling")} type="button">
          Soğutma
        </button>
        <button onClick={() => onChange([])} type="button">
          Temizle
        </button>
      </div>
      <div className="channel-controls">
        {channels.map((channel) => {
          const active = visibleChannels.includes(channel);
          const config = getChannelConfig(channel);
          const secondaryLabel = [
            config.unit,
            config.derived ? "türetilmiş" : null,
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
        <span>{run ? runStatusLabel(run.status) : "beklemede"}</span>
        <strong>{run ? sourceKindLabel(run.source_kind) : "Kaynak yok"}</strong>
      </div>
      {run ? (
        <a className="export-link" href={getRunExportUrl(run.id)}>
          CSV indir
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
    return <p className="empty-state">Kayıtlı çalışmalar yükleniyor...</p>;
  }

  if (error) {
    return (
      <InlineError
        actionLabel="Tekrar dene"
        message={error.message}
        onAction={onRetry}
        title="Çalışmalar yüklenemedi"
      />
    );
  }

  if (runs.length === 0) {
    return <p className="empty-state">Henüz kayıtlı çalışma yok.</p>;
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
              {run.row_count} satır, {run.warning_count} uyarı
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
  const gapCount = counts.time_gap ?? 0;
  const suspectCount = counts.suspect_value ?? 0;
  const filteredEvents =
    filter === "all" ? events : events.filter((event) => event.event_type === filter);
  const visibleEvents = filteredEvents.slice(0, 16);

  return (
    <div className="quality-summary">
      <div className="quality-header">
        <div>
          <strong>Veri kontrolü</strong>
          <span>{qualitySummaryLabel(events.length)}</span>
        </div>
      </div>
      <div className="quality-filters">
        <FilterButton
          active={filter === "all"}
          count={events.length}
          label="Tümü"
          onClick={() => onFilterChange("all")}
        />
        <FilterButton
          active={filter === "time_gap"}
          count={gapCount}
          label="Kayıt aralığı"
          onClick={() => onFilterChange("time_gap")}
        />
        <FilterButton
          active={filter === "suspect_value"}
          count={suspectCount}
          label="Şüpheli"
          onClick={() => onFilterChange("suspect_value")}
        />
      </div>
      {isLoading ? (
        <span>Uyarılar yükleniyor...</span>
      ) : error ? (
        <InlineError
          actionLabel="Tekrar dene"
          message={error.message}
          onAction={onRetry}
          title="Uyarılar yüklenemedi"
        />
      ) : events.length === 0 ? (
        <span className="quality-empty">Seçili çalışmada veri uyarısı yok.</span>
      ) : filteredEvents.length === 0 ? (
        <span className="quality-empty">Bu filtrede uyarı yok.</span>
      ) : (
        <div className="quality-overview">
          <strong>{qualityFilterHeadline(filter, filteredEvents.length)}</strong>
          <span>{qualityFilterDescription(filter, gapCount, suspectCount)}</span>
          <div className="quality-breakdown" aria-label="Uyarı dağılımı">
            <div>
              <span>Kayıt aralığı</span>
              <strong>{gapCount}</strong>
            </div>
            <div>
              <span>Şüpheli değer</span>
              <strong>{suspectCount}</strong>
            </div>
          </div>
        </div>
      )}
      {visibleEvents.length > 0 ? (
        <ul className="quality-event-list">
          {visibleEvents.map((event) => {
            const view = qualityEventView(event);

            return (
              <li className="quality-event" key={event.id}>
                <div className="quality-event-top">
                  <strong>{view.title}</strong>
                  <span>{view.location}</span>
                </div>
                <p>{view.detail}</p>
                <div className="quality-event-meta">
                  <span>{view.time}</span>
                  <span>{view.effect}</span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {filteredEvents.length > visibleEvents.length ? (
        <span>{filteredEvents.length - visibleEvents.length} uyarı daha gizli.</span>
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
  return `${count} sinyal`;
}

function runRangeLabel(run: RunSummary | null): string {
  if (!run?.started_at || !run.finished_at) {
    return "Örnekleri incelemek için bir çalışma içe aktar.";
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
    return `${minutes} dk`;
  }

  return `${hours} sa ${minutes} dk`;
}

function shortDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return formatDate(value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function runStatusLabel(status: string): string {
  if (status === "imported") {
    return "içe aktarıldı";
  }

  return status;
}

function sourceKindLabel(sourceKind: string): string {
  if (sourceKind === "csv_import") {
    return "CSV içe aktarma";
  }

  return sourceKind;
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

function qualitySummaryLabel(count: number): string {
  if (count === 0) {
    return "Uyarı yok";
  }

  return `${count} uyarı incelenmeli`;
}

function qualityFilterHeadline(filter: QualityFilter, count: number): string {
  if (filter === "time_gap") {
    return `${count} kayıt aralığı uyarısı`;
  }

  if (filter === "suspect_value") {
    return `${count} şüpheli değer uyarısı`;
  }

  return `${count} toplam uyarı`;
}

function qualityFilterDescription(
  filter: QualityFilter,
  gapCount: number,
  suspectCount: number,
): string {
  if (filter === "time_gap") {
    return "Kayıtlar arasında beklenenden uzun boşluk olan noktalar. Grafik bu noktalarda veri sürekliliğini koparır.";
  }

  if (filter === "suspect_value") {
    return "Cihazdan gelen fakat normal ölçüm gibi kabul edilmeyen değerler. Raf ortalaması gibi analizlere dahil edilmez.";
  }

  return `${gapCount} zaman boşluğu ve ${suspectCount} şüpheli değer bulundu. Bu liste veriyi yorumlarken dikkat edilmesi gereken noktaları gösterir.`;
}

function qualityEventView(event: QualityEvent): {
  detail: string;
  effect: string;
  location: string;
  time: string;
  title: string;
} {
  const metadata = parseQualityMetadata(event.metadata_json);
  const location = event.source_row_number !== null ? `Satır ${event.source_row_number}` : "Satır yok";
  const time = qualityEventDisplayTime(event);

  if (event.event_type === "time_gap") {
    const gapSeconds = qualityGapSeconds(event, metadata);
    const previousTimestamp = stringFromMetadata(metadata, "previous_timestamp");
    const previousLabel = previousTimestamp
      ? `Önceki örnek: ${formatMachineTimestamp(previousTimestamp)}`
      : "Önceki örnek bilinmiyor";

    return {
      title: "Kayıt aralığı uzun",
      location,
      time,
      detail: gapSeconds !== null
        ? `Bu noktadan önce ${formatSeconds(gapSeconds)} boyunca yeni örnek yok.`
        : "Bu noktadan önce beklenenden uzun bir kayıt boşluğu var.",
      effect: `${previousLabel}; grafik çizgisi burada koparılır.`,
    };
  }

  if (event.event_type === "suspect_value") {
    const channelLabel = event.channel_code
      ? getChannelConfig(event.channel_code).label
      : "Kanal";
    const rawValue =
      stringFromMetadata(metadata, "raw_text") ??
      suspectValueFromMessage(event.message) ??
      numberFromMetadata(metadata, "raw_value")?.toString() ??
      "bilinmeyen değer";

    return {
      title: "Şüpheli değer",
      location: event.channel_code ? `${channelLabel} - ${location}` : location,
      time,
      detail: `${channelLabel} ${rawValue} değeri gönderdi. Bu değer cihazın özel hata değeri gibi işaretlendi.`,
      effect: event.channel_code?.startsWith("RAF")
        ? "Normal çizgiye ve Raf Avg hesabına dahil edilmez."
        : "Normal ölçüm gibi yorumlanmamalıdır.",
    };
  }

  return {
    title: "Veri uyarısı",
    location,
    time,
    detail: cleanQualityMessage(event.message),
    effect: "Bu noktayı yorumlarken ham logu kontrol et.",
  };
}

function qualityEventDisplayTime(event: QualityEvent): string {
  if (event.source_timestamp_text) {
    return formatMachineTimestamp(event.source_timestamp_text);
  }

  if (event.sampled_at) {
    return formatDate(event.sampled_at);
  }

  return "Zaman yok";
}

function parseQualityMetadata(metadataJson: string | null): Record<string, unknown> {
  if (!metadataJson) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(metadataJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function qualityGapSeconds(
  event: QualityEvent,
  metadata: Record<string, unknown>,
): number | null {
  const metadataValue = numberFromMetadata(metadata, "gap_seconds");

  if (metadataValue !== null) {
    return metadataValue;
  }

  const match = event.message.match(/time gap of ([\d.]+) seconds/);
  return match ? Number(match[1]) : null;
}

function numberFromMetadata(
  metadata: Record<string, unknown>,
  key: string,
): number | null {
  const value = metadata[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return null;
}

function stringFromMetadata(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function suspectValueFromMessage(message: string): string | null {
  const match = message.match(/value ([^\s]+)/);
  return match ? match[1] : null;
}

function cleanQualityMessage(message: string): string {
  return message.replaceAll("`", "");
}

function formatSeconds(value: number): string {
  return `${new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: 3,
  }).format(value)} sn`;
}

function formatMachineTimestamp(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T-](.+?)(?:Z)?$/);

  if (!match) {
    return value;
  }

  return `${match[3]}.${match[2]}.${match[1]} ${match[4]}`;
}
