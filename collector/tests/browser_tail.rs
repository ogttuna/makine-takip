use collector::browser_tail::{
    BrowserTailChunkRequest, BrowserTailOpenRequest, open_file, source_status, sync_chunk,
};

const SOURCE_ID: &str = "browser-test-source";
const HEADER_LINE: &str = "TARIH SAAT;RAF1;VACUM";
const HEADER: &str = "TARIH SAAT;RAF1;VACUM\n";

#[tokio::test]
async fn resumes_from_server_checkpoint_and_makes_retries_idempotent() {
    let root = tempfile::tempdir().unwrap();
    let pool = create_test_pool(root.path()).await;
    let rows = "2026-07-21-10:00:00.000;10.0;0.4\n\
                2026-07-21-10:03:00.000;11.0;0.3\n";

    let opened = open(&pool, "LogFile_2026_07_21.csv", rows.len()).await;
    assert_eq!(opened.byte_offset, Some(HEADER.len() as i64));
    assert_eq!(opened.last_source_sequence, Some(1));

    let request = BrowserTailChunkRequest {
        source_id: SOURCE_ID.to_string(),
        file_name: "LogFile_2026_07_21.csv".to_string(),
        offset: HEADER.len() as i64,
        byte_length: rows.len() as i64,
        rows_text: rows.to_string(),
    };
    let first = sync_chunk(&pool, request).await.unwrap();

    assert_eq!(first.inserted_count, 2);
    assert_eq!(first.skipped_count, 0);
    assert_eq!(first.rejected_count, 0);
    assert!(!first.replayed);
    assert_eq!(first.status.last_source_sequence, Some(3));
    assert_eq!(
        frame_count(&pool, first.status.active_run_id.unwrap()).await,
        2
    );

    let replay = sync_chunk(
        &pool,
        BrowserTailChunkRequest {
            source_id: SOURCE_ID.to_string(),
            file_name: "LogFile_2026_07_21.csv".to_string(),
            offset: HEADER.len() as i64,
            byte_length: rows.len() as i64,
            rows_text: rows.to_string(),
        },
    )
    .await
    .unwrap();

    assert!(replay.replayed);
    assert_eq!(replay.inserted_count, 0);
    assert_eq!(
        frame_count(&pool, replay.status.active_run_id.unwrap()).await,
        2
    );
}

#[tokio::test]
async fn rotates_daily_files_inside_the_same_running_stream() {
    let root = tempfile::tempdir().unwrap();
    let pool = create_test_pool(root.path()).await;
    let old = open(&pool, "LogFile_2026_07_20.csv", 0).await;
    let old_run_id = old.active_run_id.unwrap();

    let new = open(&pool, "LogFile_2026_07_21.csv", 0).await;
    let new_run_id = new.active_run_id.unwrap();

    assert_eq!(new_run_id, old_run_id);
    assert_eq!(run_status(&pool, old_run_id).await, "running");
    assert_eq!(run_status(&pool, new_run_id).await, "running");

    let status = source_status(&pool, SOURCE_ID).await.unwrap();
    assert_eq!(
        status.active_file_name.as_deref(),
        Some("LogFile_2026_07_21.csv")
    );
    assert_eq!(status.active_run_id, Some(new_run_id));
}

#[tokio::test]
async fn accepts_time_only_rows_preserves_recipe_steps_and_quarantines_bad_rows() {
    let root = tempfile::tempdir().unwrap();
    let pool = create_test_pool(root.path()).await;
    let header_line = "SAAT;RAF1;VACUM;RECETE NO;RECETE ADIM";
    let header = format!("{header_line}\r\n");
    let rows = "00:03;10;0.5;1;4\r\n\
                not-a-time;11;0.4;1;4\r\n\
                00:08;12;0.3;1;5\r\n";
    let opened = open_with_header(
        &pool,
        "LogFile_2026_08_13.csv",
        header_line,
        header.len(),
        rows.len(),
    )
    .await;
    let response = sync_chunk(
        &pool,
        BrowserTailChunkRequest {
            source_id: SOURCE_ID.to_string(),
            file_name: "LogFile_2026_08_13.csv".to_string(),
            offset: header.len() as i64,
            byte_length: rows.len() as i64,
            rows_text: rows.to_string(),
        },
    )
    .await
    .unwrap();
    let run_id = opened.active_run_id.unwrap();

    assert_eq!(response.inserted_count, 2);
    assert_eq!(response.rejected_count, 1);
    assert_eq!(response.status.last_source_sequence, Some(4));
    assert_eq!(frame_sequences(&pool, run_id).await, vec![2, 4]);
    assert_eq!(state_observation_count(&pool, run_id).await, 2);
    assert_eq!(rejected_row_count(&pool, run_id).await, 1);
}

#[tokio::test]
async fn advances_by_original_bytes_when_invalid_utf8_was_replaced_in_the_browser() {
    let root = tempfile::tempdir().unwrap();
    let pool = create_test_pool(root.path()).await;
    let header_line = "SAAT;RAF1";
    let header = format!("{header_line}\n");
    let rows = "00:03;�\n00:08;12\n";
    let original_byte_length = rows.len() - 2;
    let opened = open_with_header(
        &pool,
        "LogFile_2026_08_15.csv",
        header_line,
        header.len(),
        original_byte_length,
    )
    .await;

    let response = sync_chunk(
        &pool,
        BrowserTailChunkRequest {
            source_id: SOURCE_ID.to_string(),
            file_name: "LogFile_2026_08_15.csv".to_string(),
            offset: header.len() as i64,
            byte_length: original_byte_length as i64,
            rows_text: rows.to_string(),
        },
    )
    .await
    .unwrap();

    assert_eq!(response.inserted_count, 2);
    assert_eq!(response.status.byte_offset, response.status.file_size);
    assert_eq!(response.status.byte_offset, opened.file_size);
}

async fn open(
    pool: &sqlx::SqlitePool,
    file_name: &str,
    rows_length: usize,
) -> collector::browser_tail::BrowserTailStatus {
    open_with_header(pool, file_name, HEADER_LINE, HEADER.len(), rows_length).await
}

async fn open_with_header(
    pool: &sqlx::SqlitePool,
    file_name: &str,
    header_line: &str,
    header_length: usize,
    rows_length: usize,
) -> collector::browser_tail::BrowserTailStatus {
    open_file(
        pool,
        BrowserTailOpenRequest {
            source_id: SOURCE_ID.to_string(),
            source_name: "MachineLogs".to_string(),
            file_name: file_name.to_string(),
            header_line: header_line.to_string(),
            header_end_offset: header_length as i64,
            file_size: (header_length + rows_length) as i64,
            last_modified_ms: 1_753_094_400_000,
        },
    )
    .await
    .unwrap()
}

async fn frame_sequences(pool: &sqlx::SqlitePool, run_id: i64) -> Vec<i64> {
    sqlx::query_scalar(
        "SELECT source_row_number FROM sample_frames WHERE run_id = ?1 ORDER BY source_row_number",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn state_observation_count(pool: &sqlx::SqlitePool, run_id: i64) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM run_state_observations WHERE run_id = ?1")
        .bind(run_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn rejected_row_count(pool: &sqlx::SqlitePool, run_id: i64) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM quality_events WHERE run_id = ?1 AND event_type LIKE 'csv_row_%'",
    )
    .bind(run_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn create_test_pool(root: &std::path::Path) -> sqlx::SqlitePool {
    let database_path = root.join("test.db");
    let database_url = format!("sqlite://{}", database_path.display());
    collector::db::connect_database(&database_url)
        .await
        .unwrap()
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
