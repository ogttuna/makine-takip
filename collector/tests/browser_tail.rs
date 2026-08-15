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
        rows_text: rows.to_string(),
    };
    let first = sync_chunk(&pool, request).await.unwrap();

    assert_eq!(first.inserted_count, 2);
    assert_eq!(first.skipped_count, 0);
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
async fn rotates_to_a_new_file_and_completes_the_previous_run() {
    let root = tempfile::tempdir().unwrap();
    let pool = create_test_pool(root.path()).await;
    let old = open(&pool, "LogFile_2026_07_20.csv", 0).await;
    let old_run_id = old.active_run_id.unwrap();

    let new = open(&pool, "LogFile_2026_07_21.csv", 0).await;
    let new_run_id = new.active_run_id.unwrap();

    assert_ne!(new_run_id, old_run_id);
    assert_eq!(run_status(&pool, old_run_id).await, "completed");
    assert_eq!(run_status(&pool, new_run_id).await, "running");

    let status = source_status(&pool, SOURCE_ID).await.unwrap();
    assert_eq!(
        status.active_file_name.as_deref(),
        Some("LogFile_2026_07_21.csv")
    );
    assert_eq!(status.active_run_id, Some(new_run_id));
}

async fn open(
    pool: &sqlx::SqlitePool,
    file_name: &str,
    rows_length: usize,
) -> collector::browser_tail::BrowserTailStatus {
    open_file(
        pool,
        BrowserTailOpenRequest {
            source_id: SOURCE_ID.to_string(),
            source_name: "MachineLogs".to_string(),
            file_name: file_name.to_string(),
            header_line: HEADER_LINE.to_string(),
            header_end_offset: HEADER.len() as i64,
            file_size: (HEADER.len() + rows_length) as i64,
            last_modified_ms: 1_753_094_400_000,
        },
    )
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
