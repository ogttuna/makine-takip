use std::collections::{HashMap, HashSet};

use anyhow::{Context, anyhow, bail};
use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};

const TIMESTAMP_COLUMN: &str = "TARIH SAAT";
const TIME_COLUMN: &str = "SAAT";
const TIMESTAMP_FORMAT: &str = "%Y-%m-%d-%H:%M:%S%.f";
const DISPLAY_TIMESTAMP_FORMAT: &str = "%Y-%m-%dT%H:%M:%S%.3f";
const SOURCE_TIMESTAMP_FORMAT: &str = "%Y-%m-%d-%H:%M:%S%.3f";
const TIME_GAP_WARNING_SECONDS: f64 = 360.0;
const PARSER_VERSION: &str = "csv-import-v4-excel-tolerant";

#[derive(Debug, Clone, Serialize)]
pub struct ImportReport {
    pub import_id: i64,
    pub run_id: i64,
    pub duplicate: bool,
    pub file_name: String,
    pub file_sha256: String,
    pub row_count: usize,
    pub channel_count: usize,
    pub warning_count: usize,
    pub error_count: usize,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ParsedCsv {
    pub file_name: String,
    pub file_sha256: String,
    pub channel_codes: Vec<String>,
    pub record_count: usize,
    pub frames: Vec<ParsedFrame>,
    pub quality_events: Vec<ParsedQualityEvent>,
    pub warning_count: usize,
    pub error_count: usize,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ParsedFrame {
    pub sampled_at: String,
    pub source_timestamp_text: String,
    pub source_row_number: i64,
    pub state_observation: Option<ParsedStateObservation>,
    pub measurements: Vec<ParsedMeasurement>,
}

#[derive(Debug, Clone)]
pub struct ParsedStateObservation {
    pub source_recipe_code: Option<String>,
    pub source_recipe_version: Option<String>,
    pub source_state_code: String,
    pub source_state_name: Option<String>,
    pub source_payload_json: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct ParsedMeasurement {
    pub channel_code: String,
    pub raw_text: String,
    pub numeric_value: Option<f64>,
    pub value_text: Option<String>,
    pub value_type: ValueType,
    pub quality: MeasurementQuality,
    pub quality_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValueType {
    Number,
    Text,
}

impl ValueType {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Number => "number",
            Self::Text => "text",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeasurementQuality {
    Good,
    Suspect,
    Invalid,
}

impl MeasurementQuality {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Good => "good",
            Self::Suspect => "suspect",
            Self::Invalid => "invalid",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ParsedQualityEvent {
    pub source_row_number: i64,
    pub channel_code: Option<String>,
    pub event_type: String,
    pub severity: String,
    pub message: String,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, Copy)]
enum TimestampMode {
    Full,
    TimeOnly(NaiveDate),
}

#[derive(Debug, Clone, Copy)]
struct TimestampSource {
    index: usize,
    mode: TimestampMode,
}

pub fn parse_csv_bytes(file_name: impl Into<String>, bytes: &[u8]) -> anyhow::Result<ParsedCsv> {
    let file_name = file_name.into();
    let file_sha256 = sha256_hex(bytes);
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(b';')
        .trim(csv::Trim::All)
        .flexible(true)
        .from_reader(bytes);

    let headers = reader
        .headers()
        .context("failed to read CSV headers")?
        .iter()
        .map(|header| header.trim().trim_start_matches('\u{feff}').to_string())
        .collect::<Vec<_>>();
    let timestamp_source = timestamp_source(&file_name, &headers)?;
    let mut canonical_codes = HashSet::<String>::new();
    let mut channel_columns = Vec::<(String, usize, String)>::new();

    for (index, header) in headers.iter().enumerate() {
        if index == timestamp_source.index {
            continue;
        }

        let canonical = canonical_channel_code(header);

        if !canonical_codes.insert(canonical.clone()) {
            bail!("CSV contains multiple columns that map to canonical channel `{canonical}`");
        }

        channel_columns.push((canonical, index, header.clone()));
    }

    let channel_codes = channel_columns
        .iter()
        .map(|(canonical, _, _)| canonical.clone())
        .collect::<Vec<_>>();

    if channel_codes.is_empty() {
        bail!("CSV does not contain any measurement channels");
    }

    let mut frames = Vec::new();
    let mut quality_events = Vec::new();
    let mut warning_count = 0_usize;
    let mut error_count = 0_usize;
    let mut record_count = 0_usize;
    let mut previous_sampled_at: Option<NaiveDateTime> = None;
    let mut earliest_sampled_at: Option<NaiveDateTime> = None;
    let mut latest_sampled_at: Option<NaiveDateTime> = None;

    for record in reader.records() {
        record_count += 1;
        let source_row_number = (record_count + 1) as i64;
        let raw_line = raw_csv_line(bytes, source_row_number as usize);
        let record = match record {
            Ok(record) => record,
            Err(error) => {
                error_count += 1;
                quality_events.push(csv_row_quality_event(
                    &file_name,
                    source_row_number,
                    "csv_row_decode_error",
                    "error",
                    format!("row {source_row_number} could not be decoded: {error}"),
                    raw_line,
                    None,
                    None,
                ));
                continue;
            }
        };

        let extra_values = record
            .iter()
            .skip(headers.len())
            .filter(|value| !value.trim().is_empty())
            .collect::<Vec<_>>();

        if !extra_values.is_empty() {
            error_count += 1;
            quality_events.push(csv_row_quality_event(
                &file_name,
                source_row_number,
                "csv_row_shape_error",
                "error",
                format!(
                    "row {source_row_number} has {} fields; expected {} and extra fields are not empty",
                    record.len(),
                    headers.len()
                ),
                raw_line,
                None,
                Some(serde_json::json!({
                    "actual_field_count": record.len(),
                    "expected_field_count": headers.len(),
                })),
            ));
            continue;
        }

        if record.len() != headers.len() {
            warning_count += 1;
            quality_events.push(csv_row_quality_event(
                &file_name,
                source_row_number,
                "csv_row_shape_warning",
                "warning",
                format!(
                    "row {source_row_number} has {} fields; expected {}; known fields were retained",
                    record.len(),
                    headers.len()
                ),
                raw_line.clone(),
                record.get(timestamp_source.index).map(str::trim),
                Some(serde_json::json!({
                    "actual_field_count": record.len(),
                    "expected_field_count": headers.len(),
                })),
            ));
        }

        let timestamp_text = record
            .get(timestamp_source.index)
            .map(str::trim)
            .unwrap_or_default();
        let sampled_at = match parse_timestamp(timestamp_source.mode, timestamp_text) {
            Ok(sampled_at) => sampled_at,
            Err(error) => {
                error_count += 1;
                quality_events.push(csv_row_quality_event(
                    &file_name,
                    source_row_number,
                    "csv_row_timestamp_error",
                    "error",
                    format!(
                        "row {source_row_number} has invalid timestamp `{timestamp_text}`: {error}"
                    ),
                    raw_line,
                    Some(timestamp_text),
                    None,
                ));
                continue;
            }
        };
        let source_timestamp_text = match timestamp_source.mode {
            TimestampMode::Full => timestamp_text.to_string(),
            TimestampMode::TimeOnly(_) => sampled_at.format(SOURCE_TIMESTAMP_FORMAT).to_string(),
        };

        if let Some(previous) = previous_sampled_at {
            let gap_seconds = (sampled_at - previous).num_milliseconds() as f64 / 1_000.0;

            if gap_seconds < 0.0 {
                warning_count += 1;
                quality_events.push(ParsedQualityEvent {
                    source_row_number,
                    channel_code: None,
                    event_type: "timestamp_out_of_order".to_string(),
                    severity: "warning".to_string(),
                    message: format!(
                        "timestamp moved backwards by {:.3} seconds before this sample",
                        gap_seconds.abs()
                    ),
                    metadata_json: Some(
                        serde_json::json!({
                            "source_file_name": file_name,
                            "source_row_number": source_row_number,
                            "gap_seconds": gap_seconds,
                            "previous_timestamp": previous.format(DISPLAY_TIMESTAMP_FORMAT).to_string(),
                            "current_timestamp": sampled_at.format(DISPLAY_TIMESTAMP_FORMAT).to_string()
                        })
                        .to_string(),
                    ),
                });
            } else if gap_seconds > TIME_GAP_WARNING_SECONDS {
                warning_count += 1;
                quality_events.push(ParsedQualityEvent {
                    source_row_number,
                    channel_code: None,
                    event_type: "time_gap".to_string(),
                    severity: "warning".to_string(),
                    message: format!("time gap of {gap_seconds:.3} seconds before this sample"),
                    metadata_json: Some(
                        serde_json::json!({
                            "source_file_name": file_name,
                            "source_row_number": source_row_number,
                            "gap_seconds": gap_seconds,
                            "previous_timestamp": previous.format(DISPLAY_TIMESTAMP_FORMAT).to_string(),
                            "current_timestamp": sampled_at.format(DISPLAY_TIMESTAMP_FORMAT).to_string()
                        })
                        .to_string(),
                    ),
                });
            }
        }

        previous_sampled_at = Some(sampled_at);
        earliest_sampled_at =
            Some(earliest_sampled_at.map_or(sampled_at, |current| current.min(sampled_at)));
        latest_sampled_at =
            Some(latest_sampled_at.map_or(sampled_at, |current| current.max(sampled_at)));

        let mut measurements = Vec::with_capacity(channel_codes.len());

        for (channel_code, column_index, source_header) in &channel_columns {
            let raw_text = record
                .get(*column_index)
                .map(str::trim)
                .unwrap_or_default()
                .to_string();
            let parsed_value = parse_numeric_value(&raw_text);
            let (numeric_value, value_text, value_type, quality, quality_reason) =
                match parsed_value {
                    Some(value) => (
                        Some(value),
                        None,
                        ValueType::Number,
                        MeasurementQuality::Good,
                        None,
                    ),
                    None => {
                        error_count += 1;
                        quality_events.push(ParsedQualityEvent {
                            source_row_number,
                            channel_code: Some(channel_code.clone()),
                            event_type: "parse_error".to_string(),
                            severity: "error".to_string(),
                            message: format!(
                                "channel `{channel_code}` value `{raw_text}` could not be parsed as number"
                            ),
                            metadata_json: Some(
                                serde_json::json!({
                                    "source_file_name": file_name,
                                    "source_row_number": source_row_number,
                                    "channel_code": channel_code,
                                    "source_header": source_header,
                                    "raw_text": raw_text,
                                })
                                .to_string(),
                            ),
                        });

                        (
                            None,
                            Some(raw_text.clone()),
                            ValueType::Text,
                            MeasurementQuality::Invalid,
                            Some("numeric_parse_error".to_string()),
                        )
                    }
                };

            measurements.push(ParsedMeasurement {
                channel_code: channel_code.clone(),
                raw_text,
                numeric_value,
                value_text,
                value_type,
                quality,
                quality_reason,
            });
        }

        let state_observation = parsed_state_observation(&measurements);
        frames.push(ParsedFrame {
            sampled_at: sampled_at.format(DISPLAY_TIMESTAMP_FORMAT).to_string(),
            source_timestamp_text,
            source_row_number,
            state_observation,
            measurements,
        });
    }

    if record_count == 0 {
        bail!("CSV does not contain any data rows");
    }

    let started_at = earliest_sampled_at
        .map(|sampled_at| sampled_at.format(DISPLAY_TIMESTAMP_FORMAT).to_string());
    let finished_at =
        latest_sampled_at.map(|sampled_at| sampled_at.format(DISPLAY_TIMESTAMP_FORMAT).to_string());

    Ok(ParsedCsv {
        file_name,
        file_sha256,
        channel_codes,
        record_count,
        frames,
        quality_events,
        warning_count,
        error_count,
        started_at,
        finished_at,
    })
}

pub fn validate_csv_header(file_name: &str, header_line: &str) -> anyhow::Result<String> {
    let header_line = header_line
        .trim_start_matches('\u{feff}')
        .trim()
        .to_string();

    if header_line.is_empty()
        || header_line.len() > 64 * 1024
        || header_line.contains('\n')
        || header_line.contains('\r')
    {
        bail!("CSV header is invalid");
    }

    let headers = parse_header_line(&header_line)?;
    let timestamp_source = timestamp_source(file_name, &headers)?;
    let mut canonical_codes = HashSet::new();

    for (index, header) in headers.iter().enumerate() {
        if index == timestamp_source.index {
            continue;
        }

        let canonical = canonical_channel_code(header);
        if canonical.is_empty() {
            bail!("CSV contains an empty measurement channel");
        }
        if !canonical_codes.insert(canonical.clone()) {
            bail!("CSV contains multiple columns that map to canonical channel `{canonical}`");
        }
    }

    if canonical_codes.is_empty() {
        bail!("CSV does not contain any measurement channels");
    }

    Ok(header_line)
}

fn parse_header_line(header_line: &str) -> anyhow::Result<Vec<String>> {
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(b';')
        .has_headers(false)
        .flexible(true)
        .from_reader(header_line.as_bytes());
    let record = reader
        .records()
        .next()
        .transpose()
        .context("failed to decode CSV header")?
        .ok_or_else(|| anyhow!("CSV header is empty"))?;

    Ok(record
        .iter()
        .map(|header| header.trim().trim_start_matches('\u{feff}').to_string())
        .collect())
}

pub async fn record_csv_row_quality_events(
    pool: &SqlitePool,
    run_id: i64,
    file_name: &str,
    events: &[ParsedQualityEvent],
    first_sequence: i64,
) -> anyhow::Result<usize> {
    let mut rejected_count = 0_usize;

    for event in events
        .iter()
        .filter(|event| event.event_type.starts_with("csv_row_"))
    {
        let absolute_row_number = first_sequence + event.source_row_number - 2;
        let original_metadata = event
            .metadata_json
            .as_deref()
            .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok());
        let metadata_json = serde_json::json!({
            "source_file_name": file_name,
            "source_file_row_number": event.source_row_number,
            "source_row_number": absolute_row_number,
            "details": original_metadata,
        })
        .to_string();
        let message = format!(
            "CSV `{file_name}` file row {}: {}",
            event.source_row_number, event.message
        );
        let result = sqlx::query(
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
            SELECT ?1, NULL, NULL, ?2, ?3, ?4, ?5
            WHERE NOT EXISTS (
                SELECT 1
                FROM quality_events
                WHERE run_id = ?1 AND event_type = ?2 AND metadata_json = ?5
            )
            "#,
        )
        .bind(run_id)
        .bind(&event.event_type)
        .bind(&event.severity)
        .bind(message)
        .bind(metadata_json)
        .execute(pool)
        .await?;
        if event.severity == "error" {
            rejected_count += result.rows_affected() as usize;
        }
    }

    Ok(rejected_count)
}

fn timestamp_source(file_name: &str, headers: &[String]) -> anyhow::Result<TimestampSource> {
    let timestamp_indices = headers
        .iter()
        .enumerate()
        .filter_map(|(index, header)| header_matches(header, TIMESTAMP_COLUMN).then_some(index))
        .collect::<Vec<_>>();
    let time_indices = headers
        .iter()
        .enumerate()
        .filter_map(|(index, header)| header_matches(header, TIME_COLUMN).then_some(index))
        .collect::<Vec<_>>();

    match (timestamp_indices.as_slice(), time_indices.as_slice()) {
        ([index], []) => Ok(TimestampSource {
            index: *index,
            mode: TimestampMode::Full,
        }),
        ([], [index]) => {
            let date = log_file_date(file_name).ok_or_else(|| {
                anyhow!(
                    "CSV with `SAAT` must use a `LogFile_YYYY_MM_DD.csv` file name so the date can be recovered"
                )
            })?;
            Ok(TimestampSource {
                index: *index,
                mode: TimestampMode::TimeOnly(date),
            })
        }
        _ => {
            bail!("CSV must contain exactly one timestamp column: `TARIH SAAT` or `SAAT`")
        }
    }
}

fn header_matches(value: &str, expected: &str) -> bool {
    value
        .replace(['İ', 'ı'], "I")
        .eq_ignore_ascii_case(expected)
}

fn parse_timestamp(mode: TimestampMode, value: &str) -> anyhow::Result<NaiveDateTime> {
    match mode {
        TimestampMode::Full => [
            TIMESTAMP_FORMAT,
            "%Y-%m-%d-%H:%M:%S",
            "%Y-%m-%dT%H:%M:%S%.f",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d %H:%M:%S%.f",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%d.%m.%Y %H:%M:%S%.f",
            "%d.%m.%Y %H:%M:%S",
            "%d.%m.%Y %H:%M",
            "%d/%m/%Y %H:%M:%S%.f",
            "%d/%m/%Y %H:%M:%S",
            "%d/%m/%Y %H:%M",
        ]
        .iter()
        .find_map(|format| NaiveDateTime::parse_from_str(value, format).ok())
        .ok_or_else(|| anyhow!("expected a supported date and time value")),
        TimestampMode::TimeOnly(date) => ["%H:%M:%S%.f", "%H:%M:%S", "%H:%M"]
            .iter()
            .find_map(|format| NaiveTime::parse_from_str(value, format).ok())
            .map(|time| date.and_time(time))
            .ok_or_else(|| anyhow!("expected HH:mm, HH:mm:ss, or HH:mm:ss.SSS")),
    }
}

fn log_file_date(file_name: &str) -> Option<NaiveDate> {
    let lower = file_name.to_ascii_lowercase();
    let date = lower.strip_prefix("logfile_")?.strip_suffix(".csv")?;
    let date = match date.rsplit_once(" (") {
        Some((canonical_date, copy_number))
            if copy_number.strip_suffix(')').is_some_and(|number| {
                !number.is_empty() && number.chars().all(|character| character.is_ascii_digit())
            }) =>
        {
            canonical_date
        }
        _ => date,
    };
    NaiveDate::parse_from_str(date, "%Y_%m_%d").ok()
}

pub(crate) fn parse_numeric_value(value: &str) -> Option<f64> {
    let value = value.trim();
    let parsed = value
        .parse::<f64>()
        .ok()
        .filter(|parsed| parsed.is_finite());
    if parsed.is_some() || !value.contains(',') {
        return parsed;
    }

    let normalized = if value.contains('.') {
        if value.rfind(',') > value.rfind('.') {
            value.replace('.', "").replace(',', ".")
        } else {
            value.replace(',', "")
        }
    } else {
        value.replace(',', ".")
    };

    normalized
        .parse::<f64>()
        .ok()
        .filter(|parsed| parsed.is_finite())
}

fn raw_csv_line(bytes: &[u8], source_row_number: usize) -> String {
    let Some(line) = bytes
        .split(|byte| *byte == b'\n')
        .nth(source_row_number.saturating_sub(1))
    else {
        return String::new();
    };
    let line = line.strip_suffix(b"\r").unwrap_or(line);
    String::from_utf8_lossy(line).into_owned()
}

#[allow(clippy::too_many_arguments)]
fn csv_row_quality_event(
    file_name: &str,
    source_row_number: i64,
    event_type: &str,
    severity: &str,
    message: String,
    raw_text: String,
    source_timestamp_text: Option<&str>,
    extra_metadata: Option<serde_json::Value>,
) -> ParsedQualityEvent {
    ParsedQualityEvent {
        source_row_number,
        channel_code: None,
        event_type: event_type.to_string(),
        severity: severity.to_string(),
        message,
        metadata_json: Some(
            serde_json::json!({
                "source_file_name": file_name,
                "source_row_number": source_row_number,
                "source_timestamp_text": source_timestamp_text,
                "raw_text": raw_text,
                "details": extra_metadata,
            })
            .to_string(),
        ),
    }
}

pub async fn import_csv_bytes(
    pool: &SqlitePool,
    file_name: impl Into<String>,
    bytes: &[u8],
) -> anyhow::Result<ImportReport> {
    let parsed = parse_csv_bytes(file_name, bytes)?;

    if let Some(report) = duplicate_report(pool, &parsed.file_sha256).await? {
        if let Err(error) = crate::analysis::analyze_run(pool, report.run_id).await {
            tracing::warn!(run_id = report.run_id, %error, "failed to refresh FD-750 analysis");
        }
        return Ok(report);
    }

    let mut tx = pool.begin().await?;
    let run_id: i64 = sqlx::query_scalar(
        r#"
        INSERT INTO runs (name, source_kind, source_name, started_at, finished_at, status)
        VALUES (?1, 'csv_import', ?2, ?3, ?4, 'imported')
        RETURNING id
        "#,
    )
    .bind(&parsed.file_name)
    .bind(&parsed.file_name)
    .bind(&parsed.started_at)
    .bind(&parsed.finished_at)
    .fetch_one(&mut *tx)
    .await?;

    let mut channel_ids = HashMap::new();

    for channel_code in &parsed.channel_codes {
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO channels (code, display_name, group_name, value_type)
            VALUES (?1, ?2, ?3, 'number')
            "#,
        )
        .bind(channel_code)
        .bind(channel_code)
        .bind(default_group(channel_code))
        .execute(&mut *tx)
        .await?;

        let channel_id: i64 = sqlx::query_scalar("SELECT id FROM channels WHERE code = ?1")
            .bind(channel_code)
            .fetch_one(&mut *tx)
            .await?;
        channel_ids.insert(channel_code.clone(), channel_id);
    }

    let mut frame_ids = HashMap::new();

    for frame in &parsed.frames {
        let frame_id: i64 = sqlx::query_scalar(
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
        .bind(&frame.sampled_at)
        .bind(&frame.source_timestamp_text)
        .bind(frame.source_row_number)
        .fetch_one(&mut *tx)
        .await?;
        frame_ids.insert(frame.source_row_number, frame_id);

        if let Some(observation) = &frame.state_observation {
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
            .bind(&frame.sampled_at)
            .bind(frame.source_row_number)
            .bind(&observation.source_recipe_code)
            .bind(&observation.source_recipe_version)
            .bind(&observation.source_state_code)
            .bind(&observation.source_state_name)
            .bind(
                observation
                    .source_payload_json
                    .as_ref()
                    .map(serde_json::Value::to_string),
            )
            .execute(&mut *tx)
            .await?;
        }

        for measurement in &frame.measurements {
            let channel_id = channel_ids
                .get(&measurement.channel_code)
                .copied()
                .ok_or_else(|| anyhow!("missing channel id for {}", measurement.channel_code))?;

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
            .bind(measurement.value_type.as_str())
            .bind(measurement.quality.as_str())
            .bind(&measurement.quality_reason)
            .execute(&mut *tx)
            .await?;
        }
    }

    for event in &parsed.quality_events {
        let frame_id = frame_ids.get(&event.source_row_number).copied();
        let channel_id = event
            .channel_code
            .as_ref()
            .and_then(|channel_code| channel_ids.get(channel_code).copied());

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
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
        )
        .bind(run_id)
        .bind(frame_id)
        .bind(channel_id)
        .bind(&event.event_type)
        .bind(&event.severity)
        .bind(&event.message)
        .bind(&event.metadata_json)
        .execute(&mut *tx)
        .await?;
    }

    let import_id: i64 = sqlx::query_scalar(
        r#"
        INSERT INTO import_files (
            run_id,
            file_name,
            file_sha256,
            row_count,
            warning_count,
            error_count,
            parser_version
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        RETURNING id
        "#,
    )
    .bind(run_id)
    .bind(&parsed.file_name)
    .bind(&parsed.file_sha256)
    .bind(parsed.frames.len() as i64)
    .bind(parsed.warning_count as i64)
    .bind(parsed.error_count as i64)
    .bind(PARSER_VERSION)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    if let Err(error) = crate::analysis::analyze_run(pool, run_id).await {
        tracing::warn!(run_id, %error, "failed to build FD-750 analysis after CSV import");
    }

    Ok(ImportReport {
        import_id,
        run_id,
        duplicate: false,
        file_name: parsed.file_name,
        file_sha256: parsed.file_sha256,
        row_count: parsed.frames.len(),
        channel_count: parsed.channel_codes.len(),
        warning_count: parsed.warning_count,
        error_count: parsed.error_count,
        started_at: parsed.started_at,
        finished_at: parsed.finished_at,
    })
}

async fn duplicate_report(
    pool: &SqlitePool,
    file_sha256: &str,
) -> anyhow::Result<Option<ImportReport>> {
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
        WHERE i.file_sha256 = ?1
        GROUP BY i.id
        "#,
    )
    .bind(file_sha256)
    .fetch_optional(pool)
    .await?
    else {
        return Ok(None);
    };

    Ok(Some(ImportReport {
        import_id: row.try_get::<i64, _>("import_id")?,
        run_id: row.try_get::<i64, _>("run_id")?,
        duplicate: true,
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

fn default_group(channel_code: &str) -> &'static str {
    match channel_code {
        "RAF1" | "RAF2" | "RAF3" | "RAF4" => "shelf",
        "L_PRES" | "H_PRES" => "pressure",
        "VACUM" => "vacuum",
        "S1" | "S2" | "S3" | "S4" | "SERP2" | "SERP4" | "KONDANSER" => "cooling",
        _ => "other",
    }
}

pub fn canonical_channel_code(value: &str) -> String {
    let normalized = value.trim().to_uppercase();

    match normalized.as_str() {
        "RAF1 HEDEF" | "RAF 1" => "RAF1".to_string(),
        "RAF2 HEDEF" | "RAF 2" => "RAF2".to_string(),
        "RAF3 HEDEF" | "RAF 3" => "RAF3".to_string(),
        "RAF4 HEDEF" | "RAF 4" => "RAF4".to_string(),
        "S 1" | "SERP1" => "S1".to_string(),
        "S 2" | "SERP2" => "S2".to_string(),
        "S 3" | "SERP3" => "S3".to_string(),
        "S 4" | "SERP4" => "S4".to_string(),
        "KOND" => "KONDANSER".to_string(),
        "VACUUM" => "VACUM".to_string(),
        _ => normalized,
    }
}

fn parsed_state_observation(measurements: &[ParsedMeasurement]) -> Option<ParsedStateObservation> {
    let recipe = measurement_text(measurements, "RECETE NO").filter(|value| !is_zero_like(value));
    let step =
        measurement_text(measurements, "RECETE ADIM").filter(|value| !is_zero_like(value))?;
    let normalized_step = normalize_state_token(step);

    Some(ParsedStateObservation {
        source_recipe_code: recipe.map(ToString::to_string),
        source_recipe_version: None,
        source_state_code: format!("STEP_{normalized_step}"),
        source_state_name: Some(format!("Reçete adım {step}")),
        source_payload_json: Some(serde_json::json!({
            "source": "csv",
            "recipe_no": recipe,
            "recipe_step": step,
        })),
    })
}

fn measurement_text<'a>(
    measurements: &'a [ParsedMeasurement],
    channel_code: &str,
) -> Option<&'a str> {
    measurements
        .iter()
        .find(|measurement| measurement.channel_code == channel_code)
        .map(|measurement| measurement.raw_text.trim())
        .filter(|value| !value.is_empty())
}

fn is_zero_like(value: &str) -> bool {
    parse_numeric_value(value).is_some_and(|parsed| parsed.abs() < f64::EPSILON)
}

fn normalize_state_token(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

#[cfg(test)]
mod tests {
    use super::{parse_csv_bytes, validate_csv_header};

    const SAMPLE_CSV: &[u8] = include_bytes!("../../fixtures/LogFile_2026_01_26.csv");

    #[test]
    fn parses_freeze_dry_csv_shape_and_quality() {
        let parsed = parse_csv_bytes("LogFile_2026_01_26.csv", SAMPLE_CSV).unwrap();

        assert_eq!(parsed.frames.len(), 144);
        assert_eq!(parsed.channel_codes.len(), 10);
        assert_eq!(
            parsed.started_at.as_deref(),
            Some("2026-01-26T11:08:17.626")
        );
        assert_eq!(
            parsed.finished_at.as_deref(),
            Some("2026-01-26T18:51:16.967")
        );
        assert_eq!(
            parsed
                .quality_events
                .iter()
                .filter(|event| event.event_type == "time_gap")
                .count(),
            3
        );
        assert_eq!(
            parsed
                .quality_events
                .iter()
                .filter(|event| event.event_type == "suspect_value")
                .count(),
            0
        );
        assert_eq!(parsed.warning_count, 3);
        assert_eq!(parsed.error_count, 0);
    }

    #[test]
    fn derives_the_date_from_a_daily_file_for_time_only_rows() {
        let csv = b"SAAT;RAF1;VACUM;RECETE NO;RECETE ADIM\r\n\
00:03;10;0.5;1;4\r\n\
00:08;11;0.4;1;5\r\n";
        let parsed = parse_csv_bytes("LogFile_2026_08_13.csv", csv).unwrap();

        assert_eq!(parsed.record_count, 2);
        assert_eq!(parsed.frames.len(), 2);
        assert_eq!(
            parsed.started_at.as_deref(),
            Some("2026-08-13T00:03:00.000")
        );
        assert_eq!(
            parsed.finished_at.as_deref(),
            Some("2026-08-13T00:08:00.000")
        );
        assert_eq!(
            parsed.frames[0].source_timestamp_text,
            "2026-08-13-00:03:00.000"
        );
        assert_eq!(parsed.warning_count, 0);
        assert_eq!(parsed.error_count, 0);
        assert_eq!(
            parsed.frames[1]
                .state_observation
                .as_ref()
                .map(|observation| observation.source_state_code.as_str()),
            Some("STEP_5")
        );
    }

    #[test]
    fn isolates_bad_rows_and_keeps_valid_measurements_flowing() {
        let csv = b"SAAT;RAF1;VACUM\n\
00:00;10;0.5\n\
00:05;11\n\
00:06;12;0.4;unexpected\n\
not-a-time;13;0.3\n\
00:06;14;0.2\n";
        let parsed = parse_csv_bytes("LogFile_2026_08_14.csv", csv).unwrap();

        assert_eq!(parsed.record_count, 5);
        assert_eq!(parsed.frames.len(), 3);
        assert_eq!(parsed.warning_count, 1);
        assert_eq!(parsed.error_count, 3);
        assert_eq!(parsed.frames[0].source_row_number, 2);
        assert_eq!(parsed.frames[1].source_row_number, 3);
        assert_eq!(parsed.frames[2].source_row_number, 6);
        assert!(parsed.quality_events.iter().any(|event| {
            event.event_type == "csv_row_shape_error" && event.source_row_number == 4
        }));
        assert!(parsed.quality_events.iter().any(|event| {
            event.event_type == "csv_row_timestamp_error" && event.source_row_number == 5
        }));
        assert!(parsed.frames[1].measurements.iter().any(|measurement| {
            measurement.channel_code == "VACUM"
                && measurement.quality == super::MeasurementQuality::Invalid
        }));
    }

    #[test]
    fn requires_a_dated_file_name_when_only_time_is_available() {
        let csv = b"SAAT;RAF1\n00:03;10\n";
        let error = parse_csv_bytes("machine.csv", csv).unwrap_err();

        assert!(error.to_string().contains("LogFile_YYYY_MM_DD.csv"));
    }

    #[test]
    fn manual_import_recovers_date_from_a_download_copy_name() {
        let csv = b"SAAT;RAF1\n00:03;10\n";
        let parsed = parse_csv_bytes("LogFile_2026_08_14 (1).csv", csv).unwrap();

        assert_eq!(
            parsed.started_at.as_deref(),
            Some("2026-08-14T00:03:00.000")
        );
    }

    #[test]
    fn rejects_duplicate_timestamp_columns() {
        let csv = b"TARIH SAAT;TARIH SAAT;RAF1\n\
2026-08-14-00:03:00.000;2026-08-14-00:03:00.000;10\n";
        let error = parse_csv_bytes("LogFile_2026_08_14.csv", csv).unwrap_err();

        assert!(error.to_string().contains("exactly one timestamp column"));
    }

    #[test]
    fn normalizes_fd750_channels_and_extracts_recipe_step() {
        let csv = b"TARIH SAAT;RAF1 HEDEF;S 1;S 2;S 3;S 4;KOND;RECETE NO;RECETE ADIM\n\
2026-07-25-10:00:00.000;850;-30;-31;-32;-33;-40;6;4\n";
        let parsed = parse_csv_bytes("new-format.csv", csv).unwrap();
        let frame = &parsed.frames[0];

        assert_eq!(
            parsed.channel_codes,
            [
                "RAF1",
                "S1",
                "S2",
                "S3",
                "S4",
                "KONDANSER",
                "RECETE NO",
                "RECETE ADIM",
            ]
        );
        assert_eq!(
            frame
                .state_observation
                .as_ref()
                .map(|item| item.source_state_code.as_str()),
            Some("STEP_4")
        );
        assert_eq!(
            frame
                .state_observation
                .as_ref()
                .and_then(|item| item.source_recipe_code.as_deref()),
            Some("6")
        );
        assert!(frame.measurements.iter().all(|item| {
            item.channel_code != "RAF1" || item.quality == super::MeasurementQuality::Good
        }));
    }

    #[test]
    fn accepts_excel_decimal_commas_localized_dates_and_header_case() {
        let csv = "TARİH SAAT;raf1;vacum;E.TUKETIM\r\n\
14.08.2026 00:03:00;\"10,5\";\"0,4\";\"9.735,5\"\r\n";
        let parsed = parse_csv_bytes("excel-export.csv", csv.as_bytes()).unwrap();
        let frame = &parsed.frames[0];

        assert_eq!(
            parsed.started_at.as_deref(),
            Some("2026-08-14T00:03:00.000")
        );
        assert_eq!(parsed.error_count, 0);
        assert!(frame.measurements.iter().any(|measurement| {
            measurement.channel_code == "RAF1"
                && measurement.numeric_value == Some(10.5)
                && measurement.raw_text == "10,5"
        }));
        assert!(frame.measurements.iter().any(|measurement| {
            measurement.channel_code == "VACUM" && measurement.numeric_value == Some(0.4)
        }));
        assert!(frame.measurements.iter().any(|measurement| {
            measurement.channel_code == "E.TUKETIM" && measurement.numeric_value == Some(9_735.5)
        }));
    }

    #[test]
    fn retains_bad_excel_cells_and_keeps_later_values_flowing() {
        let csv = b"SAAT;RAF1;VACUM\n\
00:00;10;0.5\n\
00:05;#VALUE!;0.4\n\
00:10;12;0.3\n";
        let parsed = parse_csv_bytes("LogFile_2026_08_14.csv", csv).unwrap();

        assert_eq!(parsed.frames.len(), 3);
        assert_eq!(parsed.error_count, 1);
        assert!(parsed.frames[1].measurements.iter().any(|measurement| {
            measurement.channel_code == "RAF1"
                && measurement.raw_text == "#VALUE!"
                && measurement.numeric_value.is_none()
                && measurement.quality == super::MeasurementQuality::Invalid
        }));
        assert_eq!(
            parsed.frames[2]
                .measurements
                .iter()
                .find(|measurement| measurement.channel_code == "RAF1")
                .and_then(|measurement| measurement.numeric_value),
            Some(12.0)
        );
    }

    #[test]
    fn reports_out_of_order_rows_but_uses_true_time_bounds() {
        let csv = b"SAAT;RAF1\n\
00:10;10\n\
00:00;11\n\
00:05;12\n";
        let parsed = parse_csv_bytes("LogFile_2026_08_14.csv", csv).unwrap();

        assert_eq!(parsed.frames.len(), 3);
        assert_eq!(
            parsed.started_at.as_deref(),
            Some("2026-08-14T00:00:00.000")
        );
        assert_eq!(
            parsed.finished_at.as_deref(),
            Some("2026-08-14T00:10:00.000")
        );
        assert!(parsed.quality_events.iter().any(|event| {
            event.event_type == "timestamp_out_of_order" && event.source_row_number == 3
        }));
    }

    #[test]
    fn validates_excel_quoted_headers() {
        let header =
            validate_csv_header("LogFile_2026_08_14.csv", "\"SAAT\";\"RAF1\";\"VACUM\"").unwrap();

        assert_eq!(header, "\"SAAT\";\"RAF1\";\"VACUM\"");
    }
}
