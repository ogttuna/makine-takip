use axum::extract::{Multipart, Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Row, SqlitePool};
use tower_http::services::{ServeDir, ServeFile};

use crate::browser_tail::{
    BrowserTailChunkRequest, BrowserTailChunkResponse, BrowserTailOpenRequest, BrowserTailStatus,
};
use crate::csv_import::{ImportReport, import_csv_bytes};
use crate::csv_tail::{CsvTailConfigRequest, CsvTailManager, CsvTailStatus};
use crate::ingest::{AppendSamplesReport, AppendSamplesRequest, CreateRunRequest};

#[derive(Clone)]
struct AppState {
    pool: SqlitePool,
    csv_tail: CsvTailManager,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    database: &'static str,
    timestamp: String,
}

#[derive(Debug, Serialize)]
struct LegacyLiveSnapshot {
    status: &'static str,
    active_run: Option<serde_json::Value>,
    samples: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct RunSummary {
    id: i64,
    name: String,
    source_kind: String,
    source_name: Option<String>,
    started_at: Option<String>,
    finished_at: Option<String>,
    status: String,
    row_count: i64,
    warning_count: i64,
    error_count: i64,
}

#[derive(Debug, Serialize)]
struct RunsResponse {
    runs: Vec<RunSummary>,
}

#[derive(Debug, Deserialize)]
struct SamplesQuery {
    from: Option<String>,
    to: Option<String>,
    limit: Option<i64>,
    latest: Option<i64>,
    after_sequence: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct UpdateRunStatusRequest {
    status: String,
    finished_at: Option<String>,
    notes: Option<String>,
}

#[derive(Debug, Serialize)]
struct SamplesResponse {
    samples: Vec<SampleFrameResponse>,
}

#[derive(Debug, Serialize)]
struct SampleFrameResponse {
    id: i64,
    sampled_at: String,
    source_timestamp_text: String,
    source_row_number: i64,
    measurements: Vec<MeasurementResponse>,
}

#[derive(Debug, Serialize)]
struct MeasurementResponse {
    channel_code: String,
    raw_text: String,
    numeric_value: Option<f64>,
    value_text: Option<String>,
    value_type: String,
    quality: String,
    quality_reason: Option<String>,
}

#[derive(Debug, Serialize)]
struct QualityEventsResponse {
    events: Vec<QualityEventResponse>,
}

#[derive(Debug, Serialize)]
struct StateObservationsResponse {
    observations: Vec<StateObservationResponse>,
}

#[derive(Debug, Serialize)]
struct StateSegmentsResponse {
    segments: Vec<StateSegmentResponse>,
}

#[derive(Debug, Serialize, FromRow)]
struct QualityEventResponse {
    id: i64,
    frame_id: Option<i64>,
    sampled_at: Option<String>,
    source_timestamp_text: Option<String>,
    source_row_number: Option<i64>,
    channel_code: Option<String>,
    event_type: String,
    severity: String,
    message: String,
    metadata_json: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
struct StateObservationResponse {
    id: i64,
    frame_id: Option<i64>,
    sampled_at: String,
    source_sequence: i64,
    source_recipe_code: Option<String>,
    source_recipe_version: Option<String>,
    source_state_code: String,
    source_state_name: Option<String>,
    source_payload_json: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
struct StateSegmentResponse {
    id: i64,
    run_recipe_assignment_id: i64,
    recipe_state_id: Option<i64>,
    recipe_state_code: Option<String>,
    recipe_state_name: Option<String>,
    started_at: String,
    finished_at: Option<String>,
    source: String,
    confidence: Option<f64>,
    metadata_json: Option<String>,
}

#[derive(Debug, FromRow)]
struct SampleMeasurementRow {
    frame_id: i64,
    sampled_at: String,
    source_timestamp_text: String,
    source_row_number: i64,
    channel_code: String,
    raw_text: String,
    numeric_value: Option<f64>,
    value_text: Option<String>,
    value_type: String,
    quality: String,
    quality_reason: Option<String>,
}

pub fn router(pool: SqlitePool) -> Router {
    let csv_tail = CsvTailManager::new(pool.clone());
    router_with_csv_tail(pool, csv_tail)
}

pub fn router_with_csv_tail(pool: SqlitePool, csv_tail: CsvTailManager) -> Router {
    let state = AppState { pool, csv_tail };
    let static_files = ServeDir::new("dist").fallback(ServeFile::new("dist/index.html"));

    Router::new()
        .route("/api/health", get(health))
        .route("/api/live", get(live))
        .route(
            "/api/csv-tail",
            get(csv_tail_status).put(configure_csv_tail),
        )
        .route("/api/csv-tail/start", post(start_csv_tail))
        .route("/api/csv-tail/stop", post(stop_csv_tail))
        .route("/api/csv-tail/rescan", post(rescan_csv_tail))
        .route("/api/browser-tail/{source_id}", get(browser_tail_status))
        .route("/api/browser-tail/open", post(open_browser_tail_file))
        .route("/api/browser-tail/chunk", post(sync_browser_tail_chunk))
        .route("/api/imports/csv", post(import_csv))
        .route("/api/imports/{id}", get(import_status))
        .route("/api/runs", get(runs).post(create_run))
        .route("/api/runs/{id}", get(run_detail))
        .route("/api/runs/{id}/status", patch(update_run_status))
        .route(
            "/api/runs/{id}/samples",
            get(run_samples).post(append_run_samples),
        )
        .route(
            "/api/runs/{id}/state-observations",
            get(run_state_observations),
        )
        .route("/api/runs/{id}/state-segments", get(run_state_segments))
        .route(
            "/api/runs/{id}/analysis",
            get(run_analysis).post(reanalyze_run),
        )
        .route("/api/runs/{id}/quality-events", get(run_quality_events))
        .route("/api/runs/{id}/export.csv", get(export_run_csv))
        .fallback_service(static_files)
        .with_state(state)
}

async fn health(State(state): State<AppState>) -> Result<Json<HealthResponse>, ApiError> {
    sqlx::query("SELECT 1").execute(&state.pool).await?;

    Ok(Json(HealthResponse {
        status: "ok",
        database: "ready",
        timestamp: Utc::now().to_rfc3339(),
    }))
}

async fn live() -> Json<LegacyLiveSnapshot> {
    Json(LegacyLiveSnapshot {
        status: "idle",
        active_run: None,
        samples: Vec::new(),
    })
}

async fn csv_tail_status(State(state): State<AppState>) -> Result<Json<CsvTailStatus>, ApiError> {
    Ok(Json(state.csv_tail.status().await?))
}

async fn configure_csv_tail(
    State(state): State<AppState>,
    Json(request): Json<CsvTailConfigRequest>,
) -> Result<Json<CsvTailStatus>, ApiError> {
    let status = state
        .csv_tail
        .configure(request)
        .await
        .map_err(ApiError::bad_request)?;
    Ok(Json(status))
}

async fn start_csv_tail(State(state): State<AppState>) -> Result<Json<CsvTailStatus>, ApiError> {
    let status = state
        .csv_tail
        .start()
        .await
        .map_err(ApiError::bad_request)?;
    Ok(Json(status))
}

async fn stop_csv_tail(State(state): State<AppState>) -> Result<Json<CsvTailStatus>, ApiError> {
    Ok(Json(state.csv_tail.stop().await?))
}

async fn rescan_csv_tail(State(state): State<AppState>) -> Result<Json<CsvTailStatus>, ApiError> {
    Ok(Json(state.csv_tail.rescan().await?))
}

async fn browser_tail_status(
    State(state): State<AppState>,
    Path(source_id): Path<String>,
) -> Result<Json<BrowserTailStatus>, ApiError> {
    Ok(Json(
        crate::browser_tail::source_status(&state.pool, &source_id)
            .await
            .map_err(ApiError::not_found)?,
    ))
}

async fn open_browser_tail_file(
    State(state): State<AppState>,
    Json(request): Json<BrowserTailOpenRequest>,
) -> Result<Json<BrowserTailStatus>, ApiError> {
    Ok(Json(
        crate::browser_tail::open_file(&state.pool, request)
            .await
            .map_err(ApiError::bad_request)?,
    ))
}

async fn sync_browser_tail_chunk(
    State(state): State<AppState>,
    Json(request): Json<BrowserTailChunkRequest>,
) -> Result<Json<BrowserTailChunkResponse>, ApiError> {
    Ok(Json(
        crate::browser_tail::sync_chunk(&state.pool, request)
            .await
            .map_err(ApiError::bad_request)?,
    ))
}

async fn import_csv(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<ImportReport>, ApiError> {
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(ApiError::bad_request)?
    {
        let field_name = field.name().unwrap_or_default().to_string();

        if field_name != "file" {
            continue;
        }

        let file_name = field
            .file_name()
            .map(ToString::to_string)
            .unwrap_or_else(|| "upload.csv".to_string());
        let bytes = field.bytes().await.map_err(ApiError::bad_request)?;
        let report = import_csv_bytes(&state.pool, file_name, &bytes).await?;

        return Ok(Json(report));
    }

    Err(ApiError::bad_request(anyhow::anyhow!(
        "multipart upload must include a `file` field"
    )))
}

async fn import_status(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<ImportReport>, ApiError> {
    let Some(row) = sqlx::query(
        r#"
        SELECT
            i.id AS import_id,
            i.run_id,
            i.file_name,
            i.file_sha256,
            i.row_count,
            i.warning_count,
            i.error_count,
            r.started_at,
            r.finished_at,
            COUNT(DISTINCT m.channel_id) AS channel_count
        FROM import_files i
        JOIN runs r ON r.id = i.run_id
        LEFT JOIN sample_frames f ON f.run_id = r.id
        LEFT JOIN measurements m ON m.frame_id = f.id
        WHERE i.id = ?1
        GROUP BY i.id
        "#,
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    else {
        return Err(ApiError::not_found(anyhow::anyhow!(
            "import {id} was not found"
        )));
    };

    Ok(Json(ImportReport {
        import_id: row.try_get::<i64, _>("import_id")?,
        run_id: row.try_get::<i64, _>("run_id")?,
        duplicate: false,
        file_name: row.try_get::<String, _>("file_name")?,
        file_sha256: row.try_get::<String, _>("file_sha256")?,
        row_count: row.try_get::<i64, _>("row_count")? as usize,
        channel_count: row.try_get::<i64, _>("channel_count")? as usize,
        warning_count: row.try_get::<i64, _>("warning_count")? as usize,
        error_count: row.try_get::<i64, _>("error_count")? as usize,
        started_at: row.try_get::<Option<String>, _>("started_at")?,
        finished_at: row.try_get::<Option<String>, _>("finished_at")?,
    }))
}

async fn runs(State(state): State<AppState>) -> Result<Json<RunsResponse>, ApiError> {
    let runs = sqlx::query_as::<_, RunSummary>(
        r#"
        SELECT
            r.id,
            r.name,
            r.source_kind,
            r.source_name,
            r.started_at,
            r.finished_at,
            r.status,
            COALESCE(
                i.row_count,
                (SELECT COUNT(*) FROM sample_frames f WHERE f.run_id = r.id),
                0
            ) AS row_count,
            COALESCE(
                i.warning_count,
                (
                    SELECT COUNT(*)
                    FROM quality_events q
                    WHERE q.run_id = r.id AND q.severity = 'warning'
                ),
                0
            ) AS warning_count,
            COALESCE(
                i.error_count,
                (
                    SELECT COUNT(*)
                    FROM quality_events q
                    WHERE q.run_id = r.id AND q.severity = 'error'
                ),
                0
            ) AS error_count
        FROM runs r
        LEFT JOIN import_files i ON i.run_id = r.id
        ORDER BY COALESCE(r.started_at, r.created_at) DESC, r.id DESC
        LIMIT 100
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(RunsResponse { runs }))
}

async fn create_run(
    State(state): State<AppState>,
    Json(request): Json<CreateRunRequest>,
) -> Result<Json<RunSummary>, ApiError> {
    let run_id = crate::ingest::create_run(&state.pool, request)
        .await
        .map_err(ApiError::bad_request)?;
    let run = fetch_run_summary(&state.pool, run_id).await?;

    Ok(Json(run))
}

async fn run_detail(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<RunSummary>, ApiError> {
    let Some(run) = sqlx::query_as::<_, RunSummary>(
        r#"
        SELECT
            r.id,
            r.name,
            r.source_kind,
            r.source_name,
            r.started_at,
            r.finished_at,
            r.status,
            COALESCE(
                i.row_count,
                (SELECT COUNT(*) FROM sample_frames f WHERE f.run_id = r.id),
                0
            ) AS row_count,
            COALESCE(
                i.warning_count,
                (
                    SELECT COUNT(*)
                    FROM quality_events q
                    WHERE q.run_id = r.id AND q.severity = 'warning'
                ),
                0
            ) AS warning_count,
            COALESCE(
                i.error_count,
                (
                    SELECT COUNT(*)
                    FROM quality_events q
                    WHERE q.run_id = r.id AND q.severity = 'error'
                ),
                0
            ) AS error_count
        FROM runs r
        LEFT JOIN import_files i ON i.run_id = r.id
        WHERE r.id = ?1
        "#,
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    else {
        return Err(ApiError::not_found(anyhow::anyhow!(
            "run {id} was not found"
        )));
    };

    Ok(Json(run))
}

async fn run_samples(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(query): Query<SamplesQuery>,
) -> Result<Json<SamplesResponse>, ApiError> {
    let from = query
        .from
        .as_deref()
        .map(crate::ingest::normalize_timestamp)
        .transpose()
        .map_err(ApiError::bad_request)?;
    let to = query
        .to
        .as_deref()
        .map(crate::ingest::normalize_timestamp)
        .transpose()
        .map_err(ApiError::bad_request)?;
    if query.latest.is_some() && query.after_sequence.is_some() {
        return Err(ApiError::bad_request(anyhow::anyhow!(
            "latest and after_sequence cannot be used together"
        )));
    }

    if query.after_sequence.is_some_and(|sequence| sequence < 0) {
        return Err(ApiError::bad_request(anyhow::anyhow!(
            "after_sequence must not be negative"
        )));
    }

    let limit = query.latest.or(query.limit).unwrap_or(5_000);

    if !(1..=50_000).contains(&limit) {
        return Err(ApiError::bad_request(anyhow::anyhow!(
            "sample limit must be between 1 and 50000"
        )));
    }

    let rows = sqlx::query_as::<_, SampleMeasurementRow>(
        r#"
        WITH filtered_frames AS (
            SELECT id
            FROM sample_frames
            WHERE
                run_id = ?1
                AND (?2 IS NULL OR sampled_at >= ?2)
                AND (?3 IS NULL OR sampled_at <= ?3)
                AND (?4 IS NULL OR source_row_number > ?4)
            ORDER BY
                CASE WHEN ?5 = 1 THEN sampled_at END DESC,
                CASE WHEN ?5 = 1 THEN source_row_number END DESC,
                CASE WHEN ?5 = 0 THEN sampled_at END ASC,
                CASE WHEN ?5 = 0 THEN source_row_number END ASC
            LIMIT ?6
        )
        SELECT
            f.id AS frame_id,
            f.sampled_at,
            f.source_timestamp_text,
            f.source_row_number,
            c.code AS channel_code,
            m.raw_text,
            m.numeric_value,
            m.value_text,
            m.value_type,
            m.quality,
            m.quality_reason
        FROM sample_frames f
        JOIN measurements m ON m.frame_id = f.id
        JOIN channels c ON c.id = m.channel_id
        JOIN filtered_frames ff ON ff.id = f.id
        ORDER BY f.sampled_at ASC, f.source_row_number ASC, c.id ASC
        "#,
    )
    .bind(id)
    .bind(from)
    .bind(to)
    .bind(query.after_sequence)
    .bind(i64::from(query.latest.is_some()))
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    let mut samples = Vec::<SampleFrameResponse>::new();

    for row in rows {
        if samples
            .last()
            .map(|sample| sample.id != row.frame_id)
            .unwrap_or(true)
        {
            samples.push(SampleFrameResponse {
                id: row.frame_id,
                sampled_at: row.sampled_at.clone(),
                source_timestamp_text: row.source_timestamp_text.clone(),
                source_row_number: row.source_row_number,
                measurements: Vec::new(),
            });
        }

        let sample = samples
            .last_mut()
            .expect("sample was just inserted before measurement push");
        sample.measurements.push(MeasurementResponse {
            channel_code: row.channel_code,
            raw_text: row.raw_text,
            numeric_value: row.numeric_value,
            value_text: row.value_text,
            value_type: row.value_type,
            quality: row.quality,
            quality_reason: row.quality_reason,
        });
    }

    Ok(Json(SamplesResponse { samples }))
}

async fn update_run_status(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(request): Json<UpdateRunStatusRequest>,
) -> Result<Json<RunSummary>, ApiError> {
    let status = request.status.trim();

    if !matches!(
        status,
        "imported" | "running" | "completed" | "aborted" | "failed"
    ) {
        return Err(ApiError::bad_request(anyhow::anyhow!(
            "unsupported run status `{status}`"
        )));
    }

    let finished_at = match request.finished_at.as_deref() {
        Some(value) => {
            Some(crate::ingest::normalize_timestamp(value).map_err(ApiError::bad_request)?)
        }
        None if matches!(status, "completed" | "aborted" | "failed") => {
            Some(latest_sampled_at_or_now(&state.pool, id).await?)
        }
        None => None,
    };

    let result = sqlx::query(
        r#"
        UPDATE runs
        SET
            status = ?2,
            finished_at = ?3,
            notes = COALESCE(?4, notes)
        WHERE id = ?1
        "#,
    )
    .bind(id)
    .bind(status)
    .bind(finished_at)
    .bind(request.notes)
    .execute(&state.pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::not_found(anyhow::anyhow!(
            "run {id} was not found"
        )));
    }

    let run = fetch_run_summary(&state.pool, id).await?;

    Ok(Json(run))
}

async fn append_run_samples(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(request): Json<AppendSamplesRequest>,
) -> Result<Json<AppendSamplesReport>, ApiError> {
    let report = crate::ingest::append_samples(&state.pool, id, request)
        .await
        .map_err(ApiError::bad_request)?;

    Ok(Json(report))
}

async fn run_quality_events(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<QualityEventsResponse>, ApiError> {
    let events = sqlx::query_as::<_, QualityEventResponse>(
        r#"
        SELECT
            q.id,
            q.frame_id,
            f.sampled_at,
            f.source_timestamp_text,
            f.source_row_number,
            c.code AS channel_code,
            q.event_type,
            q.severity,
            q.message,
            q.metadata_json
        FROM quality_events q
        LEFT JOIN sample_frames f ON f.id = q.frame_id
        LEFT JOIN channels c ON c.id = q.channel_id
        WHERE q.run_id = ?1
        ORDER BY f.sampled_at ASC, q.id ASC
        "#,
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(QualityEventsResponse { events }))
}

async fn run_state_observations(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(query): Query<SamplesQuery>,
) -> Result<Json<StateObservationsResponse>, ApiError> {
    let from = query
        .from
        .as_deref()
        .map(crate::ingest::normalize_timestamp)
        .transpose()
        .map_err(ApiError::bad_request)?;
    let to = query
        .to
        .as_deref()
        .map(crate::ingest::normalize_timestamp)
        .transpose()
        .map_err(ApiError::bad_request)?;
    let limit = query.limit.unwrap_or(5_000);

    if !(1..=50_000).contains(&limit) {
        return Err(ApiError::bad_request(anyhow::anyhow!(
            "state observation limit must be between 1 and 50000"
        )));
    }

    let observations = sqlx::query_as::<_, StateObservationResponse>(
        r#"
        SELECT
            id,
            frame_id,
            sampled_at,
            source_sequence,
            source_recipe_code,
            source_recipe_version,
            source_state_code,
            source_state_name,
            source_payload_json
        FROM run_state_observations
        WHERE
            run_id = ?1
            AND (?2 IS NULL OR sampled_at >= ?2)
            AND (?3 IS NULL OR sampled_at <= ?3)
        ORDER BY sampled_at ASC, source_sequence ASC, id ASC
        LIMIT ?4
        "#,
    )
    .bind(id)
    .bind(from)
    .bind(to)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(StateObservationsResponse { observations }))
}

async fn run_state_segments(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(query): Query<SamplesQuery>,
) -> Result<Json<StateSegmentsResponse>, ApiError> {
    let from = query
        .from
        .as_deref()
        .map(crate::ingest::normalize_timestamp)
        .transpose()
        .map_err(ApiError::bad_request)?;
    let to = query
        .to
        .as_deref()
        .map(crate::ingest::normalize_timestamp)
        .transpose()
        .map_err(ApiError::bad_request)?;
    let limit = query.limit.unwrap_or(1_000);

    if !(1..=10_000).contains(&limit) {
        return Err(ApiError::bad_request(anyhow::anyhow!(
            "state segment limit must be between 1 and 10000"
        )));
    }

    let segments = sqlx::query_as::<_, StateSegmentResponse>(
        r#"
        SELECT
            s.id,
            s.run_recipe_assignment_id,
            s.recipe_state_id,
            rs.code AS recipe_state_code,
            rs.display_name AS recipe_state_name,
            s.started_at,
            s.finished_at,
            s.source,
            s.confidence,
            s.metadata_json
        FROM run_state_segments s
        JOIN run_recipe_assignments a ON a.id = s.run_recipe_assignment_id
        LEFT JOIN recipe_states rs ON rs.id = s.recipe_state_id
        WHERE
            a.run_id = ?1
            AND (?2 IS NULL OR COALESCE(s.finished_at, s.started_at) >= ?2)
            AND (?3 IS NULL OR s.started_at <= ?3)
        ORDER BY s.started_at ASC, s.id ASC
        LIMIT ?4
        "#,
    )
    .bind(id)
    .bind(from)
    .bind(to)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(StateSegmentsResponse { segments }))
}

async fn run_analysis(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<crate::analysis::RunAnalysisResponse>, ApiError> {
    ensure_run_exists(&state.pool, id).await?;
    let analysis = crate::analysis::fetch_run_analysis(&state.pool, id).await?;
    Ok(Json(analysis))
}

async fn reanalyze_run(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<crate::analysis::RunAnalysisResponse>, ApiError> {
    ensure_run_exists(&state.pool, id).await?;
    crate::analysis::analyze_run(&state.pool, id)
        .await
        .map_err(ApiError::bad_request)?;
    let analysis = crate::analysis::fetch_run_analysis(&state.pool, id).await?;
    Ok(Json(analysis))
}

async fn ensure_run_exists(pool: &SqlitePool, id: i64) -> Result<(), ApiError> {
    let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM runs WHERE id = ?1")
        .bind(id)
        .fetch_one(pool)
        .await?
        > 0;

    if !exists {
        return Err(ApiError::not_found(anyhow::anyhow!(
            "run {id} was not found"
        )));
    }

    Ok(())
}

async fn export_run_csv(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Response, ApiError> {
    let run = fetch_run_summary(&state.pool, id).await?;
    let rows = sqlx::query_as::<_, SampleMeasurementRow>(
        r#"
        SELECT
            f.id AS frame_id,
            f.sampled_at,
            f.source_timestamp_text,
            f.source_row_number,
            c.code AS channel_code,
            m.raw_text,
            m.numeric_value,
            m.value_text,
            m.value_type,
            m.quality,
            m.quality_reason
        FROM sample_frames f
        JOIN measurements m ON m.frame_id = f.id
        JOIN channels c ON c.id = m.channel_id
        WHERE f.run_id = ?1
        ORDER BY f.source_row_number ASC, c.id ASC
        "#,
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    if rows.is_empty() {
        return Err(ApiError::not_found(anyhow::anyhow!(
            "run {id} does not contain samples"
        )));
    }

    let mut channels = Vec::<String>::new();
    let mut frames = Vec::<ExportFrame>::new();

    for row in rows {
        if !channels.contains(&row.channel_code) {
            channels.push(row.channel_code.clone());
        }

        if frames
            .last()
            .map(|frame| frame.id != row.frame_id)
            .unwrap_or(true)
        {
            frames.push(ExportFrame {
                id: row.frame_id,
                source_timestamp_text: row.source_timestamp_text.clone(),
                values: Vec::new(),
            });
        }

        frames
            .last_mut()
            .expect("export frame was just inserted")
            .values
            .push((row.channel_code, row.raw_text));
    }

    let mut writer = csv::WriterBuilder::new()
        .delimiter(b';')
        .from_writer(Vec::new());
    let mut header_row = Vec::with_capacity(channels.len() + 1);
    header_row.push("TARIH SAAT".to_string());
    header_row.extend(channels.iter().cloned());
    writer.write_record(&header_row)?;

    for frame in frames {
        let mut row = Vec::with_capacity(channels.len() + 1);
        row.push(frame.source_timestamp_text);

        for channel in &channels {
            let value = frame
                .values
                .iter()
                .find(|(code, _)| code == channel)
                .map(|(_, value)| value.as_str())
                .unwrap_or_default();
            row.push(value.to_string());
        }

        writer.write_record(&row)?;
    }

    let csv_bytes = writer.into_inner()?;
    let file_name = export_file_name(&run.name);

    Ok((
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{file_name}\""),
            ),
        ],
        csv_bytes,
    )
        .into_response())
}

async fn fetch_run_summary(pool: &SqlitePool, id: i64) -> Result<RunSummary, ApiError> {
    let Some(run) = sqlx::query_as::<_, RunSummary>(
        r#"
        SELECT
            r.id,
            r.name,
            r.source_kind,
            r.source_name,
            r.started_at,
            r.finished_at,
            r.status,
            COALESCE(
                i.row_count,
                (SELECT COUNT(*) FROM sample_frames f WHERE f.run_id = r.id),
                0
            ) AS row_count,
            COALESCE(
                i.warning_count,
                (
                    SELECT COUNT(*)
                    FROM quality_events q
                    WHERE q.run_id = r.id AND q.severity = 'warning'
                ),
                0
            ) AS warning_count,
            COALESCE(
                i.error_count,
                (
                    SELECT COUNT(*)
                    FROM quality_events q
                    WHERE q.run_id = r.id AND q.severity = 'error'
                ),
                0
            ) AS error_count
        FROM runs r
        LEFT JOIN import_files i ON i.run_id = r.id
        WHERE r.id = ?1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    else {
        return Err(ApiError::not_found(anyhow::anyhow!(
            "run {id} was not found"
        )));
    };

    Ok(run)
}

async fn latest_sampled_at_or_now(pool: &SqlitePool, run_id: i64) -> Result<String, ApiError> {
    let sampled_at = sqlx::query_scalar::<_, String>(
        r#"
        SELECT sampled_at
        FROM sample_frames
        WHERE run_id = ?1
        ORDER BY sampled_at DESC, id DESC
        LIMIT 1
        "#,
    )
    .bind(run_id)
    .fetch_optional(pool)
    .await?;

    Ok(sampled_at.unwrap_or_else(|| Utc::now().format("%Y-%m-%dT%H:%M:%S%.3f").to_string()))
}

#[derive(Debug)]
struct ExportFrame {
    id: i64,
    source_timestamp_text: String,
    values: Vec<(String, String)>,
}

fn export_file_name(run_name: &str) -> String {
    let stem = run_name
        .strip_suffix(".csv")
        .unwrap_or(run_name)
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() || matches!(char, '-' | '_') {
                char
            } else {
                '_'
            }
        })
        .collect::<String>();

    format!("{stem}_export.csv")
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    source: anyhow::Error,
}

impl ApiError {
    fn bad_request<E>(error: E) -> Self
    where
        E: Into<anyhow::Error>,
    {
        Self {
            status: StatusCode::BAD_REQUEST,
            source: error.into(),
        }
    }

    fn not_found<E>(error: E) -> Self
    where
        E: Into<anyhow::Error>,
    {
        Self {
            status: StatusCode::NOT_FOUND,
            source: error.into(),
        }
    }
}

impl<E> From<E> for ApiError
where
    E: Into<anyhow::Error>,
{
    fn from(error: E) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            source: error.into(),
        }
    }
}

impl axum::response::IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        tracing::error!(status = %self.status, error = %self.source, "request failed");

        (
            self.status,
            Json(serde_json::json!({
                "error": self.status.canonical_reason().unwrap_or("error"),
                "message": self.source.to_string()
            })),
        )
            .into_response()
    }
}
