use anyhow::{anyhow, bail};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

use crate::csv_import::{ParsedCsv, parse_csv_bytes};
use crate::ingest::{
    AppendMeasurementRequest, AppendSampleRequest, AppendSamplesRequest, CreateRunRequest,
    append_samples, create_run,
};

const MAX_CHUNK_BYTES: usize = 1_000_000;

#[derive(Debug, Deserialize)]
pub struct BrowserTailOpenRequest {
    pub source_id: String,
    pub source_name: String,
    pub file_name: String,
    pub header_line: String,
    pub header_end_offset: i64,
    pub file_size: i64,
    pub last_modified_ms: i64,
}

#[derive(Debug, Deserialize)]
pub struct BrowserTailChunkRequest {
    pub source_id: String,
    pub file_name: String,
    pub offset: i64,
    pub rows_text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowserTailStatus {
    pub source_id: String,
    pub source_name: String,
    pub active_file_name: Option<String>,
    pub active_run_id: Option<i64>,
    pub byte_offset: Option<i64>,
    pub last_source_sequence: Option<i64>,
    pub file_size: Option<i64>,
    pub last_modified_ms: Option<i64>,
    pub completed: Option<bool>,
    pub last_sampled_at: Option<String>,
    pub last_seen_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BrowserTailChunkResponse {
    #[serde(flatten)]
    pub status: BrowserTailStatus,
    pub inserted_count: usize,
    pub skipped_count: usize,
    pub replayed: bool,
}

#[derive(Debug, FromRow)]
struct BrowserTailSourceRow {
    source_id: String,
    name: String,
    active_file_name: Option<String>,
    active_run_id: Option<i64>,
    last_seen_at: Option<String>,
}

#[derive(Debug, FromRow)]
struct BrowserTailFileRow {
    file_name: String,
    run_id: i64,
    header_line: String,
    byte_offset: i64,
    last_source_sequence: i64,
    file_size: i64,
    last_modified_ms: i64,
    completed: i64,
}

pub async fn open_file(
    pool: &SqlitePool,
    request: BrowserTailOpenRequest,
) -> anyhow::Result<BrowserTailStatus> {
    let source_id = valid_source_id(&request.source_id)?;
    let source_name = non_empty(&request.source_name, "source_name")?;
    let file_name = valid_file_name(&request.file_name)?;
    let header_line = valid_header(&request.header_line)?;

    if request.file_size < 0 || request.last_modified_ms < 0 {
        bail!("file size and modified time must not be negative");
    }

    let minimum_header_bytes = header_line.len() as i64 + 1;
    if request.header_end_offset < minimum_header_bytes
        || request.header_end_offset > minimum_header_bytes + 4
        || request.header_end_offset > request.file_size
    {
        bail!("header_end_offset does not match the selected CSV header");
    }

    let timestamp = now();
    sqlx::query(
        r#"
        INSERT INTO browser_tail_sources (source_id, name, last_seen_at, updated_at)
        VALUES (?1, ?2, ?3, ?3)
        ON CONFLICT(source_id) DO UPDATE SET
            name = excluded.name,
            last_seen_at = excluded.last_seen_at,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(&source_id)
    .bind(&source_name)
    .bind(&timestamp)
    .execute(pool)
    .await?;

    if let Some(existing) = load_file(pool, &source_id, &file_name).await? {
        if request.file_size < existing.byte_offset {
            bail!(
                "CSV `{file_name}` was truncated or replaced; select the folder again after archiving the old file"
            );
        }

        sqlx::query(
            r#"
            UPDATE browser_tail_files
            SET file_size = MAX(file_size, ?3), last_modified_ms = ?4, updated_at = ?5
            WHERE source_id = ?1 AND file_name = ?2
            "#,
        )
        .bind(&source_id)
        .bind(&file_name)
        .bind(request.file_size)
        .bind(request.last_modified_ms)
        .bind(&timestamp)
        .execute(pool)
        .await?;

        if existing.completed == 0 {
            sqlx::query(
                r#"
                UPDATE browser_tail_sources
                SET active_file_name = ?2, active_run_id = ?3, last_seen_at = ?4, updated_at = ?4
                WHERE source_id = ?1
                "#,
            )
            .bind(&source_id)
            .bind(&file_name)
            .bind(existing.run_id)
            .bind(&timestamp)
            .execute(pool)
            .await?;
        }

        return status_for_file(pool, &source_id, &file_name).await;
    }

    let source = load_source(pool, &source_id)
        .await?
        .ok_or_else(|| anyhow!("browser tail source was not created"))?;

    if let (Some(active_file_name), Some(active_run_id)) =
        (source.active_file_name.as_deref(), source.active_run_id)
    {
        if active_file_name != file_name {
            complete_file(pool, &source_id, active_file_name, active_run_id).await?;
        }
    }

    let run_id = create_run(
        pool,
        CreateRunRequest {
            name: file_name.clone(),
            source_kind: "csv_tail".to_string(),
            source_name: Some(format!("{source_name}/{file_name}")),
            started_at: None,
            notes: Some("CSV selected in the operator browser and tailed over HTTPS".to_string()),
        },
    )
    .await?;

    sqlx::query(
        r#"
        INSERT INTO browser_tail_files (
            source_id,
            file_name,
            run_id,
            header_line,
            byte_offset,
            last_source_sequence,
            file_size,
            last_modified_ms,
            completed,
            updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, 0, ?8)
        "#,
    )
    .bind(&source_id)
    .bind(&file_name)
    .bind(run_id)
    .bind(&header_line)
    .bind(request.header_end_offset)
    .bind(request.file_size)
    .bind(request.last_modified_ms)
    .bind(&timestamp)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        UPDATE browser_tail_sources
        SET active_file_name = ?2, active_run_id = ?3, last_seen_at = ?4, updated_at = ?4
        WHERE source_id = ?1
        "#,
    )
    .bind(&source_id)
    .bind(&file_name)
    .bind(run_id)
    .bind(&timestamp)
    .execute(pool)
    .await?;

    status_for_file(pool, &source_id, &file_name).await
}

pub async fn sync_chunk(
    pool: &SqlitePool,
    request: BrowserTailChunkRequest,
) -> anyhow::Result<BrowserTailChunkResponse> {
    let source_id = valid_source_id(&request.source_id)?;
    let file_name = valid_file_name(&request.file_name)?;

    if request.offset < 0 {
        bail!("offset must not be negative");
    }
    if request.rows_text.is_empty() {
        bail!("rows_text must not be empty");
    }
    if request.rows_text.len() > MAX_CHUNK_BYTES {
        bail!("CSV chunk exceeds the {MAX_CHUNK_BYTES} byte limit");
    }

    let checkpoint = load_file(pool, &source_id, &file_name)
        .await?
        .ok_or_else(|| anyhow!("CSV `{file_name}` is not open for this browser source"))?;

    if checkpoint.completed == 1 {
        bail!("CSV `{file_name}` is already completed");
    }

    if request.offset < checkpoint.byte_offset {
        return Ok(BrowserTailChunkResponse {
            status: status_for_file(pool, &source_id, &file_name).await?,
            inserted_count: 0,
            skipped_count: 0,
            replayed: true,
        });
    }
    if request.offset > checkpoint.byte_offset {
        bail!(
            "offset mismatch for `{file_name}`: server expects {}, browser sent {}",
            checkpoint.byte_offset,
            request.offset
        );
    }

    let mut csv_bytes =
        Vec::with_capacity(checkpoint.header_line.len() + 1 + request.rows_text.len());
    csv_bytes.extend_from_slice(checkpoint.header_line.as_bytes());
    csv_bytes.push(b'\n');
    csv_bytes.extend_from_slice(request.rows_text.as_bytes());
    let parsed = parse_csv_bytes(&file_name, &csv_bytes)?;
    let sample_count = parsed.frames.len() as i64;
    let (inserted_count, skipped_count) = if sample_count == 0 {
        (0, 0)
    } else {
        let append_request = parsed_to_append_request(parsed, checkpoint.last_source_sequence + 1);
        let report = append_samples(pool, checkpoint.run_id, append_request).await?;
        (report.inserted_count, report.skipped_count)
    };
    let new_offset = checkpoint.byte_offset + request.rows_text.len() as i64;
    let new_sequence = checkpoint.last_source_sequence + sample_count;
    let timestamp = now();

    sqlx::query(
        r#"
        UPDATE browser_tail_files
        SET
            byte_offset = ?3,
            last_source_sequence = ?4,
            file_size = MAX(file_size, ?3),
            updated_at = ?5
        WHERE source_id = ?1 AND file_name = ?2
        "#,
    )
    .bind(&source_id)
    .bind(&file_name)
    .bind(new_offset)
    .bind(new_sequence)
    .bind(&timestamp)
    .execute(pool)
    .await?;

    sqlx::query(
        "UPDATE browser_tail_sources SET last_seen_at = ?2, updated_at = ?2 WHERE source_id = ?1",
    )
    .bind(&source_id)
    .bind(&timestamp)
    .execute(pool)
    .await?;

    Ok(BrowserTailChunkResponse {
        status: status_for_file(pool, &source_id, &file_name).await?,
        inserted_count,
        skipped_count,
        replayed: false,
    })
}

pub async fn source_status(
    pool: &SqlitePool,
    source_id: &str,
) -> anyhow::Result<BrowserTailStatus> {
    let source_id = valid_source_id(source_id)?;
    let source = load_source(pool, &source_id)
        .await?
        .ok_or_else(|| anyhow!("browser tail source `{source_id}` was not found"))?;

    match source.active_file_name.as_deref() {
        Some(file_name) => status_for_file(pool, &source_id, file_name).await,
        None => Ok(BrowserTailStatus {
            source_id: source.source_id,
            source_name: source.name,
            active_file_name: None,
            active_run_id: None,
            byte_offset: None,
            last_source_sequence: None,
            file_size: None,
            last_modified_ms: None,
            completed: None,
            last_sampled_at: None,
            last_seen_at: source.last_seen_at,
        }),
    }
}

async fn status_for_file(
    pool: &SqlitePool,
    source_id: &str,
    file_name: &str,
) -> anyhow::Result<BrowserTailStatus> {
    let source = load_source(pool, source_id)
        .await?
        .ok_or_else(|| anyhow!("browser tail source `{source_id}` was not found"))?;
    let file = load_file(pool, source_id, file_name)
        .await?
        .ok_or_else(|| anyhow!("CSV `{file_name}` was not found"))?;
    let last_sampled_at = sqlx::query_scalar::<_, Option<String>>(
        "SELECT MAX(sampled_at) FROM sample_frames WHERE run_id = ?1",
    )
    .bind(file.run_id)
    .fetch_one(pool)
    .await?;

    Ok(BrowserTailStatus {
        source_id: source.source_id,
        source_name: source.name,
        active_file_name: Some(file.file_name),
        active_run_id: Some(file.run_id),
        byte_offset: Some(file.byte_offset),
        last_source_sequence: Some(file.last_source_sequence),
        file_size: Some(file.file_size),
        last_modified_ms: Some(file.last_modified_ms),
        completed: Some(file.completed == 1),
        last_sampled_at,
        last_seen_at: source.last_seen_at,
    })
}

async fn complete_file(
    pool: &SqlitePool,
    source_id: &str,
    file_name: &str,
    run_id: i64,
) -> anyhow::Result<()> {
    let timestamp = now();
    sqlx::query(
        "UPDATE browser_tail_files SET completed = 1, updated_at = ?3 WHERE source_id = ?1 AND file_name = ?2",
    )
    .bind(source_id)
    .bind(file_name)
    .bind(&timestamp)
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
        UPDATE runs
        SET
            status = 'completed',
            finished_at = COALESCE(
                finished_at,
                (SELECT MAX(sampled_at) FROM sample_frames WHERE run_id = ?1)
            )
        WHERE id = ?1 AND status = 'running'
        "#,
    )
    .bind(run_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn load_source(
    pool: &SqlitePool,
    source_id: &str,
) -> anyhow::Result<Option<BrowserTailSourceRow>> {
    Ok(sqlx::query_as::<_, BrowserTailSourceRow>(
        r#"
        SELECT source_id, name, active_file_name, active_run_id, last_seen_at
        FROM browser_tail_sources
        WHERE source_id = ?1
        "#,
    )
    .bind(source_id)
    .fetch_optional(pool)
    .await?)
}

async fn load_file(
    pool: &SqlitePool,
    source_id: &str,
    file_name: &str,
) -> anyhow::Result<Option<BrowserTailFileRow>> {
    Ok(sqlx::query_as::<_, BrowserTailFileRow>(
        r#"
        SELECT
            file_name,
            run_id,
            header_line,
            byte_offset,
            last_source_sequence,
            file_size,
            last_modified_ms,
            completed
        FROM browser_tail_files
        WHERE source_id = ?1 AND file_name = ?2
        "#,
    )
    .bind(source_id)
    .bind(file_name)
    .fetch_optional(pool)
    .await?)
}

fn parsed_to_append_request(parsed: ParsedCsv, first_sequence: i64) -> AppendSamplesRequest {
    let samples = parsed
        .frames
        .into_iter()
        .enumerate()
        .map(|(index, frame)| AppendSampleRequest {
            sampled_at: frame.sampled_at,
            source_timestamp_text: Some(frame.source_timestamp_text),
            source_sequence: Some(first_sequence + index as i64),
            state_observation: None,
            measurements: frame
                .measurements
                .into_iter()
                .map(|measurement| AppendMeasurementRequest {
                    channel_code: measurement.channel_code,
                    raw_text: Some(measurement.raw_text),
                    numeric_value: measurement.numeric_value,
                    value_text: measurement.value_text,
                    value_type: Some(measurement.value_type.as_str().to_string()),
                    quality: Some(measurement.quality.as_str().to_string()),
                    quality_reason: measurement.quality_reason,
                })
                .collect(),
        })
        .collect();

    AppendSamplesRequest { samples }
}

fn valid_source_id(value: &str) -> anyhow::Result<String> {
    let value = non_empty(value, "source_id")?;
    if value.len() < 8
        || value.len() > 128
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        bail!("source_id must be 8-128 ASCII letters, digits, hyphens, or underscores");
    }
    Ok(value)
}

fn valid_file_name(value: &str) -> anyhow::Result<String> {
    let value = non_empty(value, "file_name")?;
    if value.len() > 255 || value.contains('/') || value.contains('\\') {
        bail!("file_name must be a plain file name");
    }
    if !value.to_ascii_lowercase().ends_with(".csv") {
        bail!("file_name must end with .csv");
    }
    Ok(value)
}

fn valid_header(value: &str) -> anyhow::Result<String> {
    let value = value.trim_start_matches('\u{feff}').trim().to_string();
    if value.len() > 64 * 1024 || value.contains('\n') || value.contains('\r') {
        bail!("CSV header is invalid");
    }
    let columns = value.split(';').map(str::trim).collect::<Vec<_>>();
    if !columns.contains(&"TARIH SAAT") || columns.len() < 2 {
        bail!("CSV header must contain `TARIH SAAT` and at least one measurement channel");
    }
    Ok(value)
}

fn non_empty(value: &str, label: &str) -> anyhow::Result<String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        bail!("{label} must not be empty");
    }
    Ok(value)
}

fn now() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}
