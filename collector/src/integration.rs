//! Versioned, read-only telemetry for Factory. Stored CSV clock values are
//! Istanbul wall time; RFC3339 source values were normalized to UTC on ingest.
//! Pagination is pinned to an ingestion snapshot so late imports cannot shift pages.
use std::collections::{BTreeMap, BTreeSet};

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::get,
};
use chrono::{DateTime, Duration, Timelike, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

#[derive(Clone)]
struct IntegrationState {
    pool: SqlitePool,
    token: Option<String>,
}

pub fn router(pool: SqlitePool) -> Router {
    Router::new()
        .route("/machines", get(machines))
        .route("/machines/{id}/readings", get(readings))
        .with_state(IntegrationState {
            pool,
            token: std::env::var("FREEZEDRY_INTEGRATION_TOKEN")
                .ok()
                .filter(|s| s.len() >= 24),
        })
}

type ApiResult<T> = Result<Json<T>, (StatusCode, String)>;

fn authorize(state: &IntegrationState, headers: &HeaderMap) -> Result<(), (StatusCode, String)> {
    let Some(expected) = &state.token else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "Integration access is not configured".into(),
        ));
    };
    let offered = headers
        .get("x-monitoring-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if offered.len() != expected.len()
        || offered
            .bytes()
            .zip(expected.bytes())
            .fold(0u8, |difference, (a, b)| difference | (a ^ b))
            != 0
    {
        return Err((
            StatusCode::UNAUTHORIZED,
            "Invalid integration credential".into(),
        ));
    }
    Ok(())
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceMachine {
    id: i64,
    code: String,
    name: String,
    model: Option<String>,
}

async fn machines(
    State(state): State<IntegrationState>,
    headers: HeaderMap,
) -> ApiResult<Vec<SourceMachine>> {
    authorize(&state, &headers)?;
    let machines = sqlx::query_as("SELECT id, code, name, model FROM machines ORDER BY id")
        .fetch_all(&state.pool)
        .await
        .map_err(internal_error)?;
    Ok(Json(machines))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingsQuery {
    pub from: DateTime<Utc>,
    pub to: DateTime<Utc>,
    pub after: Option<DateTime<Utc>>,
    pub snapshot_frame_id: Option<i64>,
    pub limit: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingsPage {
    pub contract_version: &'static str,
    pub machine_id: i64,
    pub source_time_zone: &'static str,
    pub from: DateTime<Utc>,
    pub to: DateTime<Utc>,
    pub snapshot_frame_id: i64,
    pub next_cursor: Option<String>,
    pub channels: Vec<Channel>,
    pub samples: Vec<Sample>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    pub recorded_at: String,
    pub duplicate_frames: i64,
    pub values: Vec<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Value {
    pub channel_code: String,
    pub numeric_value: Option<f64>,
    pub value_text: Option<String>,
    pub quality: String,
    pub quality_reason: Option<String>,
    pub frame_id: i64,
    pub run_id: i64,
    pub source_timestamp_text: String,
    pub conflicting_value: bool,
    pub differing_quality: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub code: String,
    pub label: String,
    pub unit: Option<&'static str>,
    pub dimension: &'static str,
    pub target: bool,
}

#[derive(FromRow)]
struct Measurement {
    utc_at: String,
    frame_count: i64,
    frame_id: i64,
    run_id: i64,
    source_timestamp_text: String,
    channel_code: String,
    numeric_value: Option<f64>,
    value_text: Option<String>,
    quality: String,
    quality_reason: Option<String>,
}

fn timestamp(value: DateTime<Utc>) -> String {
    value.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

// SQLite stores millisecond samples. Both inclusive lower and exclusive upper
// comparisons need ceiling precision, so a sub-millisecond boundary stays exact.
fn boundary(value: DateTime<Utc>) -> String {
    let remainder = value.nanosecond() % 1_000_000;
    timestamp(if remainder == 0 {
        value
    } else {
        value + Duration::nanoseconds(i64::from(1_000_000 - remainder))
    })
}

fn internal_error(error: sqlx::Error) -> (StatusCode, String) {
    tracing::error!(%error, "integration read failed");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Telemetry could not be read".into(),
    )
}

async fn readings(
    State(state): State<IntegrationState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Query(query): Query<ReadingsQuery>,
) -> ApiResult<ReadingsPage> {
    authorize(&state, &headers)?;
    read_page(&state.pool, id, query).await.map(Json)
}

pub async fn read_page(
    pool: &SqlitePool,
    machine_id: i64,
    query: ReadingsQuery,
) -> Result<ReadingsPage, (StatusCode, String)> {
    let limit = query.limit.unwrap_or(1000);
    if query.from >= query.to
        || query.to - query.from > Duration::days(366)
        || !(1..=5000).contains(&limit)
        || query.snapshot_frame_id.is_some_and(|id| id < 0)
        || query
            .after
            .is_some_and(|after| after < query.from || after >= query.to)
        || (query.after.is_some() && query.snapshot_frame_id.is_none())
    {
        return Err((StatusCode::BAD_REQUEST, "Use an increasing window of at most 366 days, a limit from 1 to 5000, and a snapshot with the continuation cursor".into()));
    }
    let machine_code: Option<String> = sqlx::query_scalar("SELECT code FROM machines WHERE id=?")
        .bind(machine_id)
        .fetch_optional(pool)
        .await
        .map_err(internal_error)?;
    let Some(machine_code) = machine_code else {
        return Err((StatusCode::NOT_FOUND, "Machine not found".into()));
    };
    let snapshot = match query.snapshot_frame_id {
        Some(id) => id,
        None => sqlx::query_scalar::<_, i64>("SELECT coalesce(max(id),0) FROM sample_frames")
            .fetch_one(pool)
            .await
            .map_err(internal_error)?,
    };
    // A local CSV time and a normalized RFC3339 time can both be stored without
    // an offset. Retained source text disambiguates them. Never rewrite raw data.
    let rows = sqlx::query_as::<_, Measurement>(r#"
        WITH normalized AS (
            SELECT f.id, f.run_id, f.source_timestamp_text,
                CASE WHEN substr(f.source_timestamp_text,-1) IN ('Z','z')
                    OR (substr(f.source_timestamp_text,-6,1) IN ('+','-') AND substr(f.source_timestamp_text,-3,1)=':')
                THEN strftime('%Y-%m-%dT%H:%M:%fZ', f.sampled_at)
                ELSE strftime('%Y-%m-%dT%H:%M:%fZ', f.sampled_at, '-3 hours') END AS utc_at
            FROM sample_frames f JOIN runs r ON r.id=f.run_id
            WHERE r.machine_id=?1 AND f.id<=?4
              AND f.sampled_at>=?7 AND f.sampled_at<?8
              AND EXISTS(SELECT 1 FROM measurements m WHERE m.frame_id=f.id)
        ), page_times AS (
            SELECT utc_at, count(*) AS frame_count FROM normalized
            WHERE utc_at>=?2 AND utc_at<?3 AND (?5 IS NULL OR utc_at>?5)
            GROUP BY utc_at ORDER BY utc_at LIMIT ?6
        )
        SELECT n.utc_at, p.frame_count, n.id AS frame_id, n.run_id,
            n.source_timestamp_text, c.code AS channel_code, m.numeric_value,
            m.value_text, m.quality, m.quality_reason
        FROM page_times p JOIN normalized n ON n.utc_at=p.utc_at
        JOIN measurements m ON m.frame_id=n.id JOIN channels c ON c.id=m.channel_id
        ORDER BY n.utc_at, c.code, n.id DESC, m.id DESC
    "#)
        .bind(machine_id).bind(boundary(query.from)).bind(boundary(query.to)).bind(snapshot)
        .bind(query.after.map(timestamp)).bind((limit + 1) as i64)
        .bind(query.from.format("%Y-%m-%dT%H:%M:%S%.3f").to_string())
        .bind((query.to + Duration::hours(3) + Duration::milliseconds(1)).format("%Y-%m-%dT%H:%M:%S%.3f").to_string())
        .fetch_all(pool).await.map_err(internal_error)?;
    let mut grouped: BTreeMap<String, (i64, BTreeMap<String, Value>)> = BTreeMap::new();
    for row in rows {
        let (_, values) = grouped
            .entry(row.utc_at)
            .or_insert_with(|| (row.frame_count - 1, BTreeMap::new()));
        if let Some(selected) = values.get_mut(&row.channel_code) {
            selected.conflicting_value |= selected.numeric_value != row.numeric_value
                || selected.value_text != row.value_text;
            selected.differing_quality |= selected.quality != row.quality;
            continue;
        }
        values.insert(
            row.channel_code.clone(),
            Value {
                channel_code: row.channel_code,
                numeric_value: row.numeric_value,
                value_text: row.value_text,
                quality: row.quality,
                quality_reason: row.quality_reason,
                frame_id: row.frame_id,
                run_id: row.run_id,
                source_timestamp_text: row.source_timestamp_text,
                conflicting_value: false,
                differing_quality: false,
            },
        );
    }
    let has_more = grouped.len() > limit;
    let samples: Vec<Sample> = grouped
        .into_iter()
        .take(limit)
        .map(|(recorded_at, (duplicate_frames, values))| Sample {
            recorded_at,
            duplicate_frames,
            values: values.into_values().collect(),
        })
        .collect();
    let codes: BTreeSet<&str> = samples
        .iter()
        .flat_map(|s| s.values.iter().map(|v| v.channel_code.as_str()))
        .collect();
    // The FD25 pressure scale is not confirmed by the operator. Never silently
    // apply the FD750's bar label (or a guessed conversion) to its raw values.
    let pressure_unit = if machine_code.eq_ignore_ascii_case("FD750-01") {
        Some("bar")
    } else {
        None
    };
    let channels = codes
        .into_iter()
        .map(|code| describe_channel(code, pressure_unit))
        .collect();
    let next_cursor = if has_more {
        samples.last().map(|s| s.recorded_at.clone())
    } else {
        None
    };
    Ok(ReadingsPage {
        contract_version: "machine-monitoring-v1",
        machine_id,
        source_time_zone: "Europe/Istanbul",
        from: query.from,
        to: query.to,
        snapshot_frame_id: snapshot,
        next_cursor,
        channels,
        samples,
    })
}

fn describe_channel(code: &str, pressure_unit: Option<&'static str>) -> Channel {
    let (label, unit, dimension, target) = match code {
        "KONDANSER" => ("Kondenser".into(), Some("°C"), "temperature", false),
        "H_PRES" => ("Yüksek basınç".into(), pressure_unit, "pressure", false),
        "L_PRES" => ("Düşük basınç".into(), pressure_unit, "pressure", false),
        "VACUM" => ("Hazne vakumu".into(), Some("mbar"), "vacuum", false),
        "TARTIM" => ("Tartım".into(), Some("kg"), "mass", false),
        "E.GUC" => ("Anlık güç".into(), Some("kW"), "power", false),
        "E.TUKETIM" => ("Toplam enerji".into(), Some("kWh"), "energy", false),
        _ if code
            .strip_prefix("RAF")
            .is_some_and(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit())) =>
        {
            (
                format!("Raf {} hedef", &code[3..]),
                Some("°C"),
                "temperature",
                true,
            )
        }
        _ if code
            .strip_prefix('S')
            .is_some_and(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit())) =>
        {
            (
                format!("Serpantin {code}"),
                Some("°C"),
                "temperature",
                false,
            )
        }
        _ => (code.into(), None, "other", false),
    };
    Channel {
        code: code.into(),
        label,
        unit,
        dimension,
        target,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn integration_is_disabled_without_key_and_rejects_missing_or_wrong_credentials() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect_lazy("sqlite::memory:")
            .unwrap();
        let mut state = IntegrationState { pool, token: None };
        let mut headers = HeaderMap::new();
        assert_eq!(
            authorize(&state, &headers).unwrap_err().0,
            StatusCode::SERVICE_UNAVAILABLE
        );
        state.token = Some("test-integration-key-123456789".into());
        assert_eq!(
            authorize(&state, &headers).unwrap_err().0,
            StatusCode::UNAUTHORIZED
        );
        headers.insert(
            "x-monitoring-key",
            "test-integration-key-123456780".parse().unwrap(),
        );
        assert_eq!(
            authorize(&state, &headers).unwrap_err().0,
            StatusCode::UNAUTHORIZED
        );
        headers.insert(
            "x-monitoring-key",
            "test-integration-key-123456789".parse().unwrap(),
        );
        assert!(authorize(&state, &headers).is_ok());
    }

    #[test]
    fn unverified_pressure_stays_raw_and_dynamic_shelf_channels_are_targets() {
        assert_eq!(describe_channel("H_PRES", None).unit, None);
        assert_eq!(describe_channel("L_PRES", Some("bar")).unit, Some("bar"));
        assert!(describe_channel("RAF7", None).target);
        assert_eq!(describe_channel("S12", None).dimension, "temperature");
        assert_eq!(describe_channel("RECETE NO", None).unit, None);
    }
}
