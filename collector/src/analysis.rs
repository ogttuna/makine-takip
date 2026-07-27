use std::collections::HashMap;

use anyhow::{Context, anyhow};
use chrono::{NaiveDateTime, TimeDelta};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Row, SqlitePool};

pub const FD750_PROFILE_CODE: &str = "fd750_loop";
pub const FD750_PROFILE_VERSION: &str = "1.0.0";

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Fd750RuleConfig {
    pub shelf_off_value: f64,
    pub shelf_off_tolerance: f64,
    pub start_vacuum_upper: f64,
    pub stop_vacuum_lower: f64,
    pub defrost_start_temperature_c: f64,
    pub defrost_stop_power_upper: f64,
    pub state_reset_gap_minutes: f64,
    pub parallel_window_minutes: f64,
    pub parallel_window_tolerance_minutes: f64,
    pub minimum_s4_s2_change_c: f64,
    pub minimum_vacuum_change: f64,
    pub maximum_energy_gap_minutes: f64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AnalysisProfileResponse {
    pub id: i64,
    pub code: String,
    pub version: String,
    pub machine_model: String,
    pub config_json: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ProcessCycleResponse {
    pub id: i64,
    pub loop_number: i64,
    pub started_at: String,
    pub dry_started_at: Option<String>,
    pub stopped_at: Option<String>,
    pub wait_started_at: Option<String>,
    pub defrost_started_at: Option<String>,
    pub defrost_stopped_at: Option<String>,
    pub finished_at: Option<String>,
    pub status: String,
    pub confidence: f64,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ProcessStateSegmentResponse {
    pub id: i64,
    pub process_cycle_id: Option<i64>,
    pub loop_number: Option<i64>,
    pub state_code: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub confidence: f64,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct DiagnosticEventResponse {
    pub id: i64,
    pub process_cycle_id: Option<i64>,
    pub loop_number: Option<i64>,
    pub frame_id: Option<i64>,
    pub occurred_at: String,
    pub event_type: String,
    pub severity: String,
    pub message: String,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunAnalysisResponse {
    pub profile: AnalysisProfileResponse,
    pub cycles: Vec<ProcessCycleResponse>,
    pub segments: Vec<ProcessStateSegmentResponse>,
    pub events: Vec<DiagnosticEventResponse>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnalysisReport {
    pub run_id: i64,
    pub cycle_count: usize,
    pub segment_count: usize,
    pub diagnostic_event_count: usize,
    pub derived_measurement_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProcessState {
    Start,
    Dry,
    Stop,
    Wait,
    Defrost,
    DefrostStop,
}

impl ProcessState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Start => "START",
            Self::Dry => "DRY",
            Self::Stop => "STOP",
            Self::Wait => "WAIT",
            Self::Defrost => "DEFROST",
            Self::DefrostStop => "DEFROST_STOP",
        }
    }
}

#[derive(Debug)]
struct AnalysisFrame {
    id: i64,
    sampled_at: String,
    sampled_at_value: NaiveDateTime,
    source_sequence: i64,
    values: HashMap<String, f64>,
}

impl AnalysisFrame {
    fn value(&self, aliases: &[&str]) -> Option<f64> {
        aliases
            .iter()
            .find_map(|code| self.values.get(*code).copied())
    }

    fn shelf_values(&self) -> impl Iterator<Item = f64> + '_ {
        ["RAF1", "RAF2", "RAF3", "RAF4"]
            .into_iter()
            .filter_map(|code| self.values.get(code).copied())
    }

    fn coil_values(&self) -> impl Iterator<Item = f64> + '_ {
        [
            &["S1", "S 1"][..],
            &["S2", "S 2", "SERP2"][..],
            &["S3", "S 3"][..],
            &["S4", "S 4", "SERP4"][..],
        ]
        .into_iter()
        .filter_map(|aliases| self.value(aliases))
    }
}

#[derive(Debug)]
struct CycleBuild {
    loop_number: i64,
    started_at: String,
    dry_started_at: Option<String>,
    stopped_at: Option<String>,
    wait_started_at: Option<String>,
    defrost_started_at: Option<String>,
    defrost_stopped_at: Option<String>,
    finished_at: Option<String>,
    status: String,
    confidence: f64,
    start_frame_id: i64,
    end_frame_id: Option<i64>,
    metadata_json: Option<String>,
}

#[derive(Debug)]
struct SegmentBuild {
    loop_number: Option<i64>,
    state: ProcessState,
    started_at: String,
    finished_at: Option<String>,
    start_frame_id: i64,
    end_frame_id: Option<i64>,
    confidence: f64,
    metadata_json: String,
}

#[derive(Debug)]
struct DiagnosticBuild {
    loop_number: Option<i64>,
    frame_id: i64,
    occurred_at: String,
    event_type: &'static str,
    severity: &'static str,
    message: String,
    metadata_json: String,
}

#[derive(Debug)]
struct DerivedBuild {
    frame_id: i64,
    code: &'static str,
    numeric_value: f64,
    unit: Option<&'static str>,
    metadata_json: Option<String>,
}

pub async fn analyze_run(pool: &SqlitePool, run_id: i64) -> anyhow::Result<AnalysisReport> {
    let (profile, config) = load_fd750_profile(pool).await?;
    let run_status = sqlx::query_scalar::<_, String>("SELECT status FROM runs WHERE id = ?1")
        .bind(run_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow!("run {run_id} was not found"))?;
    let frames = load_frames(pool, run_id).await?;

    let mut cycles = Vec::<CycleBuild>::new();
    let mut segments = Vec::<SegmentBuild>::new();
    let mut diagnostics = Vec::<DiagnosticBuild>::new();
    let mut derived = Vec::<DerivedBuild>::new();

    if !frames.is_empty() {
        infer_states_and_cycles(
            &frames,
            &run_status,
            &config,
            &mut cycles,
            &mut segments,
            &mut diagnostics,
            &mut derived,
        );
        infer_parallel_events(&frames, &config, &segments, &mut diagnostics);
    }

    persist_analysis(
        pool,
        run_id,
        profile.id,
        &cycles,
        &segments,
        &diagnostics,
        &derived,
    )
    .await?;

    Ok(AnalysisReport {
        run_id,
        cycle_count: cycles.len(),
        segment_count: segments.len(),
        diagnostic_event_count: diagnostics.len(),
        derived_measurement_count: derived.len(),
    })
}

pub async fn analyze_missing_runs(pool: &SqlitePool) -> anyhow::Result<usize> {
    let profile = load_profile_response(pool).await?;
    let run_ids = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT r.id
        FROM runs r
        WHERE EXISTS (
            SELECT 1 FROM sample_frames f WHERE f.run_id = r.id
        )
        AND NOT EXISTS (
            SELECT 1
            FROM process_state_segments s
            WHERE s.run_id = r.id AND s.analysis_profile_id = ?1
        )
        ORDER BY r.id
        "#,
    )
    .bind(profile.id)
    .fetch_all(pool)
    .await?;

    for run_id in &run_ids {
        analyze_run(pool, *run_id).await?;
    }

    Ok(run_ids.len())
}

pub async fn fetch_run_analysis(
    pool: &SqlitePool,
    run_id: i64,
) -> anyhow::Result<RunAnalysisResponse> {
    let profile = load_profile_response(pool).await?;
    let cycles = sqlx::query_as::<_, ProcessCycleResponse>(
        r#"
        SELECT
            id,
            loop_number,
            started_at,
            dry_started_at,
            stopped_at,
            wait_started_at,
            defrost_started_at,
            defrost_stopped_at,
            finished_at,
            status,
            confidence,
            metadata_json
        FROM process_cycles
        WHERE run_id = ?1 AND analysis_profile_id = ?2
        ORDER BY loop_number ASC
        "#,
    )
    .bind(run_id)
    .bind(profile.id)
    .fetch_all(pool)
    .await?;
    let segments = sqlx::query_as::<_, ProcessStateSegmentResponse>(
        r#"
        SELECT
            s.id,
            s.process_cycle_id,
            c.loop_number,
            s.state_code,
            s.started_at,
            s.finished_at,
            s.confidence,
            s.metadata_json
        FROM process_state_segments s
        LEFT JOIN process_cycles c ON c.id = s.process_cycle_id
        WHERE s.run_id = ?1 AND s.analysis_profile_id = ?2
        ORDER BY s.started_at ASC, s.id ASC
        "#,
    )
    .bind(run_id)
    .bind(profile.id)
    .fetch_all(pool)
    .await?;
    let events = sqlx::query_as::<_, DiagnosticEventResponse>(
        r#"
        SELECT
            e.id,
            e.process_cycle_id,
            c.loop_number,
            e.frame_id,
            e.occurred_at,
            e.event_type,
            e.severity,
            e.message,
            e.metadata_json
        FROM diagnostic_events e
        LEFT JOIN process_cycles c ON c.id = e.process_cycle_id
        WHERE e.run_id = ?1 AND e.analysis_profile_id = ?2
        ORDER BY e.occurred_at ASC, e.id ASC
        "#,
    )
    .bind(run_id)
    .bind(profile.id)
    .fetch_all(pool)
    .await?;

    Ok(RunAnalysisResponse {
        profile,
        cycles,
        segments,
        events,
    })
}

async fn load_fd750_profile(
    pool: &SqlitePool,
) -> anyhow::Result<(AnalysisProfileResponse, Fd750RuleConfig)> {
    let profile = load_profile_response(pool).await?;
    let config = serde_json::from_str::<Fd750RuleConfig>(&profile.config_json)
        .context("FD-750 analysis profile contains invalid config_json")?;
    Ok((profile, config))
}

async fn load_profile_response(pool: &SqlitePool) -> anyhow::Result<AnalysisProfileResponse> {
    sqlx::query_as::<_, AnalysisProfileResponse>(
        r#"
        SELECT id, code, version, machine_model, config_json
        FROM analysis_profiles
        WHERE code = ?1 AND version = ?2 AND active = 1
        LIMIT 1
        "#,
    )
    .bind(FD750_PROFILE_CODE)
    .bind(FD750_PROFILE_VERSION)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow!("active FD-750 analysis profile was not found"))
}

