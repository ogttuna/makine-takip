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
  sampled_at: z.string().nullable(),
  source_timestamp_text: z.string().nullable(),
  source_row_number: z.number().nullable(),
  channel_code: z.string().nullable(),
  event_type: z.string(),
  severity: z.string(),
  message: z.string(),
  metadata_json: z.string().nullable(),
});

export const stateObservationSchema = z.object({
  id: z.number(),
  frame_id: z.number().nullable(),
  sampled_at: z.string(),
  source_sequence: z.number(),
  source_recipe_code: z.string().nullable(),
  source_recipe_version: z.string().nullable(),
  source_state_code: z.string(),
  source_state_name: z.string().nullable(),
  source_payload_json: z.string().nullable(),
});

export const stateSegmentSchema = z.object({
  id: z.number(),
  run_recipe_assignment_id: z.number(),
  recipe_state_id: z.number().nullable(),
  recipe_state_code: z.string().nullable(),
  recipe_state_name: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  source: z.string(),
  confidence: z.number().nullable(),
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

export const stateObservationsResponseSchema = z.object({
  observations: z.array(stateObservationSchema),
});

export const stateSegmentsResponseSchema = z.object({
  segments: z.array(stateSegmentSchema),
});

export const analysisProfileSchema = z.object({
  id: z.number(),
  code: z.string(),
  version: z.string(),
  machine_model: z.string(),
  config_json: z.string(),
});

export const processCycleSchema = z.object({
  id: z.number(),
  loop_number: z.number(),
  started_at: z.string(),
  dry_started_at: z.string().nullable(),
  stopped_at: z.string().nullable(),
  wait_started_at: z.string().nullable(),
  defrost_started_at: z.string().nullable(),
  defrost_stopped_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  status: z.enum(["active", "completed", "interrupted", "incomplete"]),
  confidence: z.number(),
  metadata_json: z.string().nullable(),
});

export const processStateSegmentSchema = z.object({
  id: z.number(),
  process_cycle_id: z.number().nullable(),
  loop_number: z.number().nullable(),
  state_code: z.enum([
    "START",
    "DRY",
    "STOP",
    "WAIT",
    "DEFROST",
    "DEFROST_STOP",
  ]),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  confidence: z.number(),
  metadata_json: z.string().nullable(),
});

export const diagnosticEventSchema = z.object({
  id: z.number(),
  process_cycle_id: z.number().nullable(),
  loop_number: z.number().nullable(),
  frame_id: z.number().nullable(),
  occurred_at: z.string(),
  event_type: z.string(),
  severity: z.enum(["info", "warning"]),
  message: z.string(),
  metadata_json: z.string().nullable(),
});

export const runAnalysisSchema = z.object({
  profile: analysisProfileSchema,
  cycles: z.array(processCycleSchema),
  segments: z.array(processStateSegmentSchema),
  events: z.array(diagnosticEventSchema),
});

export const appendSamplesReportSchema = z.object({
  run_id: z.number(),
  inserted_count: z.number(),
  skipped_count: z.number(),
  channel_count: z.number(),
  warning_count: z.number(),
  error_count: z.number(),
  latest_sampled_at: z.string().nullable(),
});

export const csvTailStatusSchema = z.object({
  configured: z.boolean(),
  name: z.string(),
  directory_path: z.string(),
  file_pattern: z.string(),
  scan_interval_ms: z.number(),
  enabled: z.boolean(),
  status: z.enum(["stopped", "scanning", "tailing", "switching", "degraded"]),
  active_file_path: z.string().nullable(),
  active_run_id: z.number().nullable(),
  byte_offset: z.number().nullable(),
  last_source_sequence: z.number().nullable(),
  last_sampled_at: z.string().nullable(),
  last_scan_at: z.string().nullable(),
  last_error: z.string().nullable(),
});

export const browserTailStatusSchema = z.object({
  source_id: z.string(),
  source_name: z.string(),
  active_file_name: z.string().nullable(),
  active_run_id: z.number().nullable(),
  byte_offset: z.number().nullable(),
  last_source_sequence: z.number().nullable(),
  file_size: z.number().nullable(),
  last_modified_ms: z.number().nullable(),
  completed: z.boolean().nullable(),
  last_sampled_at: z.string().nullable(),
  last_seen_at: z.string().nullable(),
});

export const browserTailChunkResponseSchema = browserTailStatusSchema.extend({
  inserted_count: z.number(),
  skipped_count: z.number(),
  replayed: z.boolean(),
});

export type ImportReport = z.infer<typeof importReportSchema>;
export type RunSummary = z.infer<typeof runSummarySchema>;
export type Measurement = z.infer<typeof measurementSchema>;
export type SampleFrame = z.infer<typeof sampleFrameSchema>;
export type QualityEvent = z.infer<typeof qualityEventSchema>;
export type StateObservation = z.infer<typeof stateObservationSchema>;
export type StateSegment = z.infer<typeof stateSegmentSchema>;
export type AnalysisProfile = z.infer<typeof analysisProfileSchema>;
export type ProcessCycle = z.infer<typeof processCycleSchema>;
export type ProcessStateSegment = z.infer<typeof processStateSegmentSchema>;
export type DiagnosticEvent = z.infer<typeof diagnosticEventSchema>;
export type RunAnalysis = z.infer<typeof runAnalysisSchema>;
export type AppendSamplesReport = z.infer<typeof appendSamplesReportSchema>;
export type CsvTailStatus = z.infer<typeof csvTailStatusSchema>;
export type BrowserTailStatus = z.infer<typeof browserTailStatusSchema>;
export type BrowserTailChunkResponse = z.infer<typeof browserTailChunkResponseSchema>;

export type CsvTailConfigPayload = {
  name?: string;
  directory_path: string;
  file_pattern?: string;
  scan_interval_ms?: number;
};

export type BrowserTailOpenPayload = {
  source_id: string;
  source_name: string;
  file_name: string;
  header_line: string;
  header_end_offset: number;
  file_size: number;
  last_modified_ms: number;
};

export type BrowserTailChunkPayload = {
  source_id: string;
  file_name: string;
  offset: number;
  rows_text: string;
};

export type CreateRunPayload = {
  name: string;
  source_kind?: string;
  source_name?: string | null;
  started_at?: string | null;
  notes?: string | null;
};

export type AppendMeasurementPayload = {
  channel_code: string;
  raw_text?: string | null;
  numeric_value?: number | null;
  value_text?: string | null;
  value_type?: string | null;
  quality?: "good" | "suspect" | "invalid" | null;
  quality_reason?: string | null;
};

export type AppendStateObservationPayload = {
  source_recipe_code?: string | null;
  source_recipe_version?: string | null;
  source_state_code: string;
  source_state_name?: string | null;
  source_payload_json?: unknown;
};

export type AppendSamplePayload = {
  sampled_at: string;
  source_timestamp_text?: string | null;
  source_sequence?: number | null;
  state_observation?: AppendStateObservationPayload | null;
  measurements: AppendMeasurementPayload[];
};

export type AppendSamplesPayload = {
  samples: AppendSamplePayload[];
};

export type RunStatus = "imported" | "running" | "completed" | "aborted" | "failed";

export type UpdateRunStatusPayload = {
  status: RunStatus;
  finished_at?: string | null;
  notes?: string | null;
};

export type FetchRunSamplesOptions = {
  from?: string;
  to?: string;
  limit?: number;
  latest?: number;
  afterSequence?: number;
};

const configuredApiBaseUrl = import.meta.env.VITE_COLLECTOR_URL?.trim();
const apiBaseUrl =
  configuredApiBaseUrl ||
  (import.meta.env.DEV
    ? "http://127.0.0.1:4777"
    : window.location.protocol === "http:" || window.location.protocol === "https:"
      ? window.location.origin
      : "http://127.0.0.1:4777");

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(await responseMessage(response));
  }

  return response.json();
}

