import { z } from "zod";

export const telemetrySampleSchema = z.object({
  timestamp: z.string(),
  shelf_temp_c: z.number(),
  product_temp_c: z.number(),
  condenser_temp_c: z.number(),
  chamber_pressure_mbar: z.number(),
  phase: z.string(),
});

export const runSummarySchema = z.object({
  id: z.number(),
  recipe_name: z.string(),
  batch_code: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  status: z.string(),
});

export const liveSnapshotSchema = z.object({
  status: z.string(),
  active_run: runSummarySchema.nullable(),
  samples: z.array(telemetrySampleSchema),
});

export const runsResponseSchema = z.object({
  runs: z.array(runSummarySchema),
});

export type TelemetrySample = z.infer<typeof telemetrySampleSchema>;
export type RunSummary = z.infer<typeof runSummarySchema>;
export type LiveSnapshot = z.infer<typeof liveSnapshotSchema>;

const apiBaseUrl = import.meta.env.VITE_COLLECTOR_URL ?? "http://127.0.0.1:4777";

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Collector request failed: ${response.status}`);
  }

  return response.json();
}

export async function fetchLiveSnapshot(): Promise<LiveSnapshot> {
  const payload = await getJson(`${apiBaseUrl}/api/live`);
  return liveSnapshotSchema.parse(payload);
}

export async function fetchRuns(): Promise<RunSummary[]> {
  const payload = await getJson(`${apiBaseUrl}/api/runs`);
  return runsResponseSchema.parse(payload).runs;
}

export function getCollectorUrl(): string {
  return apiBaseUrl;
}
