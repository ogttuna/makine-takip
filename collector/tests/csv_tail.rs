use std::fs::{self, OpenOptions};
use std::io::Write;

use collector::csv_tail::{CsvTailConfigRequest, CsvTailManager};

const HEADER: &str = "TARIH SAAT;RAF1;VACUM\n";

#[tokio::test]
async fn tails_only_complete_new_rows_and_resumes_from_checkpoint() {
    let root = tempfile::tempdir().unwrap();
    let source_dir = root.path().join("source");
    fs::create_dir(&source_dir).unwrap();
    let active_file = source_dir.join("LogFile_2026_07_14.csv");
    fs::write(
        &active_file,
        format!("{HEADER}2026-07-14-10:00:00.000;10.0;0.4\n"),
    )
    .unwrap();

    let pool = create_test_pool(root.path()).await;
    let manager = configure_manager(&pool, &source_dir).await;
    let first_status = manager.scan_once().await.unwrap();
    let run_id = first_status.active_run_id.unwrap();

    assert_eq!(frame_count(&pool, run_id).await, 1);
    assert_eq!(first_status.last_source_sequence, Some(2));

    append(&active_file, "2026-07-14-10:03:00.000;11.0;0.3");
    manager.scan_once().await.unwrap();
    assert_eq!(frame_count(&pool, run_id).await, 1);

    append(&active_file, "\n");
    manager.scan_once().await.unwrap();
    manager.scan_once().await.unwrap();
    assert_eq!(frame_count(&pool, run_id).await, 2);

    let restarted_manager = CsvTailManager::new(pool.clone());
    restarted_manager.scan_once().await.unwrap();
    assert_eq!(frame_count(&pool, run_id).await, 2);
}