async fn load_frames(pool: &SqlitePool, run_id: i64) -> anyhow::Result<Vec<AnalysisFrame>> {
    let rows = sqlx::query(
        r#"
        SELECT
            f.id AS frame_id,
            f.sampled_at,
            f.source_row_number,
            c.code AS channel_code,
            m.numeric_value
        FROM sample_frames f
        JOIN measurements m ON m.frame_id = f.id
        JOIN channels c ON c.id = m.channel_id
        WHERE f.run_id = ?1
        ORDER BY f.sampled_at ASC, f.source_row_number ASC, f.id ASC, c.id ASC
        "#,
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;

    let mut frames = Vec::<AnalysisFrame>::new();

    for row in rows {
        let frame_id = row.try_get::<i64, _>("frame_id")?;

        if frames
            .last()
            .map(|frame| frame.id != frame_id)
            .unwrap_or(true)
        {
            let sampled_at = row.try_get::<String, _>("sampled_at")?;
            frames.push(AnalysisFrame {
                id: frame_id,
                sampled_at_value: parse_sample_time(&sampled_at)?,
                sampled_at,
                source_sequence: row.try_get("source_row_number")?,
                values: HashMap::new(),
            });
        }

        if let Some(value) = row.try_get::<Option<f64>, _>("numeric_value")? {
            frames
                .last_mut()
                .expect("analysis frame was inserted before measurement")
                .values
                .insert(row.try_get::<String, _>("channel_code")?, value);
        }
    }

    Ok(frames)
}

fn infer_states_and_cycles(
    frames: &[AnalysisFrame],
    run_status: &str,
    config: &Fd750RuleConfig,
    cycles: &mut Vec<CycleBuild>,
    segments: &mut Vec<SegmentBuild>,
    diagnostics: &mut Vec<DiagnosticBuild>,
    derived: &mut Vec<DerivedBuild>,
) {
    let mut current_state: Option<ProcessState> = None;
    let mut current_segment_index: Option<usize> = None;
    let mut current_cycle_index: Option<usize> = None;
    let mut next_loop_number = 1_i64;
    let mut previous_frame: Option<&AnalysisFrame> = None;
    let mut previous_power: Option<f64> = None;
    let mut previous_weight: Option<f64> = None;
    let mut cumulative_energy = 0.0_f64;

    for frame in frames {
        let gap_minutes = previous_frame.map(|previous| {
            (frame.sampled_at_value - previous.sampled_at_value).num_milliseconds() as f64
                / 60_000.0
        });
        let active_shelf_count = frame
            .shelf_values()
            .filter(|value| !is_shelf_off(*value, config))
            .count();
        let hottest_coil = frame
            .coil_values()
            .filter(|value| !is_shelf_off(*value, config))
            .reduce(f64::max);
        let vacuum = frame.value(&["VACUM", "VACUUM"]);
        let power = frame.value(&["E.GUC", "E_GUC", "POWER"]);
        let weight = frame.value(&["TARTIM", "WEIGHT"]);

        derived.push(DerivedBuild {
            frame_id: frame.id,
            code: "ACTIVE_SHELF_COUNT",
            numeric_value: active_shelf_count as f64,
            unit: Some("count"),
            metadata_json: Some(
                serde_json::json!({
                    "off_value": config.shelf_off_value,
                    "off_tolerance": config.shelf_off_tolerance,
                })
                .to_string(),
            ),
        });

        if let Some(value) = hottest_coil {
            derived.push(DerivedBuild {
                frame_id: frame.id,
                code: "HOTTEST_COIL_C",
                numeric_value: value,
                unit: Some("°C"),
                metadata_json: None,
            });
        }

        if let (Some(s2), Some(s4)) = (
            frame.value(&["S2", "S 2", "SERP2"]),
            frame.value(&["S4", "S 4", "SERP4"]),
        ) {
            derived.push(DerivedBuild {
                frame_id: frame.id,
                code: "S4_S2_DEVIATION_C",
                numeric_value: s4 - s2,
                unit: Some("°C"),
                metadata_json: None,
            });
        }

        if let (Some(minutes), Some(previous), Some(current)) = (gap_minutes, previous_power, power)
            && minutes >= 0.0
            && minutes <= config.maximum_energy_gap_minutes
        {
            let interval_energy = ((previous + current) / 2.0) * (minutes / 60.0);
            cumulative_energy += interval_energy;
            derived.push(DerivedBuild {
                frame_id: frame.id,
                code: "INTERVAL_ENERGY_KWH",
                numeric_value: interval_energy,
                unit: Some("kWh"),
                metadata_json: Some(
                    serde_json::json!({
                        "method": "trapezoidal",
                        "interval_minutes": minutes,
                    })
                    .to_string(),
                ),
            });
        }

        if power.is_some() {
            derived.push(DerivedBuild {
                frame_id: frame.id,
                code: "CUMULATIVE_ENERGY_KWH",
                numeric_value: cumulative_energy,
                unit: Some("kWh"),
                metadata_json: Some(
                    serde_json::json!({
                        "maximum_integrated_gap_minutes": config.maximum_energy_gap_minutes,
                    })
                    .to_string(),
                ),
            });
        }

        if let (Some(previous), Some(current)) = (previous_weight, weight) {
            let delta = current - previous;
            derived.push(DerivedBuild {
                frame_id: frame.id,
                code: "WEIGHT_DELTA_KG",
                numeric_value: delta,
                unit: Some("kg"),
                metadata_json: Some(
                    serde_json::json!({
                        "interpretation": "unvalidated_raw_delta",
                    })
                    .to_string(),
                ),
            });
            derived.push(DerivedBuild {
                frame_id: frame.id,
                code: "WEIGHT_LOSS_KG",
                numeric_value: -delta,
                unit: Some("kg"),
                metadata_json: Some(
                    serde_json::json!({
                        "interpretation": "unvalidated_raw_delta",
                    })
                    .to_string(),
                ),
            });
        }

        if gap_minutes.is_some_and(|minutes| minutes > config.state_reset_gap_minutes) {
            if let (Some(index), Some(previous)) = (current_segment_index, previous_frame) {
                close_segment(&mut segments[index], previous);
            }

            if let Some(index) = current_cycle_index {
                let cycle = &mut cycles[index];
                if cycle.status == "active" {
                    cycle.status = "interrupted".to_string();
                    cycle.confidence = 0.45;
                    cycle.finished_at = previous_frame.map(|item| item.sampled_at.clone());
                    cycle.end_frame_id = previous_frame.map(|item| item.id);
                    cycle.metadata_json = Some(
                        serde_json::json!({
                            "reason": "state_reset_gap",
                            "gap_minutes": gap_minutes,
                        })
                        .to_string(),
                    );
                }
            }

            diagnostics.push(DiagnosticBuild {
                loop_number: current_cycle_index.map(|index| cycles[index].loop_number),
                frame_id: frame.id,
                occurred_at: frame.sampled_at.clone(),
                event_type: "fd750_state_chain_reset",
                severity: "warning",
                message: format!(
                    "FD-750 state chain reset after a {:.1} minute data gap",
                    gap_minutes.unwrap_or_default()
                ),
                metadata_json: serde_json::json!({
                    "gap_minutes": gap_minutes,
                    "threshold_minutes": config.state_reset_gap_minutes,
                    "previous_source_sequence": previous_frame.map(|item| item.source_sequence),
                    "current_source_sequence": frame.source_sequence,
                })
                .to_string(),
            });
            current_state = None;
            current_segment_index = None;
            current_cycle_index = None;
        }

        let start_condition =
            active_shelf_count > 0 && vacuum.is_some_and(|value| value < config.start_vacuum_upper);
        let stop_condition =
            active_shelf_count == 0 || vacuum.is_some_and(|value| value > config.stop_vacuum_lower);
        let next_state = match current_state {
            None if start_condition => ProcessState::Start,
            None => ProcessState::Wait,
            Some(ProcessState::Start) if start_condition && !stop_condition => ProcessState::Dry,
            Some(ProcessState::Start) => ProcessState::Stop,
            Some(ProcessState::Dry) if stop_condition => ProcessState::Stop,
            Some(ProcessState::Dry) => ProcessState::Dry,
            Some(ProcessState::Stop | ProcessState::Wait) if start_condition => ProcessState::Start,
            Some(ProcessState::Stop | ProcessState::Wait)
                if hottest_coil
                    .is_some_and(|value| value >= config.defrost_start_temperature_c) =>
            {
                ProcessState::Defrost
            }
            Some(ProcessState::Stop | ProcessState::Wait) => ProcessState::Wait,
            Some(ProcessState::Defrost | ProcessState::DefrostStop) if start_condition => {
                ProcessState::Start
            }
            Some(ProcessState::Defrost)
                if power.is_some_and(|value| value < config.defrost_stop_power_upper) =>
            {
                ProcessState::DefrostStop
            }
            Some(ProcessState::Defrost) => ProcessState::Defrost,
            Some(ProcessState::DefrostStop) => ProcessState::DefrostStop,
        };

        if current_state != Some(next_state) {
            if let (Some(index), Some(previous)) = (current_segment_index, previous_frame) {
                segments[index].finished_at = Some(frame.sampled_at.clone());
                segments[index].end_frame_id = Some(previous.id);
            }

            if next_state == ProcessState::Start {
                if let Some(index) = current_cycle_index {
                    finish_cycle_for_next_start(&mut cycles[index], frame);
                }

                cycles.push(CycleBuild {
                    loop_number: next_loop_number,
                    started_at: frame.sampled_at.clone(),
                    dry_started_at: None,
                    stopped_at: None,
                    wait_started_at: None,
                    defrost_started_at: None,
                    defrost_stopped_at: None,
                    finished_at: None,
                    status: "active".to_string(),
                    confidence: 0.95,
                    start_frame_id: frame.id,
                    end_frame_id: None,
                    metadata_json: Some(
                        serde_json::json!({
                            "active_shelf_count": active_shelf_count,
                            "vacuum": vacuum,
                            "start_vacuum_upper": config.start_vacuum_upper,
                        })
                        .to_string(),
                    ),
                });
                current_cycle_index = Some(cycles.len() - 1);
                next_loop_number += 1;
            }

            if let Some(index) = current_cycle_index {
                update_cycle_transition(&mut cycles[index], next_state, frame);
            }

            let confidence = if current_cycle_index.is_some() {
                0.95
            } else {
                0.55
            };
            segments.push(SegmentBuild {
                loop_number: current_cycle_index.map(|index| cycles[index].loop_number),
                state: next_state,
                started_at: frame.sampled_at.clone(),
                finished_at: None,
                start_frame_id: frame.id,
                end_frame_id: None,
                confidence,
                metadata_json: serde_json::json!({
                    "source": "inferred",
                    "profile_code": FD750_PROFILE_CODE,
                    "profile_version": FD750_PROFILE_VERSION,
                    "active_shelf_count": active_shelf_count,
                    "hottest_coil_c": hottest_coil,
                    "vacuum": vacuum,
                    "power": power,
                })
                .to_string(),
            });
            current_segment_index = Some(segments.len() - 1);
            current_state = Some(next_state);
        }

        previous_frame = Some(frame);
        previous_power = power;
        previous_weight = weight.or(previous_weight);
    }

    if let (Some(index), Some(last)) = (current_segment_index, frames.last()) {
        if run_status == "running" {
            segments[index].end_frame_id = Some(last.id);
        } else {
            close_segment(&mut segments[index], last);
        }
    }

    if let (Some(index), Some(last)) = (current_cycle_index, frames.last()) {
        let cycle = &mut cycles[index];

        if run_status == "running" {
            cycle.end_frame_id = Some(last.id);
        } else {
            cycle.finished_at = Some(last.sampled_at.clone());
            cycle.end_frame_id = Some(last.id);

            if cycle.defrost_stopped_at.is_some() {
                cycle.status = "completed".to_string();
                cycle.confidence = 0.9;
            } else {
                cycle.status = "incomplete".to_string();
                cycle.confidence = 0.6;
            }
        }
    }
}

fn infer_parallel_events(
    frames: &[AnalysisFrame],
    config: &Fd750RuleConfig,
    segments: &[SegmentBuild],
    diagnostics: &mut Vec<DiagnosticBuild>,
) {
    let candidates = frames
        .iter()
        .filter_map(|frame| {
            Some((
                frame,
                frame.value(&["S2", "S 2", "SERP2"])?,
                frame.value(&["S4", "S 4", "SERP4"])?,
                frame.value(&["VACUM", "VACUUM"])?,
            ))
        })
        .collect::<Vec<_>>();
    let target_delta =
        TimeDelta::try_minutes(config.parallel_window_minutes.round() as i64).unwrap_or_default();
    let tolerance_minutes = config.parallel_window_tolerance_minutes;

    for (index, (frame, s2, s4, vacuum)) in candidates.iter().enumerate() {
        if index == 0 {
            continue;
        }

        let target = frame.sampled_at_value - target_delta;
        let previous = candidates[..index]
            .iter()
            .min_by_key(|(candidate, _, _, _)| {
                (candidate.sampled_at_value - target)
                    .num_milliseconds()
                    .abs()
            });
        let Some((previous_frame, previous_s2, previous_s4, previous_vacuum)) = previous else {
            continue;
        };
        let actual_window_minutes = (frame.sampled_at_value - previous_frame.sampled_at_value)
            .num_milliseconds() as f64
            / 60_000.0;

        if (actual_window_minutes - config.parallel_window_minutes).abs() > tolerance_minutes {
            continue;
        }

        let deviation = s4 - s2;
        let previous_deviation = previous_s4 - previous_s2;
        let deviation_change = deviation - previous_deviation;
        let absolute_recovery = previous_deviation.abs() - deviation.abs();
        let vacuum_change = vacuum - previous_vacuum;
        let loop_number =
            segment_at(segments, &frame.sampled_at).and_then(|segment| segment.loop_number);
        let common_metadata = serde_json::json!({
            "comparison_window_minutes": actual_window_minutes,
            "s4_s2_deviation_c": deviation,
            "previous_s4_s2_deviation_c": previous_deviation,
            "s4_s2_change_c": deviation_change,
            "absolute_deviation_recovery_c": absolute_recovery,
            "vacuum": vacuum,
            "previous_vacuum": previous_vacuum,
            "vacuum_change": vacuum_change,
            "comparison_frame_id": previous_frame.id,
        });

        if absolute_recovery >= config.minimum_s4_s2_change_c
            && vacuum_change <= -config.minimum_vacuum_change
        {
            diagnostics.push(DiagnosticBuild {
                loop_number,
                frame_id: frame.id,
                occurred_at: frame.sampled_at.clone(),
                event_type: "fd750_s4_vacuum_recovery",
                severity: "info",
                message: "S4-S2 deviation improved while vacuum decreased".to_string(),
                metadata_json: common_metadata.to_string(),
            });
        } else if deviation_change >= config.minimum_s4_s2_change_c
            && vacuum_change >= config.minimum_vacuum_change
        {
            diagnostics.push(DiagnosticBuild {
                loop_number,
                frame_id: frame.id,
                occurred_at: frame.sampled_at.clone(),
                event_type: "fd750_s4_vacuum_rise",
                severity: "info",
                message: "S4 warmed relative to S2 while vacuum increased".to_string(),
                metadata_json: common_metadata.to_string(),
            });
        }
    }
}

fn segment_at<'a>(segments: &'a [SegmentBuild], sampled_at: &str) -> Option<&'a SegmentBuild> {
    segments.iter().rev().find(|segment| {
        segment.started_at.as_str() <= sampled_at
            && segment
                .finished_at
                .as_deref()
                .map(|finished| sampled_at <= finished)
                .unwrap_or(true)
    })
}

