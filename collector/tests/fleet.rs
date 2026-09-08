use collector::fleet::{CreateMachineRequest, create_machine, list_machines};
use collector::ingest::CreateRunRequest;
use sqlx::Row;

const SAMPLE_CSV: &[u8] = b"TARIH SAAT;RAF1;VACUM\n\
2026-09-08-08:00:00.000;-20.5;0.4\n";

#[tokio::test]
async fn assigns_runs_and_duplicate_imports_per_machine() {
    let pool = create_test_pool().await;
    let default_machine = list_machines(&pool).await.unwrap().remove(0);
    let second_machine = create_machine(
        &pool,
        CreateMachineRequest {
            code: "FD750-02".to_string(),
            name: "Freeze Dryer 02".to_string(),
            model: Some("FD-750".to_string()),
            location: Some("Production B".to_string()),
        },
    )
    .await
    .unwrap();

    let first_import = collector::csv_import::import_csv_bytes_for_machine(
        &pool,
        "LogFile_2026_09_08.csv",
        SAMPLE_CSV,
        Some(default_machine.id),
    )
    .await
    .unwrap();
    let second_import = collector::csv_import::import_csv_bytes_for_machine(
        &pool,
        "LogFile_2026_09_08.csv",
        SAMPLE_CSV,
        Some(second_machine.id),
    )
    .await
    .unwrap();

    assert_ne!(first_import.run_id, second_import.run_id);
    assert!(!first_import.duplicate);
    assert!(!second_import.duplicate);

    let run_id = collector::ingest::create_run(
        &pool,
        CreateRunRequest {
            name: "Live feed".to_string(),
            machine_id: Some(second_machine.id),
            source_kind: "live".to_string(),
            source_name: Some("test".to_string()),
            started_at: None,
            notes: None,
        },
    )
    .await
    .unwrap();
    let assigned_machine_id: i64 = sqlx::query("SELECT machine_id FROM runs WHERE id = ?1")
        .bind(run_id)
        .fetch_one(&pool)
        .await
        .unwrap()
        .get("machine_id");

    assert_eq!(assigned_machine_id, second_machine.id);
    assert_eq!(list_machines(&pool).await.unwrap().len(), 2);
}

async fn create_test_pool() -> sqlx::SqlitePool {
    let temp_dir = tempfile::tempdir().unwrap();
    let database_path = temp_dir.path().join("fleet.db");
    let database_url = format!("sqlite://{}", database_path.display());
    let pool = collector::db::connect_database(&database_url)
        .await
        .unwrap();
    std::mem::forget(temp_dir);
    pool
}
