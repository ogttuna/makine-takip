import { z } from "zod";

export const importReportSchema = z.object({
  import_id: z.number(),
  run_id: z.number(),
  duplicate: z.boolean(),
  file_name: z.string(),
  file_sha256: z.string(),
  row_count: z.number(),
  channel_count: z.number(),
  warning_count: z.number(),
  error_count: z.number(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
});

export const runSummarySchema = z.object({
  id: z.number(),
  name: z.string(),
  source_kind: z.string(),
  source_name: z.string().nullable(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  status: z.string(),
  row_count: z.number(),
  warning_count: z.number(),
  error_count: z.number(),
});

export const measurementSchema = z.object({
  channel_code: z.string(),
  raw_text: z.string(),
  numeric_value: z.number().nullable(),
  value_text: z.string().nullable(),
  value_type: z.string(),
  quality: z.enum(["good", "suspect", "invalid"]),
  quality_reason: z.string().nullable(),
});

export const sampleFrameSchema = z.object({
  id: z.number(),
  sampled_at: z.string(),
  source_timestamp_text: z.string(),
  source_row_number: z.number(),
  measurements: z.array(measurementSchema),
});

export const qualityEventSchema = z.object({
  id: z.number(),
  frame_id: z.number().nullable(),
  channel_code: z.string().nullable(),
  event_type: z.string(),
  severity: z.string(),
  message: z.string(),
  metadata_json: z.string().nullable(),
});

export const runsResponseSchema = z.object({
  runs: z.array(runSummarySchema),
});

export const samplesResponseSchema = z.object({
  samples: z.array(sampleFrameSchema),
});

export const qualityEventsResponseSchema = z.object({
  events: z.array(qualityEventSchema),
});

export type ImportReport = z.infer<typeof importReportSchema>;
export type RunSummary = z.infer<typeof runSummarySchema>;
export type Measurement = z.infer<typeof measurementSchema>;
export type SampleFrame = z.infer<typeof sampleFrameSchema>;
export type QualityEvent = z.infer<typeof qualityEventSchema>;

const apiBaseUrl = import.meta.env.VITE_COLLECTOR_URL ?? "http://127.0.0.1:4777";

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(await responseMessage(response));
  }

  return response.json();
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: string };
    return payload.message ?? `Collector request failed: ${response.status}`;
  } catch {
    return `Collector request failed: ${response.status}`;
  }
}

export async function uploadCsv(file: File): Promise<ImportReport> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${apiBaseUrl}/api/imports/csv`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await responseMessage(response));
  }

  const payload = await response.json();
  return importReportSchema.parse(payload);
}

export async function fetchRuns(): Promise<RunSummary[]> {
  const payload = await getJson(`${apiBaseUrl}/api/runs`);
  return runsResponseSchema.parse(payload).runs;
}

export async function fetchRunSamples(runId: number): Promise<SampleFrame[]> {
  const payload = await getJson(`${apiBaseUrl}/api/runs/${runId}/samples`);
  return samplesResponseSchema.parse(payload).samples;
}

export async function fetchQualityEvents(runId: number): Promise<QualityEvent[]> {
  const payload = await getJson(`${apiBaseUrl}/api/runs/${runId}/quality-events`);
  return qualityEventsResponseSchema.parse(payload).events;
}

export function getCollectorUrl(): string {
  return apiBaseUrl;
}
