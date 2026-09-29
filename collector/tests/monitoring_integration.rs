use chrono::{DateTime, Utc};
use collector::ingest::{
    AppendMeasurementRequest, AppendSampleRequest, AppendSamplesRequest, CreateRunRequest,
};
use collector::integration::{ReadingsQuery, read_page};
use sqlx::{SqlitePool, sqlite::SqlitePoolOptions};

async fn fixture() -> (SqlitePool, i64) {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("../migrations").run(&pool).await.unwrap();
    let run = run(&pool).await;
    (pool, run)
}

async fn run(pool: &SqlitePool) -> i64 {
    collector::ingest::create_run(
        pool,
        CreateRunRequest {
            name: "Monitoring fixture".into(),
            machine_id: Some(1),
            source_kind: "http_push".into(),
            source_name: None,
            started_at: None,
            notes: None,
        },
    )
    .await
    .unwrap()
}

async fn sample(pool: &SqlitePool, run_id: i64, at: &str, value: f64, quality: &str) {
    collector::ingest::append_samples(
        pool,
        run_id,
        AppendSamplesRequest {
            samples: vec![AppendSampleRequest {
                sampled_at: at.into(),
                source_timestamp_text: None,
                source_sequence: None,
                state_observation: None,
                measurements: vec![AppendMeasurementRequest {
                    channel_code: "S1".into(),
                    raw_text: None,
                    numeric_value: Some(value),
                    value_text: None,
                    value_type: None,
                    quality: Some(quality.into()),
                    quality_reason: None,
                }],
            }],
        },
    )
    .await
    .unwrap();
}

fn time(value: &str) -> DateTime<Utc> {
    value.parse().unwrap()
}
fn query(from: &str, to: &str) -> ReadingsQuery {
    ReadingsQuery {
        from: time(from),
        to: time(to),
        after: None,
        snapshot_frame_id: None,
        limit: None,
    }
}

#[tokio::test]
async fn local_csv_and_rfc3339_sources_share_one_utc_axis_and_half_open_bounds() {
    let (pool, first) = fixture().await;
    sample(&pool, first, "2026-09-22T17:30:00.000", 20., "good").await;
    sample(&pool, first, "2026-09-22T17:33:00.000", 21., "good").await;
    let second = run(&pool).await;
    sample(&pool, second, "2026-09-22T14:30:00Z", 20., "good").await;
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sample_frames")
        .fetch_one(&pool)
        .await
        .unwrap();
    let page = read_page(
        &pool,
        1,
        query("2026-09-22T14:30:00Z", "2026-09-22T14:33:00Z"),
    )
    .await
    .unwrap();
    assert_eq!(page.samples.len(), 1);
    assert_eq!(page.samples[0].recorded_at, "2026-09-22T14:30:00.000Z");
    assert_eq!(page.samples[0].duplicate_frames, 1);
    assert!(!page.samples[0].values[0].conflicting_value);
    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sample_frames")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(before, after, "Reads must preserve original frames");
}

#[tokio::test]
async fn boundaries_preserve_sub_millisecond_precision() {
    let (pool, first) = fixture().await;
    sample(&pool, first, "2026-09-22T14:30:00.000Z", 20., "good").await;
    let excluded = read_page(
        &pool,
        1,
        query("2026-09-22T14:30:00.000001Z", "2026-09-22T14:31:00Z"),
    )
    .await
    .unwrap();
    assert!(excluded.samples.is_empty());
    let included = read_page(
        &pool,
        1,
        query("2026-09-22T14:29:00Z", "2026-09-22T14:30:00.000001Z"),
    )
    .await
    .unwrap();
    assert_eq!(included.samples.len(), 1);
}

#[tokio::test]
async fn duplicate_choice_is_stable_and_exposes_conflicting_values_and_quality() {
    let (pool, first) = fixture().await;
    sample(&pool, first, "2026-09-22T17:30:00.000", 20., "good").await;
    let second = run(&pool).await;
    sample(&pool, second, "2026-09-22T14:30:00+00:00", 23., "suspect").await;
    let page = read_page(
        &pool,
        1,
        query("2026-09-22T14:00:00Z", "2026-09-22T15:00:00Z"),
    )
    .await
    .unwrap();
    let value = &page.samples[0].values[0];
    assert_eq!(value.numeric_value, Some(23.));
    assert_eq!(value.run_id, second);
    assert!(value.conflicting_value);
    assert!(value.differing_quality);
    assert_eq!(page.channels[0].unit, Some("°C"));
    assert!(!page.channels[0].target);
}

#[tokio::test]
async fn paging_pins_late_imports_and_covers_windows_longer_than_five_days() {
    let (pool, first) = fixture().await;
    sample(&pool, first, "2026-09-01T12:00:00Z", 1., "good").await;
    sample(&pool, first, "2026-09-08T12:00:00Z", 2., "good").await;
    sample(&pool, first, "2026-09-22T12:00:00Z", 3., "good").await;
    let mut first_query = query("2026-09-01T00:00:00Z", "2026-09-30T00:00:00Z");
    first_query.limit = Some(1);
    let first_page = read_page(&pool, 1, first_query).await.unwrap();
    let late = run(&pool).await;
    sample(&pool, late, "2026-09-08T12:00:00Z", 99., "good").await;
    sample(&pool, late, "2026-09-05T12:00:00Z", 44., "good").await;
    let mut next_query = query("2026-09-01T00:00:00Z", "2026-09-30T00:00:00Z");
    next_query.after = first_page.next_cursor.map(|s| time(&s));
    next_query.snapshot_frame_id = Some(first_page.snapshot_frame_id);
    let rest = read_page(&pool, 1, next_query).await.unwrap();
    assert_eq!(rest.samples.len(), 2);
    assert_eq!(rest.samples[0].values[0].numeric_value, Some(2.));
    assert!(rest.next_cursor.is_none());
    let refreshed = read_page(
        &pool,
        1,
        query("2026-09-01T00:00:00Z", "2026-09-30T00:00:00Z"),
    )
    .await
    .unwrap();
    assert_eq!(refreshed.samples.len(), 4);
    assert_eq!(refreshed.samples[2].values[0].numeric_value, Some(99.));
}

#[tokio::test]
async fn rejects_invalid_windows_limits_and_unpinned_cursor_without_panicking() {
    let (pool, _) = fixture().await;
    let from = "2026-09-01T00:00:00Z";
    let to = "2026-09-02T00:00:00Z";
    assert!(read_page(&pool, 1, query(to, from)).await.is_err());
    assert!(read_page(&pool, 1, query(from, from)).await.is_err());
    assert!(
        read_page(&pool, 1, query(from, "2028-09-01T00:00:00Z"))
            .await
            .is_err()
    );
    let mut invalid = query(from, to);
    invalid.limit = Some(5001);
    assert!(read_page(&pool, 1, invalid).await.is_err());
    let mut invalid = query(from, to);
    invalid.after = Some(time(from));
    assert!(read_page(&pool, 1, invalid).await.is_err());
    assert!(read_page(&pool, 99999, query(from, to)).await.is_err());
}