#[tokio::test]
async fn tails_time_only_daily_rows_and_continues_after_a_bad_record() {
    let root = tempfile::tempdir().unwrap();
    let source_dir = root.path().join("source");
    fs::create_dir(&source_dir).unwrap();
    let active_file = source_dir.join("LogFile_2026_08_13.csv");
    fs::write(
        &active_file,
        "SAAT;RAF1;VACUM;RECETE NO;RECETE ADIM\r\n\
00:03;10;0.5;1;4\r\n\
not-a-time;11;0.4;1;4\r\n\
00:08;12;0.3;1;5\r\n",
    )
    .unwrap();

    let pool = create_test_pool(root.path()).await;
    let manager = configure_manager(&pool, &source_dir).await;
    let status = manager.scan_once().await.unwrap();
    let run_id = status.active_run_id.unwrap();
    let sequences = sqlx::query_scalar::<_, i64>(
        "SELECT source_row_number FROM sample_frames WHERE run_id = ?1 ORDER BY source_row_number",
    )
    .bind(run_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let rejected_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM quality_events WHERE run_id = ?1 AND event_type = 'csv_row_timestamp_error'",
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let observation_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM run_state_observations WHERE run_id = ?1")
            .bind(run_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(sequences, vec![2, 4]);
    assert_eq!(rejected_count, 1);
    assert_eq!(observation_count, 2);
    assert_eq!(status.last_source_sequence, Some(4));
}

#[tokio::test]
async fn waits_for_valid_daily_file_then_continues_the_same_stream_run() {
    let root = tempfile::tempdir().unwrap();
    let source_dir = root.path().join("source");
    fs::create_dir(&source_dir).unwrap();
    let old_file = source_dir.join("LogFile_2026_07_14.csv");
    let new_file = source_dir.join("LogFile_2026_07_15.csv");
    fs::write(
        &old_file,
        format!("{HEADER}2026-07-14-23:57:00.000;10.0;0.4\n"),
    )
    .unwrap();

    let pool = create_test_pool(root.path()).await;
    let manager = configure_manager(&pool, &source_dir).await;
    let old_status = manager.scan_once().await.unwrap();
    let old_run_id = old_status.active_run_id.unwrap();

    fs::write(&new_file, "").unwrap();
    let waiting_status = manager.scan_once().await.unwrap();
    assert_eq!(waiting_status.active_run_id, Some(old_run_id));

    fs::write(&new_file, "TARIH SAAT;RAF1").unwrap();
    let partial_header_status = manager.scan_once().await.unwrap();
    assert_eq!(partial_header_status.active_run_id, Some(old_run_id));
    assert!(
        partial_header_status
            .active_file_path
            .as_deref()
            .unwrap()
            .ends_with("LogFile_2026_07_14.csv")
    );
    assert_eq!(frame_count(&pool, old_run_id).await, 1);

    fs::write(
        &new_file,
        format!("{HEADER}2026-07-15-00:00:00.000;12.0;0.2\n"),
    )
    .unwrap();
    let new_status = manager.scan_once().await.unwrap();
    let new_run_id = new_status.active_run_id.unwrap();

    assert_eq!(new_run_id, old_run_id);
    assert!(
        new_status
            .active_file_path
            .as_deref()
            .unwrap()
            .ends_with("LogFile_2026_07_15.csv")
    );
    assert_eq!(run_status(&pool, old_run_id).await, "running");
    assert_eq!(run_status(&pool, new_run_id).await, "running");
    assert_eq!(frame_count(&pool, old_run_id).await, 2);
}

#[tokio::test]
async fn drains_the_old_files_final_unterminated_row_before_daily_rotation() {
    let root = tempfile::tempdir().unwrap();
    let source_dir = root.path().join("source");
    fs::create_dir(&source_dir).unwrap();
    let old_file = source_dir.join("LogFile_2026_07_14.csv");
    let new_file = source_dir.join("LogFile_2026_07_15.csv");
    fs::write(
        &old_file,
        format!("{HEADER}2026-07-14-23:54:00.000;10.0;0.4\n"),
    )
    .unwrap();

    let pool = create_test_pool(root.path()).await;
    let manager = configure_manager(&pool, &source_dir).await;
    let initial_status = manager.scan_once().await.unwrap();
    let run_id = initial_status.active_run_id.unwrap();

    append(&old_file, "2026-07-14-23:57:00.000;11.0;0.3");
    fs::write(
        &new_file,
        format!("{HEADER}2026-07-15-00:00:00.000;12.0;0.2\n"),
    )
    .unwrap();

    let rotated_status = manager.scan_once().await.unwrap();
    let timestamps = sqlx::query_scalar::<_, String>(
        "SELECT sampled_at FROM sample_frames WHERE run_id = ?1 ORDER BY sampled_at",
    )
    .bind(run_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(rotated_status.active_run_id, Some(run_id));
    assert!(
        rotated_status
            .active_file_path
            .as_deref()
            .unwrap()
            .ends_with("LogFile_2026_07_15.csv")
    );
    assert_eq!(
        timestamps,
        [
            "2026-07-14T23:54:00.000",
            "2026-07-14T23:57:00.000",
            "2026-07-15T00:00:00.000",
        ]
    );
}

#[tokio::test]
async fn rotates_through_every_daily_file_that_arrived_between_scans() {
    let root = tempfile::tempdir().unwrap();
    let source_dir = root.path().join("source");
    fs::create_dir(&source_dir).unwrap();
    let first_file = source_dir.join("LogFile_2026_07_14.csv");
    fs::write(
        &first_file,
        format!("{HEADER}2026-07-14-23:57:00.000;10.0;0.4\n"),
    )
    .unwrap();

    let pool = create_test_pool(root.path()).await;
    let manager = configure_manager(&pool, &source_dir).await;
    let first_status = manager.scan_once().await.unwrap();
    let run_id = first_status.active_run_id.unwrap();

    fs::write(
        source_dir.join("LogFile_2026_07_15.csv"),
        format!("{HEADER}2026-07-15-12:00:00.000;11.0;0.3\n"),
    )
    .unwrap();
    fs::write(
        source_dir.join("LogFile_2026_07_16.csv"),
        format!("{HEADER}2026-07-16-12:00:00.000;12.0;0.2\n"),
    )
    .unwrap();

    let final_status = manager.scan_once().await.unwrap();

    assert_eq!(final_status.active_run_id, Some(run_id));
    assert_eq!(run_status(&pool, run_id).await, "running");
    assert_eq!(frame_count(&pool, run_id).await, 3);
    assert!(
        final_status
            .active_file_path
            .as_deref()
            .unwrap()
            .ends_with("LogFile_2026_07_16.csv")
    );
}

#[tokio::test]
async fn background_worker_detects_a_new_daily_file_without_manual_rescan() {
    let root = tempfile::tempdir().unwrap();
    let source_dir = root.path().join("source");
    fs::create_dir(&source_dir).unwrap();
    fs::write(
        source_dir.join("LogFile_2026_07_14.csv"),
        format!("{HEADER}2026-07-14-23:57:00.000;10.0;0.4\n"),
    )
    .unwrap();

    let pool = create_test_pool(root.path()).await;
    let manager = configure_manager_with_interval(&pool, &source_dir, 250).await;
    manager.start().await.unwrap();

    let initial_status = wait_for_active_file(&manager, "LogFile_2026_07_14.csv").await;
    let run_id = initial_status.active_run_id.unwrap();

    fs::write(
        source_dir.join("LogFile_2026_07_15.csv"),
        format!("{HEADER}2026-07-15-00:00:00.000;12.0;0.2\n"),
    )
    .unwrap();

    let rotated_status = wait_for_active_file(&manager, "LogFile_2026_07_15.csv").await;
    manager.stop().await.unwrap();

    assert_eq!(rotated_status.active_run_id, Some(run_id));
    assert_eq!(frame_count(&pool, run_id).await, 2);
    assert_eq!(run_status(&pool, run_id).await, "running");
}

#[tokio::test]
async fn restart_keeps_checkpoint_and_rotates_without_duplicates() {
    let root = tempfile::tempdir().unwrap();
    let source_dir = root.path().join("source");
    fs::create_dir(&source_dir).unwrap();
    let old_file = source_dir.join("LogFile_2026_07_14.csv");
    fs::write(
        &old_file,
        format!("{HEADER}2026-07-14-23:54:00.000;10.0;0.4\n"),
    )
    .unwrap();

    let pool = create_test_pool(root.path()).await;
    let first_manager = configure_manager(&pool, &source_dir).await;
    let first_status = first_manager.scan_once().await.unwrap();
    let run_id = first_status.active_run_id.unwrap();

    append(&old_file, "2026-07-14-23:57:00.000;11.0;0.3");
    let restarted_manager = CsvTailManager::new(pool.clone());
    restarted_manager.scan_once().await.unwrap();
    assert_eq!(frame_count(&pool, run_id).await, 1);

    append(&old_file, "\n");
    restarted_manager.scan_once().await.unwrap();
    assert_eq!(frame_count(&pool, run_id).await, 2);

    fs::write(
        source_dir.join("LogFile_2026_07_15.csv"),
        format!("{HEADER}2026-07-15-00:00:00.000;12.0;0.2\n"),
    )
    .unwrap();
    let second_restart_manager = CsvTailManager::new(pool.clone());
    let rotated_status = second_restart_manager.scan_once().await.unwrap();
    second_restart_manager.scan_once().await.unwrap();

    assert_eq!(rotated_status.active_run_id, Some(run_id));
    assert!(
        rotated_status
            .active_file_path
            .as_deref()
            .unwrap()
            .ends_with("LogFile_2026_07_15.csv")
    );
    assert_eq!(frame_count(&pool, run_id).await, 3);
}

#[tokio::test]
async fn reconfiguring_the_same_directory_preserves_the_run_and_all_checkpoints() {
    let root = tempfile::tempdir().unwrap();
    let source_dir = root.path().join("source");
    fs::create_dir(&source_dir).unwrap();
    fs::write(
        source_dir.join("LogFile_2026_07_14.csv"),
        format!("{HEADER}2026-07-14-23:57:00.000;10.0;0.4\n"),
    )
    .unwrap();
    let newest_file = source_dir.join("LogFile_2026_07_15.csv");
    fs::write(
        &newest_file,
        format!("{HEADER}2026-07-15-00:00:00.000;11.0;0.3\n"),
    )
    .unwrap();

    let pool = create_test_pool(root.path()).await;
    let manager = configure_manager(&pool, &source_dir).await;
    let initial_status = manager.scan_once().await.unwrap();
    let run_id = initial_status.active_run_id.unwrap();
    assert_eq!(frame_count(&pool, run_id).await, 2);

    manager
        .configure(CsvTailConfigRequest {
            name: Some("Renamed test source".to_string()),
            directory_path: source_dir.to_string_lossy().to_string(),
            file_pattern: Some("*.csv".to_string()),
            scan_interval_ms: Some(2_000),
        })
        .await
        .unwrap();
    let resumed_status = manager.scan_once().await.unwrap();

    assert_eq!(resumed_status.active_run_id, Some(run_id));
    assert_eq!(frame_count(&pool, run_id).await, 2);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM csv_tail_checkpoints")
            .fetch_one(&pool)
            .await
            .unwrap(),
        2
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM runs")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );

    append(&newest_file, "2026-07-15-00:03:00.000;12.0;0.2\n");
    manager.scan_once().await.unwrap();
    assert_eq!(frame_count(&pool, run_id).await, 3);
}

#[tokio::test]
async fn changing_directory_completes_the_old_run_and_discards_stale_checkpoints() {
    let root = tempfile::tempdir().unwrap();
    let first_source = root.path().join("first-source");
    let second_source = root.path().join("second-source");
    fs::create_dir(&first_source).unwrap();
    fs::create_dir(&second_source).unwrap();
    fs::write(
        first_source.join("LogFile_2026_07_14.csv"),
        format!("{HEADER}2026-07-14-10:00:00.000;10.0;0.4\n"),
    )
    .unwrap();
    fs::write(
        second_source.join("LogFile_2026_07_14.csv"),
        format!("{HEADER}2026-07-14-11:00:00.000;20.0;0.3\n"),
    )
    .unwrap();

    let pool = create_test_pool(root.path()).await;
    let manager = configure_manager(&pool, &first_source).await;
    let first_run_id = manager.scan_once().await.unwrap().active_run_id.unwrap();

    manager
        .configure(CsvTailConfigRequest {
            name: Some("Second source".to_string()),
            directory_path: second_source.to_string_lossy().to_string(),
            file_pattern: Some("*.csv".to_string()),
            scan_interval_ms: Some(1_000),
        })
        .await
        .unwrap();

    assert_eq!(run_status(&pool, first_run_id).await, "completed");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM csv_tail_checkpoints")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );

    let second_status = manager.scan_once().await.unwrap();
    let second_run_id = second_status.active_run_id.unwrap();
    let raf_value: f64 = sqlx::query_scalar(
        r#"
        SELECT m.numeric_value
        FROM measurements m
        JOIN sample_frames f ON f.id = m.frame_id
        JOIN channels c ON c.id = m.channel_id
        WHERE f.run_id = ?1 AND c.code = 'RAF1'
        "#,
    )
    .bind(second_run_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_ne!(second_run_id, first_run_id);
    assert_eq!(frame_count(&pool, first_run_id).await, 1);
    assert_eq!(frame_count(&pool, second_run_id).await, 1);
    assert_eq!(raf_value, 20.0);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM runs")
            .fetch_one(&pool)
            .await
            .unwrap(),
        2
    );
}

#[tokio::test]
async fn orders_logfile_dates_even_when_copy_times_are_reversed() {
    let root = tempfile::tempdir().unwrap();
    let source_dir = root.path().join("source");
    fs::create_dir(&source_dir).unwrap();

    let newer_file = source_dir.join("LogFile_2025_09_13.csv");
    fs::write(
        &newer_file,
        format!("{HEADER}2025-09-13-00:00:00.000;13.0;0.2\n"),
    )
    .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;

    let older_file = source_dir.join("LogFile_2025_09_12.csv");
    fs::write(
        &older_file,
        format!("{HEADER}2025-09-12-23:57:00.000;12.0;0.3\n"),
    )
    .unwrap();

    let pool = create_test_pool(root.path()).await;
    let manager = configure_manager(&pool, &source_dir).await;
    let status = manager.scan_once().await.unwrap();
    let run_id = status.active_run_id.unwrap();

    assert_eq!(frame_count(&pool, run_id).await, 2);
    assert!(
        status
            .active_file_path
            .as_deref()
            .unwrap()
            .ends_with("LogFile_2025_09_13.csv")
    );
}

#[tokio::test]
async fn does_not_skip_a_headerless_middle_file_when_a_newer_file_is_ready() {
    let root = tempfile::tempdir().unwrap();
    let source_dir = root.path().join("source");
    fs::create_dir(&source_dir).unwrap();
    let first_file = source_dir.join("LogFile_2026_07_14.csv");
    let middle_file = source_dir.join("LogFile_2026_07_15.csv");
    let newest_file = source_dir.join("LogFile_2026_07_16.csv");
    fs::write(
        &first_file,
        format!("{HEADER}2026-07-14-23:57:00.000;10.0;0.4\n"),
    )
    .unwrap();

    let pool = create_test_pool(root.path()).await;
    let manager = configure_manager(&pool, &source_dir).await;
    let first_status = manager.scan_once().await.unwrap();
    let run_id = first_status.active_run_id.unwrap();

    fs::write(&middle_file, "").unwrap();
    fs::write(
        &newest_file,
        format!("{HEADER}2026-07-16-12:00:00.000;12.0;0.2\n"),
    )
    .unwrap();

    let waiting_status = manager.scan_once().await.unwrap();

    assert_eq!(waiting_status.active_run_id, Some(run_id));
    assert_eq!(frame_count(&pool, run_id).await, 1);
    assert!(
        waiting_status
            .active_file_path
            .as_deref()
            .unwrap()
            .ends_with("LogFile_2026_07_14.csv")
    );

    fs::write(
        &middle_file,
        format!("{HEADER}2026-07-15-12:00:00.000;11.0;0.3\n"),
    )
    .unwrap();
    manager.scan_once().await.unwrap();

    let timestamps = sqlx::query_scalar::<_, String>(
        "SELECT sampled_at FROM sample_frames WHERE run_id = ?1 ORDER BY sampled_at",
    )
    .bind(run_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(
        timestamps,
        [
            "2026-07-14T23:57:00.000",
            "2026-07-15T12:00:00.000",
            "2026-07-16T12:00:00.000",
        ]
    );
    assert_eq!(run_status(&pool, run_id).await, "running");
}

#[tokio::test]
async fn skips_a_complete_invalid_header_and_continues_with_the_next_daily_file() {
    let root = tempfile::tempdir().unwrap();
    let source_dir = root.path().join("source");
    fs::create_dir(&source_dir).unwrap();
    fs::write(
        source_dir.join("LogFile_2026_07_14.csv"),
        format!("{HEADER}2026-07-14-23:57:00.000;10.0;0.4\n"),
    )
    .unwrap();

    let pool = create_test_pool(root.path()).await;
    let manager = configure_manager(&pool, &source_dir).await;
    let first_status = manager.scan_once().await.unwrap();
    let run_id = first_status.active_run_id.unwrap();

    fs::write(
        source_dir.join("LogFile_2026_07_15.csv"),
        "WRONG;RAF1;VACUM\n00:00;11.0;0.3\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("LogFile_2026_07_16.csv"),
        format!("{HEADER}2026-07-16-00:00:00.000;12.0;0.2\n"),
    )
    .unwrap();

    let status = manager.scan_once().await.unwrap();
    let file_error_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM quality_events WHERE run_id = ?1 AND event_type = 'csv_file_header_error'",
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(frame_count(&pool, run_id).await, 2);
    assert_eq!(file_error_count, 1);
    assert!(status.last_error.is_none());
    assert!(
        status
            .active_file_path
            .as_deref()
            .unwrap()
            .ends_with("LogFile_2026_07_16.csv")
    );

    manager.scan_once().await.unwrap();
    assert_eq!(frame_count(&pool, run_id).await, 2);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM quality_events WHERE run_id = ?1 AND event_type = 'csv_file_header_error'",
        )
        .bind(run_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        1
    );
}

#[tokio::test]
async fn skips_an_invalid_historical_header_during_initial_backfill() {
    let root = tempfile::tempdir().unwrap();
    let source_dir = root.path().join("source");
    fs::create_dir(&source_dir).unwrap();
    fs::write(
        source_dir.join("LogFile_2026_07_14.csv"),
        "WRONG;RAF1;VACUM\n00:00;10.0;0.4\n",
    )
    .unwrap();
    fs::write(
        source_dir.join("LogFile_2026_07_15.csv"),
        format!("{HEADER}2026-07-15-00:00:00.000;12.0;0.2\n"),
    )
    .unwrap();

    let pool = create_test_pool(root.path()).await;
    let manager = configure_manager(&pool, &source_dir).await;
    let status = manager.scan_once().await.unwrap();
    let run_id = status.active_run_id.unwrap();
    let file_error_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM quality_events WHERE run_id = ?1 AND event_type = 'csv_file_header_error'",
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(frame_count(&pool, run_id).await, 1);
    assert_eq!(file_error_count, 1);
    assert!(
        status
            .active_file_path
            .as_deref()
            .unwrap()
            .ends_with("LogFile_2026_07_15.csv")
    );
}

#[tokio::test]
async fn skips_an_oversized_latest_header_and_names_the_run_for_valid_data() {
    let root = tempfile::tempdir().unwrap();
    let source_dir = root.path().join("source");
    fs::create_dir(&source_dir).unwrap();
    fs::write(
        source_dir.join("LogFile_2026_07_14.csv"),
        format!("{HEADER}2026-07-14-23:57:00.000;10.0;0.4\n"),
    )
    .unwrap();
    fs::write(
        source_dir.join("LogFile_2026_07_15.csv"),
        vec![b'X'; 64 * 1024 + 1],
    )
    .unwrap();

    let pool = create_test_pool(root.path()).await;
    let manager = configure_manager(&pool, &source_dir).await;
    let status = manager.scan_once().await.unwrap();
    let run_id = status.active_run_id.unwrap();
    let run_name: String = sqlx::query_scalar("SELECT name FROM runs WHERE id = ?1")
        .bind(run_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(frame_count(&pool, run_id).await, 1);
    assert_eq!(run_name, "LogFile_2026_07_14.csv");
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM quality_events WHERE run_id = ?1 AND event_type = 'csv_file_header_error'",
        )
        .bind(run_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        1
    );
    assert!(
        status
            .active_file_path
            .as_deref()
            .unwrap()
            .ends_with("LogFile_2026_07_14.csv")
    );
}

#[tokio::test]
async fn preserves_csv_timestamps_and_reports_a_gap_over_six_minutes() {
    let root = tempfile::tempdir().unwrap();
    let source_dir = root.path().join("source");
    fs::create_dir(&source_dir).unwrap();
    fs::write(
        source_dir.join("LogFile_2026_07_14.csv"),
        format!(
            "{HEADER}2026-07-14-10:00:00.000;10.0;0.4\n\
             2026-07-14-10:07:00.000;12.0;0.2\n"
        ),
    )
    .unwrap();

    let pool = create_test_pool(root.path()).await;
    let manager = configure_manager(&pool, &source_dir).await;
    let status = manager.scan_once().await.unwrap();
    let run_id = status.active_run_id.unwrap();

    let sampled_at = sqlx::query_scalar::<_, String>(
        "SELECT sampled_at FROM sample_frames WHERE run_id = ?1 ORDER BY sampled_at",
    )
    .bind(run_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let gap_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM quality_events WHERE run_id = ?1 AND event_type = 'time_gap'",
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(
        sampled_at,
        [
            "2026-07-14T10:00:00.000".to_string(),
            "2026-07-14T10:07:00.000".to_string(),
        ]
    );
    assert_eq!(gap_count, 1);
}

#[tokio::test]
async fn imports_older_files_once_and_tails_the_newest_file() {
    let root = tempfile::tempdir().unwrap();
    let source_dir = root.path().join("source");
    fs::create_dir(&source_dir).unwrap();
    fs::write(
        source_dir.join("LogFile_2026_07_13.csv"),
        format!("{HEADER}2026-07-13-12:00:00.000;9.0;0.5\n"),
    )
    .unwrap();
    fs::write(
        source_dir.join("LogFile_2026_07_14.csv"),
        format!("{HEADER}2026-07-14-12:00:00.000;10.0;0.4\n"),
    )
    .unwrap();

    let pool = create_test_pool(root.path()).await;
    let manager = configure_manager(&pool, &source_dir).await;
    manager.scan_once().await.unwrap();
    manager.scan_once().await.unwrap();

    let run_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM runs")
        .fetch_one(&pool)
        .await
        .unwrap();
    let import_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM import_files")
        .fetch_one(&pool)
        .await
        .unwrap();
    let running_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM runs WHERE status = 'running'")
            .fetch_one(&pool)
            .await
            .unwrap();

    let run_id: i64 = sqlx::query_scalar("SELECT id FROM runs")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(run_count, 1);
    assert_eq!(import_count, 0);
    assert_eq!(running_count, 1);
    assert_eq!(frame_count(&pool, run_id).await, 2);
}

#[tokio::test]
async fn quarantines_a_bad_historical_row_and_continues_with_newer_files() {
    let root = tempfile::tempdir().unwrap();
    let source_dir = root.path().join("source");
    fs::create_dir(&source_dir).unwrap();
    let historical_file = source_dir.join("LogFile_2026_07_13.csv");
    fs::write(
        &historical_file,
        format!("{HEADER}not-a-timestamp;9.0;0.5\n"),
    )
    .unwrap();
    fs::write(
        source_dir.join("LogFile_2026_07_14.csv"),
        format!("{HEADER}2026-07-14-12:00:00.000;10.0;0.4\n"),
    )
    .unwrap();

    let pool = create_test_pool(root.path()).await;
    let manager = configure_manager(&pool, &source_dir).await;
    let status = manager.scan_once().await.unwrap();
    let run_id = status.active_run_id.unwrap();
    let run_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM runs")
        .fetch_one(&pool)
        .await
        .unwrap();
    let rejected_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM quality_events WHERE run_id = ?1 AND event_type = 'csv_row_timestamp_error'",
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let rejected_metadata: String = sqlx::query_scalar(
        "SELECT metadata_json FROM quality_events WHERE run_id = ?1 AND event_type = 'csv_row_timestamp_error'",
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(status.last_error.is_none());
    assert_eq!(run_count, 1);
    assert_eq!(frame_count(&pool, run_id).await, 1);
    assert_eq!(rejected_count, 1);
    assert!(rejected_metadata.contains("not-a-timestamp"));
}

async fn configure_manager(
    pool: &sqlx::SqlitePool,
    source_dir: &std::path::Path,
) -> CsvTailManager {
    configure_manager_with_interval(pool, source_dir, 1_000).await
}

async fn configure_manager_with_interval(
    pool: &sqlx::SqlitePool,
    source_dir: &std::path::Path,
    scan_interval_ms: i64,
) -> CsvTailManager {
    let manager = CsvTailManager::new(pool.clone());
    manager
        .configure(CsvTailConfigRequest {
            name: Some("Test machine CSV".to_string()),
            directory_path: source_dir.to_string_lossy().to_string(),
            file_pattern: Some("*.csv".to_string()),
            scan_interval_ms: Some(scan_interval_ms),
        })
        .await
        .unwrap();
    manager
}

async fn wait_for_active_file(
    manager: &CsvTailManager,
    expected_file_name: &str,
) -> collector::csv_tail::CsvTailStatus {
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let status = manager.status().await.unwrap();
            if status
                .active_file_path
                .as_deref()
                .is_some_and(|path| path.ends_with(expected_file_name))
            {
                break status;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for active CSV `{expected_file_name}`"))
}

async fn create_test_pool(root: &std::path::Path) -> sqlx::SqlitePool {
    let database_path = root.join("test.db");
    let database_url = format!("sqlite://{}", database_path.display());
    collector::db::connect_database(&database_url)
        .await
        .unwrap()
}

fn append(path: &std::path::Path, value: &str) {
    let mut file = OpenOptions::new().append(true).open(path).unwrap();
    file.write_all(value.as_bytes()).unwrap();
    file.flush().unwrap();
}

async fn frame_count(pool: &sqlx::SqlitePool, run_id: i64) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM sample_frames WHERE run_id = ?1")
        .bind(run_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn run_status(pool: &sqlx::SqlitePool, run_id: i64) -> String {
    sqlx::query_scalar("SELECT status FROM runs WHERE id = ?1")
        .bind(run_id)
        .fetch_one(pool)
        .await
        .unwrap()
}
