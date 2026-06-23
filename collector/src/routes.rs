use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::Utc;
use serde::Serialize;
use sqlx::{FromRow, SqlitePool};

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

#[derive(Debug, Serialize, FromRow)]
pub struct RunSummary {
    id: i64,
    recipe_name: String,
    batch_code: Option<String>,
    started_at: String,
    finished_at: Option<String>,
    status: String,
}

#[derive(Debug, Serialize, FromRow)]
pub struct TelemetrySample {
    timestamp: String,
    shelf_temp_c: f64,
    product_temp_c: f64,
    condenser_temp_c: f64,
    chamber_pressure_mbar: f64,
    phase: String,
}

#[derive(Debug, Serialize)]
struct LiveSnapshot {
    status: String,
    active_run: Option<RunSummary>,
    samples: Vec<TelemetrySample>,
}

#[derive(Debug, Serialize)]
struct RunsResponse {
    runs: Vec<RunSummary>,
}

#[derive(Debug, Serialize)]
struct SamplesResponse {
    samples: Vec<TelemetrySample>,
}

pub fn router(pool: SqlitePool) -> Router {
    let state = AppState { pool };

    Router::new()
        .route("/api/health", get(health))
        .route("/api/live", get(live))
        .route("/api/runs", get(runs))
        .route("/api/runs/{id}/samples", get(run_samples))
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

async fn live(State(state): State<AppState>) -> Result<Json<LiveSnapshot>, ApiError> {
    let active_run = sqlx::query_as::<_, RunSummary>(
        r#"
        SELECT id, recipe_name, batch_code, started_at, finished_at, status
        FROM runs
        WHERE status = 'running'
        ORDER BY started_at DESC
        LIMIT 1
        "#,
    )
    .fetch_optional(&state.pool)
    .await?;

    let samples = match &active_run {
        Some(run) => samples_for_run(&state.pool, run.id, 300).await?,
        None => Vec::new(),
    };

    Ok(Json(LiveSnapshot {
        status: active_run
            .as_ref()
            .map(|run| run.status.clone())
            .unwrap_or_else(|| "idle".to_string()),
        active_run,
        samples,
    }))
}

async fn runs(State(state): State<AppState>) -> Result<Json<RunsResponse>, ApiError> {
    let runs = sqlx::query_as::<_, RunSummary>(
        r#"
        SELECT id, recipe_name, batch_code, started_at, finished_at, status
        FROM runs
        ORDER BY started_at DESC
        LIMIT 100
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(RunsResponse { runs }))
}

async fn run_samples(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<SamplesResponse>, ApiError> {
    let samples = samples_for_run(&state.pool, id, 10_000).await?;
    Ok(Json(SamplesResponse { samples }))
}

async fn samples_for_run(
    pool: &SqlitePool,
    run_id: i64,
    limit: i64,
) -> Result<Vec<TelemetrySample>, sqlx::Error> {
    sqlx::query_as::<_, TelemetrySample>(
        r#"
        SELECT
            sampled_at AS timestamp,
            shelf_temp_c,
            product_temp_c,
            condenser_temp_c,
            chamber_pressure_mbar,
            phase
        FROM samples
        WHERE run_id = ?1
        ORDER BY sampled_at DESC
        LIMIT ?2
        "#,
    )
    .bind(run_id)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map(|mut samples| {
        samples.reverse();
        samples
    })
}

#[derive(Debug)]
struct ApiError(anyhow::Error);

impl<E> From<E> for ApiError
where
    E: Into<anyhow::Error>,
{
    fn from(error: E) -> Self {
        Self(error.into())
    }
}

impl axum::response::IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        tracing::error!(error = %self.0, "request failed");

        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "internal_error",
                "message": self.0.to_string()
            })),
        )
            .into_response()
    }
}
