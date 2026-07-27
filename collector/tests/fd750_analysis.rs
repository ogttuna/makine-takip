use collector::ingest::{
    AppendMeasurementRequest, AppendSampleRequest, AppendSamplesRequest, CreateRunRequest,
};
use sqlx::Row;

#[tokio::test]
async fn infers_fd750_state_machine_and_keeps_850_as_an_off_code() {
    let pool = create_test_pool().await;
    let run_id = create_run(&pool).await;

    collector::ingest::append_samples(
        &pool,
        run_id,
        AppendSamplesRequest {
            samples: vec![
                frame("2026-07-25T10:00:00.000", 1, -20.0, -20.0, 1.5, 50.0),
                frame("2026-07-25T10:05:00.000", 2, -21.0, -22.0, 1.0, 50.0),
                frame("2026-07-25T10:10:00.000", 3, 850.0, -10.0, 6.0, 30.0),
                frame("2026-07-25T10:15:00.000", 4, 850.0, -5.0, 100.0, 25.0),
                frame("2026-07-25T10:20:00.000", 5, 850.0, 1.0, 100.0, 20.0),
                frame("2026-07-25T10:25:00.000", 6, 850.0, 10.0, 100.0, 4.0),
                frame("2026-07-25T10:30:00.000", 7, -25.0, -20.0, 1.0, 50.0),
            ],
        },
    )
    .await
    .unwrap();

    let states = sqlx::query_scalar::<_, String>(
        "SELECT state_code FROM process_state_segments WHERE run_id = ?1 ORDER BY started_at",
    )
    .bind(run_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let cycles = sqlx::query(
        r#"
        SELECT loop_number, status, defrost_stopped_at
        FROM process_cycles
        WHERE run_id = ?1
        ORDER BY loop_number
        "#,
    )
    .bind(run_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let off_count: f64 = sqlx::query_scalar(
        r#"
        SELECT d.numeric_value
        FROM derived_measurements d
        JOIN sample_frames f ON f.id = d.frame_id
        WHERE d.run_id = ?1
          AND d.code = 'ACTIVE_SHELF_COUNT'
          AND f.source_row_number = 3
        "#,
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let suspect_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM quality_events WHERE run_id = ?1 AND event_type = 'suspect_value'",
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(
        states,
        [
            "START",
            "DRY",
            "STOP",
            "WAIT",
            "DEFROST",
            "DEFROST_STOP",
            "START",
        ]
    );
    assert_eq!(cycles.len(), 2);
    assert_eq!(cycles[0].try_get::<i64, _>("loop_number").unwrap(), 1);
    assert_eq!(
        cycles[0].try_get::<String, _>("status").unwrap(),
        "completed"
    );
    assert!(
        cycles[0]
            .try_get::<Option<String>, _>("defrost_stopped_at")
            .unwrap()
            .is_some()
    );
    assert_eq!(off_count, 0.0);
    assert_eq!(suspect_count, 0);
}

#[tokio::test]
async fn emits_s4_vacuum_parallel_diagnostics_with_a_thirty_minute_window() {
    let pool = create_test_pool().await;
    let run_id = create_run(&pool).await;

    collector::ingest::append_samples(
        &pool,
        run_id,
        AppendSamplesRequest {
            samples: vec![
                parallel_frame("2026-07-25T10:00:00.000", 1, -40.0, -30.0, 1.0),
                parallel_frame("2026-07-25T10:30:00.000", 2, -40.0, -38.0, 0.7),
                parallel_frame("2026-07-25T11:00:00.000", 3, -40.0, -30.0, 1.0),
            ],
        },
    )
    .await
    .unwrap();

    let event_types = sqlx::query_scalar::<_, String>(
        "SELECT event_type FROM diagnostic_events WHERE run_id = ?1 ORDER BY occurred_at",
    )
    .bind(run_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert!(event_types.contains(&"fd750_s4_vacuum_recovery".to_string()));
    assert!(event_types.contains(&"fd750_s4_vacuum_rise".to_string()));
}

#[tokio::test]
async fn treats_the_full_850_tolerance_as_off_and_the_next_value_as_active() {
    let pool = create_test_pool().await;
    let run_id = create_run(&pool).await;

    collector::ingest::append_samples(
        &pool,
        run_id,
        AppendSamplesRequest {
            samples: vec![
                shelf_frame("2026-07-25T10:00:00.000", 1, 849.5),
                shelf_frame("2026-07-25T10:05:00.000", 2, 850.5),
                shelf_frame("2026-07-25T10:10:00.000", 3, 849.49),
            ],
        },
    )
    .await
    .unwrap();

    let active_counts = sqlx::query_scalar::<_, f64>(
        r#"
        SELECT d.numeric_value
        FROM derived_measurements d
        JOIN sample_frames f ON f.id = d.frame_id
        WHERE d.run_id = ?1 AND d.code = 'ACTIVE_SHELF_COUNT'
        ORDER BY f.source_row_number
        "#,
    )
    .bind(run_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(active_counts, [0.0, 0.0, 1.0]);
}

#[tokio::test]
async fn resets_only_after_more_than_180_minutes_and_interrupts_the_open_loop() {
    let pool = create_test_pool().await;
    let run_id = create_run(&pool).await;

    collector::ingest::append_samples(
        &pool,
        run_id,
        AppendSamplesRequest {
            samples: vec![
                frame("2026-07-25T10:00:00.000", 1, -20.0, -20.0, 1.0, 50.0),
                frame("2026-07-25T10:05:00.000", 2, -20.0, -20.0, 1.0, 50.0),
                frame("2026-07-25T13:06:00.000", 3, -20.0, -20.0, 1.0, 50.0),
            ],
        },
    )
    .await
    .unwrap();

    let statuses = sqlx::query_scalar::<_, String>(
        "SELECT status FROM process_cycles WHERE run_id = ?1 ORDER BY loop_number",
    )
    .bind(run_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let reset_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM diagnostic_events WHERE run_id = ?1 AND event_type = 'fd750_state_chain_reset'",
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let first_finished_at: Option<String> = sqlx::query_scalar(
        "SELECT finished_at FROM process_cycles WHERE run_id = ?1 AND loop_number = 1",
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(statuses, ["interrupted", "active"]);
    assert_eq!(reset_count, 1);
    assert_eq!(
        first_finished_at.as_deref(),
        Some("2026-07-25T10:05:00.000")
    );
}

#[tokio::test]
async fn keeps_the_state_chain_at_the_exact_180_minute_boundary() {
    let pool = create_test_pool().await;
    let run_id = create_run(&pool).await;

    collector::ingest::append_samples(
        &pool,
        run_id,
        AppendSamplesRequest {
            samples: vec![
                frame("2026-07-25T10:00:00.000", 1, -20.0, -20.0, 1.0, 50.0),
                frame("2026-07-25T10:05:00.000", 2, -20.0, -20.0, 1.0, 50.0),
                frame("2026-07-25T13:05:00.000", 3, -20.0, -20.0, 1.0, 50.0),
            ],
        },
    )
    .await
    .unwrap();

    let cycle_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM process_cycles WHERE run_id = ?1")
            .bind(run_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let reset_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM diagnostic_events WHERE run_id = ?1 AND event_type = 'fd750_state_chain_reset'",
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(cycle_count, 1);
    assert_eq!(reset_count, 0);
}

#[tokio::test]
async fn completes_a_running_loop_as_soon_as_defrost_power_drops_below_five() {
    let pool = create_test_pool().await;
    let run_id = create_run(&pool).await;

    collector::ingest::append_samples(
        &pool,
        run_id,
        AppendSamplesRequest {
            samples: vec![
                frame("2026-07-25T10:00:00.000", 1, -20.0, -20.0, 1.0, 50.0),
                frame("2026-07-25T10:05:00.000", 2, -20.0, -20.0, 1.0, 50.0),
                frame("2026-07-25T10:10:00.000", 3, 850.0, -10.0, 6.0, 30.0),
                frame("2026-07-25T10:15:00.000", 4, 850.0, 1.0, 100.0, 20.0),
                frame("2026-07-25T10:20:00.000", 5, 850.0, 5.0, 100.0, 4.99),
            ],
        },
    )
    .await
    .unwrap();

    let cycle = sqlx::query(
        "SELECT status, defrost_stopped_at, finished_at FROM process_cycles WHERE run_id = ?1",
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(cycle.try_get::<String, _>("status").unwrap(), "completed");
    assert_eq!(
        cycle
            .try_get::<Option<String>, _>("defrost_stopped_at")
            .unwrap()
            .as_deref(),
        Some("2026-07-25T10:20:00.000")
    );
    assert_eq!(
        cycle
            .try_get::<Option<String>, _>("finished_at")
            .unwrap()
            .as_deref(),
        Some("2026-07-25T10:20:00.000")
    );
}

#[tokio::test]
async fn integrates_energy_only_across_adjacent_valid_samples_and_short_gaps() {
    let pool = create_test_pool().await;
    let run_id = create_run(&pool).await;

    collector::ingest::append_samples(
        &pool,
        run_id,
        AppendSamplesRequest {
            samples: vec![
                power_frame("2026-07-25T10:00:00.000", 1, Some(60.0)),
                power_frame("2026-07-25T10:05:00.000", 2, Some(60.0)),
                power_frame("2026-07-25T10:10:00.000", 3, None),
                power_frame("2026-07-25T10:15:00.000", 4, Some(60.0)),
                power_frame("2026-07-25T10:35:00.000", 5, Some(60.0)),
                power_frame("2026-07-25T10:45:00.000", 6, Some(120.0)),
            ],
        },
    )
    .await
    .unwrap();

    collector::analysis::analyze_run(&pool, run_id)
        .await
        .unwrap();
    collector::analysis::analyze_run(&pool, run_id)
        .await
        .unwrap();

    let interval_rows = sqlx::query(
        r#"
        SELECT f.source_row_number, d.numeric_value
        FROM derived_measurements d
        JOIN sample_frames f ON f.id = d.frame_id
        WHERE d.run_id = ?1 AND d.code = 'INTERVAL_ENERGY_KWH'
        ORDER BY f.source_row_number
        "#,
    )
    .bind(run_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let final_cumulative: f64 = sqlx::query_scalar(
        r#"
        SELECT d.numeric_value
        FROM derived_measurements d
        JOIN sample_frames f ON f.id = d.frame_id
        WHERE d.run_id = ?1 AND d.code = 'CUMULATIVE_ENERGY_KWH'
        ORDER BY f.source_row_number DESC
        LIMIT 1
        "#,
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(interval_rows.len(), 2);
    assert_eq!(
        interval_rows[0]
            .try_get::<i64, _>("source_row_number")
            .unwrap(),
        2
    );
    assert!((interval_rows[0].try_get::<f64, _>("numeric_value").unwrap() - 5.0).abs() < 1e-9);
    assert_eq!(
        interval_rows[1]
            .try_get::<i64, _>("source_row_number")
            .unwrap(),
        6
    );
    assert!((interval_rows[1].try_get::<f64, _>("numeric_value").unwrap() - 15.0).abs() < 1e-9);
    assert!((final_cumulative - 20.0).abs() < 1e-9);
}

async fn create_test_pool() -> sqlx::SqlitePool {
    let temp_dir = tempfile::tempdir().unwrap();
    let database_path = temp_dir.path().join("test.db");
    let database_url = format!("sqlite://{}", database_path.display());
    let pool = collector::db::connect_database(&database_url)
        .await
        .unwrap();
    std::mem::forget(temp_dir);
    pool
}

async fn create_run(pool: &sqlx::SqlitePool) -> i64 {
    collector::ingest::create_run(
        pool,
        CreateRunRequest {
            name: "FD-750 analysis".to_string(),
            source_kind: "replay".to_string(),
            source_name: Some("test".to_string()),
            started_at: None,
            notes: None,
        },
    )
    .await
    .unwrap()
}

fn frame(
    sampled_at: &str,
    source_sequence: i64,
    raf1: f64,
    hottest_coil: f64,
    vacuum: f64,
    power: f64,
) -> AppendSampleRequest {
    AppendSampleRequest {
        sampled_at: sampled_at.to_string(),
        source_timestamp_text: None,
        source_sequence: Some(source_sequence),
        state_observation: None,
        measurements: vec![
            number("RAF1", raf1),
            number("RAF2", 850.0),
            number("RAF3", 850.0),
            number("RAF4", 850.0),
            number("S1", hottest_coil),
            number("S2", hottest_coil - 1.0),
            number("S3", hottest_coil),
            number("S4", hottest_coil - 1.0),
            number("VACUM", vacuum),
            number("E.GUC", power),
        ],
    }
}

fn parallel_frame(
    sampled_at: &str,
    source_sequence: i64,
    s2: f64,
    s4: f64,
    vacuum: f64,
) -> AppendSampleRequest {
    AppendSampleRequest {
        sampled_at: sampled_at.to_string(),
        source_timestamp_text: None,
        source_sequence: Some(source_sequence),
        state_observation: None,
        measurements: vec![
            number("RAF1", -20.0),
            number("S2", s2),
            number("S4", s4),
            number("VACUM", vacuum),
            number("E.GUC", 50.0),
        ],
    }
}

fn shelf_frame(sampled_at: &str, source_sequence: i64, raf1: f64) -> AppendSampleRequest {
    AppendSampleRequest {
        sampled_at: sampled_at.to_string(),
        source_timestamp_text: None,
        source_sequence: Some(source_sequence),
        state_observation: None,
        measurements: vec![
            number("RAF1", raf1),
            number("RAF2", 850.0),
            number("RAF3", 850.0),
            number("RAF4", 850.0),
            number("S1", -20.0),
            number("VACUM", 5.0),
        ],
    }
}

fn power_frame(sampled_at: &str, source_sequence: i64, power: Option<f64>) -> AppendSampleRequest {
    let mut measurements = vec![
        number("RAF1", -20.0),
        number("S1", -20.0),
        number("VACUM", 1.0),
    ];

    if let Some(power) = power {
        measurements.push(number("E.GUC", power));
    }

    AppendSampleRequest {
        sampled_at: sampled_at.to_string(),
        source_timestamp_text: None,
        source_sequence: Some(source_sequence),
        state_observation: None,
        measurements,
    }
}

fn number(channel_code: &str, value: f64) -> AppendMeasurementRequest {
    AppendMeasurementRequest {
        channel_code: channel_code.to_string(),
        raw_text: Some(value.to_string()),
        numeric_value: Some(value),
        value_text: None,
        value_type: None,
        quality: None,
        quality_reason: None,
    }
}
