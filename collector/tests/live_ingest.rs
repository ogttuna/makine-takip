use collector::ingest::{
    AppendMeasurementRequest, AppendSampleRequest, AppendSamplesRequest,
    AppendStateObservationRequest, CreateRunRequest,
};
use collector_test_support::create_test_pool;
use sqlx::Row;

#[tokio::test]
async fn appends_source_agnostic_live_samples_and_skips_duplicate_sequences() {
    let pool = create_test_pool().await;
    let run_id = collector::ingest::create_run(
        &pool,
        CreateRunRequest {
            name: "Network feed".to_string(),
            source_kind: "http_push".to_string(),
            source_name: Some("https://machine.local/feed".to_string()),
            started_at: None,
            notes: Some("adapter-neutral ingest test".to_string()),
        },
    )
    .await
    .unwrap();

    let report = collector::ingest::append_samples(
        &pool,
        run_id,
        AppendSamplesRequest {
            samples: vec![
                sample("2026-06-24T10:00:00.000", 1, 10.25),
                sample("2026-06-24T10:03:00.000", 2, 10.5),
            ],
        },
    )
    .await
    .unwrap();

    assert_eq!(report.inserted_count, 2);
    assert_eq!(report.skipped_count, 0);
    assert_eq!(report.channel_count, 2);

    let duplicate_report = collector::ingest::append_samples(
        &pool,
        run_id,
        AppendSamplesRequest {
            samples: vec![sample("2026-06-24T10:03:00.000", 2, 10.5)],
        },
    )
    .await
    .unwrap();

    assert_eq!(duplicate_report.inserted_count, 0);
    assert_eq!(duplicate_report.skipped_count, 1);

    let frame_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sample_frames WHERE run_id = ?1")
            .bind(run_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let run_status: String = sqlx::query_scalar("SELECT status FROM runs WHERE id = ?1")
        .bind(run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let source_kind: String = sqlx::query_scalar("SELECT source_kind FROM runs WHERE id = ?1")
        .bind(run_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(frame_count, 2);
    assert_eq!(run_status, "running");
    assert_eq!(source_kind, "http_push");
}

#[tokio::test]
async fn appends_auto_sequences_and_quality_events() {
    let pool = create_test_pool().await;
    let run_id = create_network_run(&pool).await;

    let report = collector::ingest::append_samples(
        &pool,
        run_id,
        AppendSamplesRequest {
            samples: vec![
                sample_without_sequence(
                    "2026-06-24T10:00:00.000",
                    vec![number_measurement("RAF1", 10.25)],
                ),
                sample_without_sequence(
                    "2026-06-24T10:05:01.000",
                    vec![
                        number_measurement("RAF3", 850.0),
                        text_measurement("TEXT_STATUS", "NaN"),
                    ],
                ),
            ],
        },
    )
    .await
    .unwrap();

    assert_eq!(report.inserted_count, 2);
    assert_eq!(report.skipped_count, 0);
    assert_eq!(report.channel_count, 3);
    assert_eq!(report.warning_count, 1);
    assert_eq!(report.error_count, 1);
    assert_eq!(
        report.latest_sampled_at.as_deref(),
        Some("2026-06-24T10:05:01.000")
    );

    let sequences: Vec<i64> = sqlx::query_scalar(
        "SELECT source_row_number FROM sample_frames WHERE run_id = ?1 ORDER BY source_row_number",
    )
    .bind(run_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let warning_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM quality_events WHERE run_id = ?1 AND severity = 'warning'",
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let error_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM quality_events WHERE run_id = ?1 AND severity = 'error'",
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(sequences, vec![1, 2]);
    assert_eq!(warning_count, 1);
    assert_eq!(error_count, 1);
}

#[tokio::test]
async fn stores_machine_state_observations_without_mapping_to_recipes() {
    let pool = create_test_pool().await;
    let run_id = create_network_run(&pool).await;

    let report = collector::ingest::append_samples(
        &pool,
        run_id,
        AppendSamplesRequest {
            samples: vec![sample_with_state_observation(
                "2026-06-24T10:00:00.000",
                1,
                "FD_BASIC",
                "PRIMARY_DRYING",
            )],
        },
    )
    .await
    .unwrap();

    assert_eq!(report.inserted_count, 1);

    let row = sqlx::query(
        r#"
        SELECT
            source_recipe_code,
            source_state_code,
            source_payload_json
        FROM run_state_observations
        WHERE run_id = ?1
        "#,
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let recipe_code: String = row.try_get("source_recipe_code").unwrap();
    let state_code: String = row.try_get("source_state_code").unwrap();
    let payload_json: String = row.try_get("source_payload_json").unwrap();

    assert_eq!(recipe_code, "FD_BASIC");
    assert_eq!(state_code, "PRIMARY_DRYING");
    assert!(payload_json.contains("\"machine_step\":3"));
}

#[tokio::test]
async fn maps_machine_state_observations_to_primary_recipe_segments() {
    let pool = create_test_pool().await;
    let run_id = create_network_run(&pool).await;
    create_primary_recipe_assignment(&pool, run_id).await;

    let report = collector::ingest::append_samples(
        &pool,
        run_id,
        AppendSamplesRequest {
            samples: vec![
                sample_with_state_observation(
                    "2026-06-24T10:00:00.000",
                    1,
                    "FD_BASIC",
                    "PRIMARY_DRYING",
                ),
                sample_with_state_observation(
                    "2026-06-24T10:03:00.000",
                    2,
                    "FD_BASIC",
                    "PRIMARY_DRYING",
                ),
                sample_with_state_observation(
                    "2026-06-24T10:05:00.000",
                    3,
                    "FD_BASIC",
                    "SECONDARY_DRYING",
                ),
            ],
        },
    )
    .await
    .unwrap();

    assert_eq!(report.inserted_count, 3);
    assert_eq!(report.warning_count, 0);

    let segments = sqlx::query(
        r#"
        SELECT
            rs.code,
            s.started_at,
            s.finished_at
        FROM run_state_segments s
        JOIN recipe_states rs ON rs.id = s.recipe_state_id
        JOIN run_recipe_assignments a ON a.id = s.run_recipe_assignment_id
        WHERE a.run_id = ?1
        ORDER BY s.started_at ASC
        "#,
    )
    .bind(run_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(segments.len(), 2);
    assert_eq!(
        segments[0].try_get::<String, _>("code").unwrap(),
        "primary_drying"
    );
    assert_eq!(
        segments[0].try_get::<String, _>("started_at").unwrap(),
        "2026-06-24T10:00:00.000"
    );
    assert_eq!(
        segments[0]
            .try_get::<Option<String>, _>("finished_at")
            .unwrap()
            .as_deref(),
        Some("2026-06-24T10:05:00.000")
    );
    assert_eq!(
        segments[1].try_get::<String, _>("code").unwrap(),
        "secondary_drying"
    );
}

#[tokio::test]
async fn unmapped_machine_state_creates_quality_warning_when_recipe_is_assigned() {
    let pool = create_test_pool().await;
    let run_id = create_network_run(&pool).await;
    create_primary_recipe_assignment(&pool, run_id).await;

    let report = collector::ingest::append_samples(
        &pool,
        run_id,
        AppendSamplesRequest {
            samples: vec![sample_with_state_observation(
                "2026-06-24T10:00:00.000",
                1,
                "FD_BASIC",
                "UNKNOWN_STEP",
            )],
        },
    )
    .await
    .unwrap();

    assert_eq!(report.inserted_count, 1);
    assert_eq!(report.warning_count, 1);

    let event_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM quality_events WHERE run_id = ?1 AND event_type = 'state_unmapped'",
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let segment_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM run_state_segments s JOIN run_recipe_assignments a ON a.id = s.run_recipe_assignment_id WHERE a.run_id = ?1")
            .bind(run_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(event_count, 1);
    assert_eq!(segment_count, 0);
}

#[tokio::test]
async fn rejects_duplicate_channels_inside_one_sample() {
    let pool = create_test_pool().await;
    let run_id = create_network_run(&pool).await;

    let error = collector::ingest::append_samples(
        &pool,
        run_id,
        AppendSamplesRequest {
            samples: vec![sample_without_sequence(
                "2026-06-24T10:00:00.000",
                vec![
                    number_measurement("RAF1", 10.25),
                    number_measurement("RAF1", 10.5),
                ],
            )],
        },
    )
    .await
    .unwrap_err();

    assert!(error.to_string().contains("duplicate channel"));
}

#[tokio::test]
async fn rejects_completed_runs() {
    let pool = create_test_pool().await;
    let run_id = create_network_run(&pool).await;

    sqlx::query("UPDATE runs SET status = 'completed' WHERE id = ?1")
        .bind(run_id)
        .execute(&pool)
        .await
        .unwrap();

    let error = collector::ingest::append_samples(
        &pool,
        run_id,
        AppendSamplesRequest {
            samples: vec![sample("2026-06-24T10:00:00.000", 1, 10.25)],
        },
    )
    .await
    .unwrap_err();

    assert!(error.to_string().contains("cannot accept new samples"));
}

async fn create_network_run(pool: &sqlx::SqlitePool) -> i64 {
    collector::ingest::create_run(
        pool,
        CreateRunRequest {
            name: "Network feed".to_string(),
            source_kind: "http_push".to_string(),
            source_name: Some("https://machine.local/feed".to_string()),
            started_at: None,
            notes: Some("adapter-neutral ingest test".to_string()),
        },
    )
    .await
    .unwrap()
}

async fn create_primary_recipe_assignment(pool: &sqlx::SqlitePool, run_id: i64) -> i64 {
    let recipe_id: i64 = sqlx::query_scalar(
        "INSERT INTO recipes (name, status, description) VALUES ('Basic FD', 'active', 'test recipe') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let recipe_version_id: i64 = sqlx::query_scalar(
        "INSERT INTO recipe_versions (recipe_id, version, status) VALUES (?1, '1.0', 'active') RETURNING id",
    )
    .bind(recipe_id)
    .fetch_one(pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO recipe_states (
            recipe_version_id,
            code,
            display_name,
            sort_order,
            external_code
        )
        VALUES
            (?1, 'primary_drying', 'Primary Drying', 1, 'PRIMARY_DRYING'),
            (?1, 'secondary_drying', 'Secondary Drying', 2, 'SECONDARY_DRYING')
        "#,
    )
    .bind(recipe_version_id)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query_scalar(
        r#"
        INSERT INTO run_recipe_assignments (
            run_id,
            recipe_version_id,
            role,
            status
        )
        VALUES (?1, ?2, 'primary', 'active')
        RETURNING id
        "#,
    )
    .bind(run_id)
    .bind(recipe_version_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn sample(sampled_at: &str, source_sequence: i64, raf1: f64) -> AppendSampleRequest {
    AppendSampleRequest {
        sampled_at: sampled_at.to_string(),
        source_timestamp_text: None,
        source_sequence: Some(source_sequence),
        state_observation: None,
        measurements: vec![
            number_measurement("RAF1", raf1),
            number_measurement("VACUM", 0.42),
        ],
    }
}

fn sample_with_state_observation(
    sampled_at: &str,
    source_sequence: i64,
    recipe_code: &str,
    state_code: &str,
) -> AppendSampleRequest {
    AppendSampleRequest {
        sampled_at: sampled_at.to_string(),
        source_timestamp_text: None,
        source_sequence: Some(source_sequence),
        state_observation: Some(AppendStateObservationRequest {
            source_recipe_code: Some(recipe_code.to_string()),
            source_recipe_version: Some("3".to_string()),
            source_state_code: state_code.to_string(),
            source_state_name: Some("Primary Drying".to_string()),
            source_payload_json: Some(serde_json::json!({
                "machine_step": 3,
                "raw_state": state_code,
            })),
        }),
        measurements: vec![number_measurement("RAF1", 10.25)],
    }
}

fn sample_without_sequence(
    sampled_at: &str,
    measurements: Vec<AppendMeasurementRequest>,
) -> AppendSampleRequest {
    AppendSampleRequest {
        sampled_at: sampled_at.to_string(),
        source_timestamp_text: None,
        source_sequence: None,
        state_observation: None,
        measurements,
    }
}

fn number_measurement(channel_code: &str, value: f64) -> AppendMeasurementRequest {
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

fn text_measurement(channel_code: &str, value: &str) -> AppendMeasurementRequest {
    AppendMeasurementRequest {
        channel_code: channel_code.to_string(),
        raw_text: Some(value.to_string()),
        numeric_value: None,
        value_text: None,
        value_type: None,
        quality: None,
        quality_reason: None,
    }
}

mod collector_test_support {
    use sqlx::SqlitePool;

    pub async fn create_test_pool() -> SqlitePool {
        let temp_dir = tempfile::tempdir().unwrap();
        let database_path = temp_dir.path().join("test.db");
        let database_url = format!("sqlite://{}", database_path.display());
        let pool = collector::db::connect_database(&database_url)
            .await
            .unwrap();

        // Keep the temp directory alive for the duration of the test process.
        std::mem::forget(temp_dir);

        pool
    }
}
