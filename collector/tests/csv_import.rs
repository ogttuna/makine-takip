use collector_test_support::{SAMPLE_CSV, create_test_pool};

#[tokio::test]
async fn imports_fixture_csv_and_prevents_duplicates() {
    let pool = create_test_pool().await;

    let first_report =
        collector::csv_import::import_csv_bytes(&pool, "LogFile_2026_01_26.csv", SAMPLE_CSV)
            .await
            .unwrap();

    assert!(!first_report.duplicate);
    assert_eq!(first_report.row_count, 144);
    assert_eq!(first_report.channel_count, 10);
    assert_eq!(first_report.warning_count, 3);
    assert_eq!(first_report.error_count, 0);

    let frame_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sample_frames")
        .fetch_one(&pool)
        .await
        .unwrap();
    let measurement_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM measurements")
        .fetch_one(&pool)
        .await
        .unwrap();
    let time_gap_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM quality_events WHERE event_type = 'time_gap'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let suspect_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM quality_events WHERE event_type = 'suspect_value'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(frame_count, 144);
    assert_eq!(measurement_count, 1_440);
    assert_eq!(time_gap_count, 3);
    assert_eq!(suspect_count, 0);

    let second_report =
        collector::csv_import::import_csv_bytes(&pool, "LogFile_2026_01_26.csv", SAMPLE_CSV)
            .await
            .unwrap();

    assert!(second_report.duplicate);
    assert_eq!(second_report.run_id, first_report.run_id);

    let run_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM runs")
        .fetch_one(&pool)
        .await
        .unwrap();
    let import_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM import_files")
        .fetch_one(&pool)
        .await
        .unwrap();
    let frame_count_after_duplicate: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sample_frames")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(run_count, 1);
    assert_eq!(import_count, 1);
    assert_eq!(frame_count_after_duplicate, 144);
}

mod collector_test_support {
    use sqlx::SqlitePool;

    pub const SAMPLE_CSV: &[u8] = include_bytes!("../../fixtures/LogFile_2026_01_26.csv");

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