async function postJson(url: string, payload: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await responseMessage(response));
  }

  return response.json();
}

async function putJson(url: string, payload: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await responseMessage(response));
  }

  return response.json();
}

async function postEmpty(url: string): Promise<unknown> {
  const response = await fetch(url, { method: "POST" });

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

export async function createRun(payload: CreateRunPayload): Promise<RunSummary> {
  const response = await postJson(`${apiBaseUrl}/api/runs`, payload);
  return runSummarySchema.parse(response);
}

export async function updateRunStatus(
  runId: number,
  payload: UpdateRunStatusPayload,
): Promise<RunSummary> {
  const response = await fetch(`${apiBaseUrl}/api/runs/${runId}/status`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await responseMessage(response));
  }

  return runSummarySchema.parse(await response.json());
}

export async function fetchRunSamples(
  runId: number,
  options: FetchRunSamplesOptions = {},
): Promise<SampleFrame[]> {
  const url = new URL(`${apiBaseUrl}/api/runs/${runId}/samples`);

  if (options.from) {
    url.searchParams.set("from", options.from);
  }

  if (options.to) {
    url.searchParams.set("to", options.to);
  }

  if (options.limit !== undefined) {
    url.searchParams.set("limit", String(options.limit));
  }

  if (options.latest !== undefined) {
    url.searchParams.set("latest", String(options.latest));
  }

  if (options.afterSequence !== undefined) {
    url.searchParams.set("after_sequence", String(options.afterSequence));
  }

  const payload = await getJson(url.toString());
  return samplesResponseSchema.parse(payload).samples;
}

