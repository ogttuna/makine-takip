use axum::extract::{Multipart, Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use serde::Serialize;
use sqlx::{FromRow, Row, SqlitePool};
use tower_http::services::{ServeDir, ServeFile};

use crate::csv_import::{ImportReport, import_csv_bytes};

#[derive(Debug, Clone)]
struct AppState {
    pool: SqlitePool,
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

#[derive(Debug, Serialize, FromRow)]
struct QualityEventResponse {
    id: i64,
    frame_id: Option<i64>,
    channel_code: Option<String>,
    event_type: String,
    severity: String,
    message: String,
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
    let state = AppState { pool };
    let static_files = ServeDir::new("dist").fallback(ServeFile::new("dist/index.html"));

    Router::new()
        .route("/api/health", get(health))
        .route("/api/live", get(live))
        .route("/api/imports/csv", post(import_csv))
        .route("/api/imports/{id}", get(import_status))
        .route("/api/runs", get(runs))
        .route("/api/runs/{id}", get(run_detail))
        .route("/api/runs/{id}/samples", get(run_samples))
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
            COALESCE(i.row_count, 0) AS row_count,
            COALESCE(i.warning_count, 0) AS warning_count,
            COALESCE(i.error_count, 0) AS error_count
        FROM runs r
        LEFT JOIN import_files i ON i.run_id = r.id
        ORDER BY r.started_at DESC, r.id DESC
        LIMIT 100
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(RunsResponse { runs }))
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
            COALESCE(i.row_count, 0) AS row_count,
            COALESCE(i.warning_count, 0) AS warning_count,
            COALESCE(i.error_count, 0) AS error_count
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
) -> Result<Json<SamplesResponse>, ApiError> {
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
        ORDER BY f.sampled_at ASC, f.source_row_number ASC, c.id ASC
        "#,
    )
    .bind(id)
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

async fn run_quality_events(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<QualityEventsResponse>, ApiError> {
    let events = sqlx::query_as::<_, QualityEventResponse>(
        r#"
        SELECT
            q.id,
            q.frame_id,
            c.code AS channel_code,
            q.event_type,
            q.severity,
            q.message,
            q.metadata_json
        FROM quality_events q
        LEFT JOIN channels c ON c.id = q.channel_id
        WHERE q.run_id = ?1
        ORDER BY q.id ASC
        "#,
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(QualityEventsResponse { events }))
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
            COALESCE(i.row_count, 0) AS row_count,
            COALESCE(i.warning_count, 0) AS warning_count,
            COALESCE(i.error_count, 0) AS error_count
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
