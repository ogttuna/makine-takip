import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { fetchLiveSnapshot, fetchRuns, getCollectorUrl } from "./api";
import type { LiveSnapshot, RunSummary, TelemetrySample } from "./api";
import { createDemoSnapshot } from "./demoData";
import { TelemetryChart } from "./TelemetryChart";

export function App() {
  const demoSnapshot = useMemo(() => createDemoSnapshot(), []);
  const liveQuery = useQuery({
    queryKey: ["live-snapshot"],
    queryFn: fetchLiveSnapshot,
    refetchInterval: 2_000,
  });
  const runsQuery = useQuery({
    queryKey: ["runs"],
    queryFn: fetchRuns,
    refetchInterval: 10_000,
  });

  const snapshot = liveQuery.data ?? demoSnapshot;
  const latest = snapshot.samples.at(-1);
  const runs = runsQuery.data ?? (snapshot.active_run ? [snapshot.active_run] : []);
  const sourceLabel = liveQuery.data ? "Collector online" : "Demo data";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">FreezeDryMachine</p>
          <h1>Canli Proses Izleme</h1>
        </div>
        <div className="connection-strip">
          <span className={liveQuery.data ? "status-dot online" : "status-dot"} />
          <div>
            <strong>{sourceLabel}</strong>
            <span>{getCollectorUrl()}</span>
          </div>
        </div>
      </header>

      <section className="summary-grid">
        <Metric label="Phase" value={latest?.phase ?? "idle"} />
        <Metric label="Shelf" value={formatMetric(latest?.shelf_temp_c, "C")} />
        <Metric label="Product" value={formatMetric(latest?.product_temp_c, "C")} />
        <Metric label="Pressure" value={formatMetric(latest?.chamber_pressure_mbar, "mbar", 4)} />
      </section>

      <section className="workspace">
        <div className="chart-panel">
          <div className="section-heading">
            <div>
              <h2>Telemetry</h2>
              <p>{snapshot.samples.length} sample points</p>
            </div>
            <RunBadge snapshot={snapshot} />
          </div>
          <TelemetryChart samples={snapshot.samples} />
        </div>

        <aside className="side-panel">
          <div className="section-heading compact">
            <div>
              <h2>Recent Runs</h2>
              <p>{runs.length} indexed</p>
            </div>
          </div>
          <RunList runs={runs} />
          <div className="collector-note">
            <strong>Collector</strong>
            <span>
              Start with <code>npm run collector:dev</code>. The UI polls
              <code> /api/live</code> and validates responses with Zod.
            </span>
          </div>
        </aside>
      </section>
    </main>
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

function RunBadge({ snapshot }: { snapshot: LiveSnapshot }) {
  const run = snapshot.active_run;

  return (
    <div className="run-badge">
      <span>{snapshot.status}</span>
      <strong>{run?.recipe_name ?? "No active run"}</strong>
    </div>
  );
}

function RunList({ runs }: { runs: RunSummary[] }) {
  if (runs.length === 0) {
    return <p className="empty-state">No runs stored yet.</p>;
  }

  return (
    <div className="run-list">
      {runs.map((run) => (
        <article className="run-row" key={run.id}>
          <div>
            <strong>{run.recipe_name}</strong>
            <span>{run.batch_code ?? "no batch"}</span>
          </div>
          <time>{formatDate(run.started_at)}</time>
        </article>
      ))}
    </div>
  );
}

function formatMetric(value: number | undefined, unit: string, digits = 1): string {
  if (value === undefined) {
    return "-";
  }

  return `${value.toFixed(digits)} ${unit}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