export async function appendRunSamples(
  runId: number,
  payload: AppendSamplesPayload,
): Promise<AppendSamplesReport> {
  const response = await postJson(`${apiBaseUrl}/api/runs/${runId}/samples`, payload);
  return appendSamplesReportSchema.parse(response);
}

export async function fetchQualityEvents(runId: number): Promise<QualityEvent[]> {
  const payload = await getJson(`${apiBaseUrl}/api/runs/${runId}/quality-events`);
  return qualityEventsResponseSchema.parse(payload).events;
}

export async function fetchCsvTailStatus(): Promise<CsvTailStatus> {
  const payload = await getJson(`${apiBaseUrl}/api/csv-tail`);
  return csvTailStatusSchema.parse(payload);
}

export async function fetchBrowserTailStatus(
  sourceId: string,
): Promise<BrowserTailStatus | null> {
  const response = await fetch(
    `${apiBaseUrl}/api/browser-tail/${encodeURIComponent(sourceId)}`,
  );

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(await responseMessage(response));
  }

  return browserTailStatusSchema.parse(await response.json());
}

export async function openBrowserTailFile(
  payload: BrowserTailOpenPayload,
): Promise<BrowserTailStatus> {
  const response = await postJson(`${apiBaseUrl}/api/browser-tail/open`, payload);
  return browserTailStatusSchema.parse(response);
}

export async function syncBrowserTailChunk(
  payload: BrowserTailChunkPayload,
): Promise<BrowserTailChunkResponse> {
  const response = await postJson(`${apiBaseUrl}/api/browser-tail/chunk`, payload);
  return browserTailChunkResponseSchema.parse(response);
}

export async function configureCsvTail(
  payload: CsvTailConfigPayload,
): Promise<CsvTailStatus> {
  const response = await putJson(`${apiBaseUrl}/api/csv-tail`, payload);
  return csvTailStatusSchema.parse(response);
}

export async function startCsvTail(): Promise<CsvTailStatus> {
  const response = await postEmpty(`${apiBaseUrl}/api/csv-tail/start`);
  return csvTailStatusSchema.parse(response);
}

export async function stopCsvTail(): Promise<CsvTailStatus> {
  const response = await postEmpty(`${apiBaseUrl}/api/csv-tail/stop`);
  return csvTailStatusSchema.parse(response);
}

export async function rescanCsvTail(): Promise<CsvTailStatus> {
  const response = await postEmpty(`${apiBaseUrl}/api/csv-tail/rescan`);
  return csvTailStatusSchema.parse(response);
}

export async function fetchRunStateObservations(
  runId: number,
  options: FetchRunSamplesOptions = {},
): Promise<StateObservation[]> {
  const url = new URL(`${apiBaseUrl}/api/runs/${runId}/state-observations`);

  if (options.from) {
    url.searchParams.set("from", options.from);
  }

  if (options.to) {
    url.searchParams.set("to", options.to);
  }

  if (options.limit !== undefined) {
    url.searchParams.set("limit", String(options.limit));
  }

  const payload = await getJson(url.toString());
  return stateObservationsResponseSchema.parse(payload).observations;
}

export async function fetchRunStateSegments(
  runId: number,
  options: FetchRunSamplesOptions = {},
): Promise<StateSegment[]> {
  const url = new URL(`${apiBaseUrl}/api/runs/${runId}/state-segments`);

  if (options.from) {
    url.searchParams.set("from", options.from);
  }

  if (options.to) {
    url.searchParams.set("to", options.to);
  }

  if (options.limit !== undefined) {
    url.searchParams.set("limit", String(options.limit));
  }

  const payload = await getJson(url.toString());
  return stateSegmentsResponseSchema.parse(payload).segments;
}

export async function fetchRunAnalysis(runId: number): Promise<RunAnalysis> {
  const payload = await getJson(`${apiBaseUrl}/api/runs/${runId}/analysis`);
  return runAnalysisSchema.parse(payload);
}

export async function reanalyzeRun(runId: number): Promise<RunAnalysis> {
  const payload = await postEmpty(`${apiBaseUrl}/api/runs/${runId}/analysis`);
  return runAnalysisSchema.parse(payload);
}

export function getCollectorUrl(): string {
  return apiBaseUrl;
}

export function getRunExportUrl(runId: number): string {
  return `${apiBaseUrl}/api/runs/${runId}/export.csv`;
}