async fn persist_analysis(
    pool: &SqlitePool,
    run_id: i64,
    profile_id: i64,
    cycles: &[CycleBuild],
    segments: &[SegmentBuild],
    diagnostics: &[DiagnosticBuild],
    derived: &[DerivedBuild],
) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM derived_measurements WHERE run_id = ?1 AND analysis_profile_id = ?2")
        .bind(run_id)
        .bind(profile_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM diagnostic_events WHERE run_id = ?1 AND analysis_profile_id = ?2")
        .bind(run_id)
        .bind(profile_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "DELETE FROM process_state_segments WHERE run_id = ?1 AND analysis_profile_id = ?2",
    )
    .bind(run_id)
    .bind(profile_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM process_cycles WHERE run_id = ?1 AND analysis_profile_id = ?2")
        .bind(run_id)
        .bind(profile_id)
        .execute(&mut *tx)
        .await?;

    let mut cycle_ids = HashMap::<i64, i64>::new();

    for cycle in cycles {
        let id = sqlx::query_scalar::<_, i64>(
            r#"
            INSERT INTO process_cycles (
                run_id,
                analysis_profile_id,
                loop_number,
                started_at,
                dry_started_at,
                stopped_at,
                wait_started_at,
                defrost_started_at,
                defrost_stopped_at,
                finished_at,
                status,
                confidence,
                start_frame_id,
                end_frame_id,
                metadata_json
            )
            VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15
            )
            RETURNING id
            "#,
        )
        .bind(run_id)
        .bind(profile_id)
        .bind(cycle.loop_number)
        .bind(&cycle.started_at)
        .bind(&cycle.dry_started_at)
        .bind(&cycle.stopped_at)
        .bind(&cycle.wait_started_at)
        .bind(&cycle.defrost_started_at)
        .bind(&cycle.defrost_stopped_at)
        .bind(&cycle.finished_at)
        .bind(&cycle.status)
        .bind(cycle.confidence)
        .bind(cycle.start_frame_id)
        .bind(cycle.end_frame_id)
        .bind(&cycle.metadata_json)
        .fetch_one(&mut *tx)
        .await?;
        cycle_ids.insert(cycle.loop_number, id);
    }

    for segment in segments {
        sqlx::query(
            r#"
            INSERT INTO process_state_segments (
                run_id,
                analysis_profile_id,
                process_cycle_id,
                state_code,
                started_at,
                finished_at,
                start_frame_id,
                end_frame_id,
                confidence,
                metadata_json
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
        )
        .bind(run_id)
        .bind(profile_id)
        .bind(
            segment
                .loop_number
                .and_then(|loop_number| cycle_ids.get(&loop_number).copied()),
        )
        .bind(segment.state.as_str())
        .bind(&segment.started_at)
        .bind(&segment.finished_at)
        .bind(segment.start_frame_id)
        .bind(segment.end_frame_id)
        .bind(segment.confidence)
        .bind(&segment.metadata_json)
        .execute(&mut *tx)
        .await?;
    }

    for event in diagnostics {
        sqlx::query(
            r#"
            INSERT INTO diagnostic_events (
                run_id,
                analysis_profile_id,
                process_cycle_id,
                frame_id,
                occurred_at,
                event_type,
                severity,
                message,
                metadata_json
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
        )
        .bind(run_id)
        .bind(profile_id)
        .bind(
            event
                .loop_number
                .and_then(|loop_number| cycle_ids.get(&loop_number).copied()),
        )
        .bind(event.frame_id)
        .bind(&event.occurred_at)
        .bind(event.event_type)
        .bind(event.severity)
        .bind(&event.message)
        .bind(&event.metadata_json)
        .execute(&mut *tx)
        .await?;
    }

    for measurement in derived {
        sqlx::query(
            r#"
            INSERT INTO derived_measurements (
                run_id,
                analysis_profile_id,
                frame_id,
                code,
                numeric_value,
                unit,
                metadata_json
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
        )
        .bind(run_id)
        .bind(profile_id)
        .bind(measurement.frame_id)
        .bind(measurement.code)
        .bind(measurement.numeric_value)
        .bind(measurement.unit)
        .bind(&measurement.metadata_json)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

fn close_segment(segment: &mut SegmentBuild, frame: &AnalysisFrame) {
    segment.finished_at = Some(frame.sampled_at.clone());
    segment.end_frame_id = Some(frame.id);
}

fn finish_cycle_for_next_start(cycle: &mut CycleBuild, frame: &AnalysisFrame) {
    if cycle.status == "completed" {
        return;
    }

    cycle.finished_at = Some(frame.sampled_at.clone());
    cycle.end_frame_id = Some(frame.id);

    if cycle.stopped_at.is_some() || cycle.defrost_started_at.is_some() {
        cycle.status = "completed".to_string();
        cycle.confidence = if cycle.defrost_stopped_at.is_some() {
            0.98
        } else {
            0.82
        };
    } else {
        cycle.status = "incomplete".to_string();
        cycle.confidence = 0.55;
    }
}

fn update_cycle_transition(cycle: &mut CycleBuild, state: ProcessState, frame: &AnalysisFrame) {
    match state {
        ProcessState::Start => {}
        ProcessState::Dry => {
            cycle.dry_started_at.get_or_insert(frame.sampled_at.clone());
        }
        ProcessState::Stop => {
            cycle.stopped_at.get_or_insert(frame.sampled_at.clone());
        }
        ProcessState::Wait => {
            cycle
                .wait_started_at
                .get_or_insert(frame.sampled_at.clone());
        }
        ProcessState::Defrost => {
            cycle
                .defrost_started_at
                .get_or_insert(frame.sampled_at.clone());
        }
        ProcessState::DefrostStop => {
            cycle
                .defrost_stopped_at
                .get_or_insert(frame.sampled_at.clone());
            cycle.finished_at.get_or_insert(frame.sampled_at.clone());
            cycle.end_frame_id = Some(frame.id);
            cycle.status = "completed".to_string();
            cycle.confidence = 0.98;
        }
    }
}

fn is_shelf_off(value: f64, config: &Fd750RuleConfig) -> bool {
    (value - config.shelf_off_value).abs() <= config.shelf_off_tolerance
}

fn parse_sample_time(value: &str) -> anyhow::Result<NaiveDateTime> {
    NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f")
        .or_else(|_| NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S"))
        .with_context(|| format!("invalid analysis timestamp `{value}`"))
}
