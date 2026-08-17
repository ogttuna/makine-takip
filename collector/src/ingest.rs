use std::collections::HashSet;

use anyhow::{Context, anyhow, bail};
use chrono::{DateTime, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

const DISPLAY_TIMESTAMP_FORMAT: &str = "%Y-%m-%dT%H:%M:%S%.3f";
const CSV_TIMESTAMP_FORMAT: &str = "%Y-%m-%d-%H:%M:%S%.f";
const TIME_GAP_WARNING_SECONDS: f64 = 360.0;

#[derive(Debug, Deserialize)]
pub struct CreateRunRequest {
    pub name: String,
    #[serde(default = "default_source_kind")]
    pub source_kind: String,
    pub source_name: Option<String>,
    pub started_at: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AppendSamplesRequest {
    pub samples: Vec<AppendSampleRequest>,
}

#[derive(Debug, Deserialize)]
pub struct AppendSampleRequest {
    pub sampled_at: String,
    pub source_timestamp_text: Option<String>,
    pub source_sequence: Option<i64>,
    pub state_observation: Option<AppendStateObservationRequest>,
    pub measurements: Vec<AppendMeasurementRequest>,
}

#[derive(Debug, Deserialize)]
pub struct AppendStateObservationRequest {
    pub source_recipe_code: Option<String>,
    pub source_recipe_version: Option<String>,
    pub source_state_code: String,
    pub source_state_name: Option<String>,
    pub source_payload_json: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct AppendMeasurementRequest {
    pub channel_code: String,
    pub raw_text: Option<String>,
    pub numeric_value: Option<f64>,
    pub value_text: Option<String>,
    pub value_type: Option<String>,
    pub quality: Option<String>,
    pub quality_reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AppendSamplesReport {
    pub run_id: i64,
    pub inserted_count: usize,
    pub skipped_count: usize,
    pub channel_count: usize,
    pub warning_count: usize,
    pub error_count: usize,
    pub latest_sampled_at: Option<String>,
}

struct PreparedSample {
    sampled_at: String,
    sampled_at_value: NaiveDateTime,
    source_timestamp_text: String,
    source_sequence: i64,
    state_observation: Option<PreparedStateObservation>,
    measurements: Vec<PreparedMeasurement>,
}

struct PreparedStateObservation {
    source_recipe_code: Option<String>,
    source_recipe_version: Option<String>,
    source_state_code: String,
    source_state_name: Option<String>,
    source_payload_json: Option<String>,
}

struct PreparedMeasurement {
    channel_code: String,
    raw_text: String,
    numeric_value: Option<f64>,
    value_text: Option<String>,
    value_type: String,
    quality: String,
    quality_reason: Option<String>,
}

pub async fn create_run(pool: &SqlitePool, request: CreateRunRequest) -> anyhow::Result<i64> {
    let name = non_empty(request.name, "run name")?;
    let source_kind = non_empty(request.source_kind, "source kind")?;
    let started_at = request
        .started_at
        .as_deref()
        .map(normalize_timestamp)
        .transpose()?;

    let run_id = sqlx::query_scalar::<_, i64>(
        r#"
        INSERT INTO runs (name, source_kind, source_name, started_at, status, notes)
        VALUES (?1, ?2, ?3, ?4, 'running', ?5)
        RETURNING id
        "#,
    )
    .bind(name)
    .bind(source_kind)
    .bind(request.source_name)
    .bind(started_at)
    .bind(request.notes)
    .fetch_one(pool)
    .await?;

    Ok(run_id)
}

pub async fn append_samples(
    pool: &SqlitePool,
    run_id: i64,
    request: AppendSamplesRequest,
) -> anyhow::Result<AppendSamplesReport> {
    if request.samples.is_empty() {
        bail!("append request must include at least one sample");
    }

    let mut tx = pool.begin().await?;
    let status = sqlx::query_scalar::<_, String>("SELECT status FROM runs WHERE id = ?1")
        .bind(run_id)
        .fetch_optional(&mut *tx)
        .await?;
    let Some(status) = status else {
        bail!("run {run_id} was not found");
    };

    if matches!(status.as_str(), "completed" | "aborted" | "failed") {
        bail!("run {run_id} is {status} and cannot accept new samples");
    }

    let mut next_sequence = next_source_sequence(&mut tx, run_id).await?;
    let mut previous_sampled_at = latest_sample_time(&mut tx, run_id).await?;
    let mut inserted_count = 0_usize;
    let mut skipped_count = 0_usize;
    let mut warning_count = 0_usize;
    let mut error_count = 0_usize;
    let mut latest_sampled_at: Option<String> = None;

    for sample in request.samples {
        let source_sequence = sample.source_sequence.unwrap_or_else(|| {
            let sequence = next_sequence;
            next_sequence += 1;
            sequence
        });

        if source_sequence <= 0 {
            bail!("source_sequence must be positive");
        }

        if sample_exists(&mut tx, run_id, source_sequence).await? {
            skipped_count += 1;
            continue;
        }

        let prepared = prepare_sample(sample, source_sequence)?;
        let frame_id = insert_sample_frame(&mut tx, run_id, &prepared).await?;

        if let Some(previous) = previous_sampled_at {
            let gap_seconds =
                (prepared.sampled_at_value - previous).num_milliseconds() as f64 / 1_000.0;

            if gap_seconds < 0.0 {
                warning_count += 1;
                insert_timestamp_out_of_order_event(
                    &mut tx,
                    run_id,
                    frame_id,
                    &prepared,
                    previous,
                    gap_seconds,
                )
                .await?;
            } else if gap_seconds > TIME_GAP_WARNING_SECONDS {
                warning_count += 1;
                insert_time_gap_event(&mut tx, run_id, frame_id, &prepared, previous, gap_seconds)
                    .await?;
            }
        }

        previous_sampled_at = Some(prepared.sampled_at_value);
        latest_sampled_at = Some(prepared.sampled_at.clone());
        inserted_count += 1;

        if let Some(state_observation) = &prepared.state_observation {
            insert_state_observation(&mut tx, run_id, frame_id, &prepared, state_observation)
                .await?;

            if apply_state_observation_mapping(
                &mut tx,
                run_id,
                frame_id,
                &prepared,
                state_observation,
            )
            .await?
            {
                warning_count += 1;
            }
        }

        for measurement in prepared.measurements {
            let channel_id = channel_id_for(&mut tx, &measurement.channel_code).await?;
            insert_measurement(&mut tx, frame_id, channel_id, &measurement).await?;

            if measurement.quality == "suspect" {
                warning_count += 1;
                insert_suspect_value_event(&mut tx, run_id, frame_id, channel_id, &measurement)
                    .await?;
            }

            if measurement.quality == "invalid" {
                error_count += 1;
                insert_parse_error_event(&mut tx, run_id, frame_id, channel_id, &measurement)
                    .await?;
            }
        }
    }

    if inserted_count > 0 {
        update_run_bounds(&mut tx, run_id).await?;
    }

    let channel_count = channel_count_for_run(&mut tx, run_id).await? as usize;
    tx.commit().await?;

    if inserted_count > 0
        && let Err(error) = crate::analysis::analyze_run(pool, run_id).await
    {
        tracing::warn!(run_id, %error, "failed to refresh FD-750 analysis after ingest");
    }

    Ok(AppendSamplesReport {
        run_id,
        inserted_count,
        skipped_count,
        channel_count,
        warning_count,
        error_count,
        latest_sampled_at,
    })
}

fn prepare_sample(
    sample: AppendSampleRequest,
    source_sequence: i64,
) -> anyhow::Result<PreparedSample> {
    if sample.measurements.is_empty() {
        bail!("sample {source_sequence} must include at least one measurement");
    }

    let sampled_at = normalize_timestamp(&sample.sampled_at)?;
    let sampled_at_value = parse_sample_time(&sampled_at)?;
    let source_timestamp_text = sample
        .source_timestamp_text
        .unwrap_or_else(|| sample.sampled_at.clone());
    let state_observation = sample
        .state_observation
        .map(prepare_state_observation)
        .transpose()?;
    let measurements = sample
        .measurements
        .into_iter()
        .map(prepare_measurement)
        .collect::<anyhow::Result<Vec<_>>>()?;
    let mut channel_codes = HashSet::with_capacity(measurements.len());

    for measurement in &measurements {
        if !channel_codes.insert(measurement.channel_code.as_str()) {
            bail!(
                "sample {source_sequence} has duplicate channel `{}`",
                measurement.channel_code
            );
        }
    }

    Ok(PreparedSample {
        sampled_at,
        sampled_at_value,
        source_timestamp_text,
        source_sequence,
        state_observation,
        measurements,
    })
}

fn prepare_state_observation(
    observation: AppendStateObservationRequest,
) -> anyhow::Result<PreparedStateObservation> {
    let source_state_code = non_empty(observation.source_state_code, "source_state_code")?;

    Ok(PreparedStateObservation {
        source_recipe_code: trim_optional_field(observation.source_recipe_code),
        source_recipe_version: observation
            .source_recipe_version
            .and_then(trim_optional_value),
        source_state_code,
        source_state_name: observation.source_state_name.and_then(trim_optional_value),
        source_payload_json: observation
            .source_payload_json
            .map(|value| value.to_string()),
    })
}

fn prepare_measurement(
    measurement: AppendMeasurementRequest,
) -> anyhow::Result<PreparedMeasurement> {
    let channel_code = crate::csv_import::canonical_channel_code(&non_empty(
        measurement.channel_code,
        "channel_code",
    )?);
    let raw_text = measurement
        .raw_text
        .or_else(|| measurement.numeric_value.map(|value| value.to_string()))
        .or_else(|| measurement.value_text.clone())
        .ok_or_else(|| anyhow!("measurement {channel_code} must include raw_text or a value"))?;
    let provided_numeric = measurement.numeric_value;

    if let Some(value) = provided_numeric
        && !value.is_finite()
    {
        bail!("measurement {channel_code} numeric_value must be finite");
    }

    let parsed_numeric = crate::csv_import::parse_numeric_value(&raw_text);
    let numeric_value = provided_numeric.or(parsed_numeric);
    let value_type = measurement.value_type.unwrap_or_else(|| {
        if numeric_value.is_some() {
            "number".to_string()
        } else {
            "text".to_string()
        }
    });
    let quality = measurement.quality.unwrap_or_else(|| {
        if numeric_value.is_some() {
            "good".to_string()
        } else {
            "invalid".to_string()
        }
    });
    let quality_reason = measurement.quality_reason;

    if !matches!(quality.as_str(), "good" | "suspect" | "invalid") {
        bail!("measurement {channel_code} has unsupported quality `{quality}`");
    }

    Ok(PreparedMeasurement {
        channel_code,
        raw_text,
        numeric_value,
        value_text: measurement.value_text,
        value_type,
        quality,
        quality_reason,
    })
}

async fn next_source_sequence(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    run_id: i64,
) -> anyhow::Result<i64> {
    let max_sequence = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT MAX(source_row_number) FROM sample_frames WHERE run_id = ?1",
    )
    .bind(run_id)
    .fetch_one(&mut **tx)
    .await?;

    Ok(max_sequence.unwrap_or(0) + 1)
}

async fn latest_sample_time(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    run_id: i64,
) -> anyhow::Result<Option<NaiveDateTime>> {
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
    .fetch_optional(&mut **tx)
    .await?;

    sampled_at.as_deref().map(parse_sample_time).transpose()
}

async fn sample_exists(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    run_id: i64,
    source_sequence: i64,
) -> anyhow::Result<bool> {
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sample_frames WHERE run_id = ?1 AND source_row_number = ?2",
    )
    .bind(run_id)
    .bind(source_sequence)
    .fetch_one(&mut **tx)
    .await?;

    Ok(count > 0)
}

async fn insert_sample_frame(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    run_id: i64,
    sample: &PreparedSample,
) -> anyhow::Result<i64> {
    let frame_id = sqlx::query_scalar::<_, i64>(
        r#"
        INSERT INTO sample_frames (
            run_id,
            sampled_at,
            source_timestamp_text,
            source_row_number
        )
        VALUES (?1, ?2, ?3, ?4)
        RETURNING id
        "#,
    )
    .bind(run_id)
    .bind(&sample.sampled_at)
    .bind(&sample.source_timestamp_text)
    .bind(sample.source_sequence)
    .fetch_one(&mut **tx)
    .await?;

    Ok(frame_id)
}

async fn channel_id_for(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    channel_code: &str,
) -> anyhow::Result<i64> {
    sqlx::query(
        r#"
        INSERT OR IGNORE INTO channels (code, display_name, group_name, value_type)
        VALUES (?1, ?2, ?3, 'number')
        "#,
    )
    .bind(channel_code)
    .bind(channel_code)
    .bind(default_group(channel_code))
    .execute(&mut **tx)
    .await?;

    let channel_id = sqlx::query_scalar::<_, i64>("SELECT id FROM channels WHERE code = ?1")
        .bind(channel_code)
        .fetch_one(&mut **tx)
        .await?;

    Ok(channel_id)
}

async fn insert_measurement(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    frame_id: i64,
    channel_id: i64,
    measurement: &PreparedMeasurement,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO measurements (
            frame_id,
            channel_id,
            raw_text,
            numeric_value,
            value_text,
            value_type,
            quality,
            quality_reason
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
    )
    .bind(frame_id)
    .bind(channel_id)
    .bind(&measurement.raw_text)
    .bind(measurement.numeric_value)
    .bind(&measurement.value_text)
    .bind(&measurement.value_type)
    .bind(&measurement.quality)
    .bind(&measurement.quality_reason)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn insert_state_observation(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    run_id: i64,
    frame_id: i64,
    sample: &PreparedSample,
    observation: &PreparedStateObservation,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO run_state_observations (
            run_id,
            frame_id,
            sampled_at,
            source_sequence,
            source_recipe_code,
            source_recipe_version,
            source_state_code,
            source_state_name,
            source_payload_json
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        "#,
    )
    .bind(run_id)
    .bind(frame_id)
    .bind(&sample.sampled_at)
    .bind(sample.source_sequence)
    .bind(&observation.source_recipe_code)
    .bind(&observation.source_recipe_version)
    .bind(&observation.source_state_code)
    .bind(&observation.source_state_name)
    .bind(&observation.source_payload_json)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn apply_state_observation_mapping(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    run_id: i64,
    frame_id: i64,
    sample: &PreparedSample,
    observation: &PreparedStateObservation,
) -> anyhow::Result<bool> {
    let Some(assignment) = active_primary_assignment(tx, run_id).await? else {
        return Ok(false);
    };
    let Some(recipe_state_id) = matching_recipe_state(
        tx,
        assignment.recipe_version_id,
        &observation.source_state_code,
    )
    .await?
    else {
        insert_state_unmapped_event(tx, run_id, frame_id, assignment.id, sample, observation)
            .await?;
        return Ok(true);
    };

    upsert_state_segment(tx, assignment.id, recipe_state_id, sample, observation).await?;

    Ok(false)
}

struct ActiveAssignment {
    id: i64,
    recipe_version_id: i64,
}

async fn active_primary_assignment(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    run_id: i64,
) -> anyhow::Result<Option<ActiveAssignment>> {
    let assignment = sqlx::query(
        r#"
        SELECT id, recipe_version_id
        FROM run_recipe_assignments
        WHERE run_id = ?1 AND role = 'primary' AND status = 'active'
        ORDER BY assigned_at DESC, id DESC
        LIMIT 1
        "#,
    )
    .bind(run_id)
    .fetch_optional(&mut **tx)
    .await?
    .map(|row| {
        Ok::<_, sqlx::Error>(ActiveAssignment {
            id: row.try_get("id")?,
            recipe_version_id: row.try_get("recipe_version_id")?,
        })
    })
    .transpose()?;

    Ok(assignment)
}

async fn matching_recipe_state(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    recipe_version_id: i64,
    source_state_code: &str,
) -> anyhow::Result<Option<i64>> {
    let state_id = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT id
        FROM recipe_states
        WHERE
            recipe_version_id = ?1
            AND (code = ?2 OR external_code = ?2)
        ORDER BY CASE WHEN code = ?2 THEN 0 ELSE 1 END, sort_order ASC, id ASC
        LIMIT 1
        "#,
    )
    .bind(recipe_version_id)
    .bind(source_state_code)
    .fetch_optional(&mut **tx)
    .await?;

    Ok(state_id)
}

async fn upsert_state_segment(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    assignment_id: i64,
    recipe_state_id: i64,
    sample: &PreparedSample,
    observation: &PreparedStateObservation,
) -> anyhow::Result<()> {
    let last_segment = sqlx::query(
        r#"
        SELECT id, recipe_state_id, started_at
        FROM run_state_segments
        WHERE run_recipe_assignment_id = ?1
        ORDER BY started_at DESC, id DESC
        LIMIT 1
        "#,
    )
    .bind(assignment_id)
    .fetch_optional(&mut **tx)
    .await?;

    if let Some(row) = last_segment {
        let segment_id = row.try_get::<i64, _>("id")?;
        let last_state_id = row.try_get::<Option<i64>, _>("recipe_state_id")?;
        let started_at = row.try_get::<String, _>("started_at")?;

        if sample.sampled_at < started_at {
            bail!(
                "state observation at {} is older than the latest state segment {}",
                sample.sampled_at,
                started_at
            );
        }

        if last_state_id == Some(recipe_state_id) {
            sqlx::query(
                r#"
                UPDATE run_state_segments
                SET finished_at = ?2
                WHERE id = ?1
                "#,
            )
            .bind(segment_id)
            .bind(&sample.sampled_at)
            .execute(&mut **tx)
            .await?;
            return Ok(());
        }

        sqlx::query(
            r#"
            UPDATE run_state_segments
            SET finished_at = ?2
            WHERE id = ?1
            "#,
        )
        .bind(segment_id)
        .bind(&sample.sampled_at)
        .execute(&mut **tx)
        .await?;
    }

    sqlx::query(
        r#"
        INSERT INTO run_state_segments (
            run_recipe_assignment_id,
            recipe_state_id,
            started_at,
            finished_at,
            source,
            confidence,
            metadata_json
        )
        VALUES (?1, ?2, ?3, NULL, 'machine', 1.0, ?4)
        "#,
    )
    .bind(assignment_id)
    .bind(recipe_state_id)
    .bind(&sample.sampled_at)
    .bind(
        serde_json::json!({
            "source_state_code": observation.source_state_code,
            "source_recipe_code": observation.source_recipe_code,
            "source_recipe_version": observation.source_recipe_version,
            "source_sequence": sample.source_sequence,
        })
        .to_string(),
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn insert_state_unmapped_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    run_id: i64,
    frame_id: i64,
    assignment_id: i64,
    sample: &PreparedSample,
    observation: &PreparedStateObservation,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO quality_events (
            run_id,
            frame_id,
            event_type,
            severity,
            message,
            metadata_json
        )
        VALUES (?1, ?2, 'state_unmapped', 'warning', ?3, ?4)
        "#,
    )
    .bind(run_id)
    .bind(frame_id)
    .bind(format!(
        "machine state `{}` is not mapped to the active recipe",
        observation.source_state_code
    ))
    .bind(
        serde_json::json!({
            "run_recipe_assignment_id": assignment_id,
            "source_state_code": observation.source_state_code,
            "source_state_name": observation.source_state_name,
            "source_recipe_code": observation.source_recipe_code,
            "source_recipe_version": observation.source_recipe_version,
            "source_sequence": sample.source_sequence,
            "sampled_at": sample.sampled_at,
        })
        .to_string(),
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn insert_time_gap_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    run_id: i64,
    frame_id: i64,
    sample: &PreparedSample,
    previous: NaiveDateTime,
    gap_seconds: f64,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO quality_events (
            run_id,
            frame_id,
            event_type,
            severity,
            message,
            metadata_json
        )
        VALUES (?1, ?2, 'time_gap', 'warning', ?3, ?4)
        "#,
    )
    .bind(run_id)
    .bind(frame_id)
    .bind(format!(
        "time gap of {gap_seconds:.3} seconds before this sample"
    ))
    .bind(
        serde_json::json!({
            "gap_seconds": gap_seconds,
            "previous_timestamp": previous.format(DISPLAY_TIMESTAMP_FORMAT).to_string(),
            "current_timestamp": sample.sampled_at,
        })
        .to_string(),
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn insert_timestamp_out_of_order_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    run_id: i64,
    frame_id: i64,
    sample: &PreparedSample,
    previous: NaiveDateTime,
    gap_seconds: f64,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO quality_events (
            run_id,
            frame_id,
            event_type,
            severity,
            message,
            metadata_json
        )
        VALUES (?1, ?2, 'timestamp_out_of_order', 'warning', ?3, ?4)
        "#,
    )
    .bind(run_id)
    .bind(frame_id)
    .bind(format!(
        "timestamp moved backwards by {:.3} seconds before this sample",
        gap_seconds.abs()
    ))
    .bind(
        serde_json::json!({
            "gap_seconds": gap_seconds,
            "previous_timestamp": previous.format(DISPLAY_TIMESTAMP_FORMAT).to_string(),
            "current_timestamp": sample.sampled_at,
        })
        .to_string(),
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn insert_parse_error_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    run_id: i64,
    frame_id: i64,
    channel_id: i64,
    measurement: &PreparedMeasurement,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO quality_events (
            run_id,
            frame_id,
            channel_id,
            event_type,
            severity,
            message,
            metadata_json
        )
        VALUES (?1, ?2, ?3, 'parse_error', 'error', ?4, ?5)
        "#,
    )
    .bind(run_id)
    .bind(frame_id)
    .bind(channel_id)
    .bind(format!(
        "channel `{}` value `{}` could not be parsed as number",
        measurement.channel_code, measurement.raw_text
    ))
    .bind(
        serde_json::json!({
            "channel_code": measurement.channel_code,
            "raw_text": measurement.raw_text,
        })
        .to_string(),
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn insert_suspect_value_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    run_id: i64,
    frame_id: i64,
    channel_id: i64,
    measurement: &PreparedMeasurement,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO quality_events (
            run_id,
            frame_id,
            channel_id,
            event_type,
            severity,
            message,
            metadata_json
        )
        VALUES (?1, ?2, ?3, 'suspect_value', 'warning', ?4, ?5)
        "#,
    )
    .bind(run_id)
    .bind(frame_id)
    .bind(channel_id)
    .bind(format!(
        "`{}` reported suspect value {}",
        measurement.channel_code, measurement.raw_text
    ))
    .bind(
        serde_json::json!({
            "channel_code": measurement.channel_code,
            "raw_text": measurement.raw_text,
            "rule": measurement.quality_reason,
        })
        .to_string(),
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn update_run_bounds(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    run_id: i64,
) -> anyhow::Result<()> {
    let row = sqlx::query(
        r#"
        SELECT MIN(sampled_at) AS started_at, MAX(sampled_at) AS finished_at
        FROM sample_frames
        WHERE run_id = ?1
        "#,
    )
    .bind(run_id)
    .fetch_one(&mut **tx)
    .await?;
    let started_at = row.try_get::<Option<String>, _>("started_at")?;
    let finished_at = row.try_get::<Option<String>, _>("finished_at")?;

    sqlx::query(
        r#"
        UPDATE runs
        SET
            started_at = CASE
                WHEN started_at IS NULL OR ?2 < started_at THEN ?2
                ELSE started_at
            END,
            finished_at = ?3,
            status = CASE
                WHEN status = 'imported' THEN 'running'
                ELSE status
            END
        WHERE id = ?1
        "#,
    )
    .bind(run_id)
    .bind(started_at)
    .bind(finished_at)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn channel_count_for_run(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    run_id: i64,
) -> anyhow::Result<i64> {
    let count = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(DISTINCT m.channel_id)
        FROM sample_frames f
        JOIN measurements m ON m.frame_id = f.id
        WHERE f.run_id = ?1
        "#,
    )
    .bind(run_id)
    .fetch_one(&mut **tx)
    .await?;

    Ok(count)
}

pub(crate) fn normalize_timestamp(value: &str) -> anyhow::Result<String> {
    if let Ok(value) = DateTime::parse_from_rfc3339(value) {
        return Ok(value
            .with_timezone(&Utc)
            .format(DISPLAY_TIMESTAMP_FORMAT)
            .to_string());
    }

    if let Ok(value) = NaiveDateTime::parse_from_str(value, DISPLAY_TIMESTAMP_FORMAT) {
        return Ok(value.format(DISPLAY_TIMESTAMP_FORMAT).to_string());
    }

    if let Ok(value) = NaiveDateTime::parse_from_str(value, CSV_TIMESTAMP_FORMAT) {
        return Ok(value.format(DISPLAY_TIMESTAMP_FORMAT).to_string());
    }

    bail!("timestamp `{value}` is not RFC3339 or yyyy-MM-ddTHH:mm:ss.SSS");
}

fn parse_sample_time(value: &str) -> anyhow::Result<NaiveDateTime> {
    NaiveDateTime::parse_from_str(value, DISPLAY_TIMESTAMP_FORMAT)
        .with_context(|| format!("failed to parse stored sample timestamp `{value}`"))
}

fn non_empty(value: String, label: &str) -> anyhow::Result<String> {
    let value = value.trim().to_string();

    if value.is_empty() {
        bail!("{label} must not be empty");
    }

    Ok(value)
}

fn trim_optional_field(value: Option<String>) -> Option<String> {
    value.and_then(trim_optional_value)
}

fn trim_optional_value(value: String) -> Option<String> {
    let value = value.trim().to_string();

    if value.is_empty() {
        return None;
    }

    Some(value)
}

fn default_source_kind() -> String {
    "live".to_string()
}

fn default_group(channel_code: &str) -> &'static str {
    match channel_code {
        "RAF1" | "RAF2" | "RAF3" | "RAF4" => "shelf",
        "L_PRES" | "H_PRES" => "pressure",
        "VACUM" => "vacuum",
        "S1" | "S2" | "S3" | "S4" | "SERP2" | "SERP4" | "KONDANSER" => "cooling",
        _ => "other",
    }
}
