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
async fn waits_for_valid_daily_file_then_rotates_automatically() {
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

    fs::write(
        &new_file,
        format!("{HEADER}2026-07-15-00:00:00.000;12.0;0.2\n"),
    )
    .unwrap();
    let new_status = manager.scan_once().await.unwrap();
    let new_run_id = new_status.active_run_id.unwrap();

    assert_ne!(new_run_id, old_run_id);
    assert!(
        new_status
            .active_file_path
            .as_deref()
            .unwrap()
            .ends_with("LogFile_2026_07_15.csv")
    );
    assert_eq!(run_status(&pool, old_run_id).await, "completed");
    assert_eq!(run_status(&pool, new_run_id).await, "running");
    assert_eq!(frame_count(&pool, old_run_id).await, 1);
    assert_eq!(frame_count(&pool, new_run_id).await, 1);
}

#[tokio::test]
async fn preserves_csv_timestamps_and_reports_a_six_minute_gap() {
    let root = tempfile::tempdir().unwrap();
    let source_dir = root.path().join("source");
    fs::create_dir(&source_dir).unwrap();
    fs::write(
        source_dir.join("LogFile_2026_07_14.csv"),
        format!(
            "{HEADER}2026-07-14-10:00:00.000;10.0;0.4\n\
             2026-07-14-10:06:00.000;12.0;0.2\n"
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
            "2026-07-14T10:06:00.000".to_string(),
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

    assert_eq!(run_count, 2);
    assert_eq!(import_count, 1);
    assert_eq!(running_count, 1);
}

async fn configure_manager(
    pool: &sqlx::SqlitePool,
    source_dir: &std::path::Path,
) -> CsvTailManager {
    let manager = CsvTailManager::new(pool.clone());
    manager
        .configure(CsvTailConfigRequest {
            name: Some("Test machine CSV".to_string()),
            directory_path: source_dir.to_string_lossy().to_string(),
            file_pattern: Some("*.csv".to_string()),
            scan_interval_ms: Some(1_000),
        })
        .await
        .unwrap();
    manager
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
