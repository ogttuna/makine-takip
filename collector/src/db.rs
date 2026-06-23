use std::path::Path;
use std::str::FromStr;

use anyhow::Context;
use chrono::{Duration, Utc};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Executor, SqlitePool};

pub async fn connect_database(database_url: &str) -> anyhow::Result<SqlitePool> {
    ensure_sqlite_parent(database_url)?;

    let options = SqliteConnectOptions::from_str(database_url)?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .context("failed to open SQLite database")?;

    sqlx::migrate!("../migrations")
        .run(&pool)
        .await
        .context("failed to run SQLite migrations")?;

    pool.execute("PRAGMA journal_mode = WAL;").await?;
    pool.execute("PRAGMA foreign_keys = ON;").await?;
    pool.execute("PRAGMA optimize;").await?;

    Ok(pool)
}

pub async fn seed_demo_data(pool: &SqlitePool) -> anyhow::Result<()> {
    let run_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM runs")
        .fetch_one(pool)
        .await?;

    if run_count > 0 {
        return Ok(());
    }

    let now = Utc::now();
    let started_at = now - Duration::hours(2);

    let recipe_id: i64 = sqlx::query_scalar(
        r#"
        INSERT INTO recipes (name, description, target_shelf_temp_c, target_pressure_mbar)
        VALUES (?1, ?2, ?3, ?4)
        RETURNING id
        "#,
    )
    .bind("Demo Lyophilization")
    .bind("Development recipe seeded by the collector")
    .bind(-35.0_f64)
    .bind(0.12_f64)
    .fetch_one(pool)
    .await?;

    let run_id: i64 = sqlx::query_scalar(
        r#"
        INSERT INTO runs (recipe_id, recipe_name, batch_code, started_at, status)
        VALUES (?1, ?2, ?3, ?4, ?5)
        RETURNING id
        "#,
    )
    .bind(recipe_id)
    .bind("Demo Lyophilization")
    .bind("DEV-001")
    .bind(started_at.to_rfc3339())
    .bind("running")
    .fetch_one(pool)
    .await?;

    for index in 0..180_i64 {
        let sampled_at = started_at + Duration::seconds(index * 40);
        let phase = match index {
            0..=55 => "freezing",
            56..=130 => "primary drying",
            _ => "secondary drying",
        };
        let shelf_temp = -45.0 + index as f64 * 0.34 + (index as f64 / 8.0).sin() * 1.7;
        let product_temp = -41.0 + index as f64 * 0.27 + (index as f64 / 11.0).sin() * 1.1;
        let condenser_temp = -64.0 + (index as f64 / 14.0).sin() * 1.4;
        let pressure = (780.0 * (-(index as f64) / 22.0).exp() + 0.055).max(0.045);

        sqlx::query(
            r#"
            INSERT INTO samples (
                run_id,
                sampled_at,
                shelf_temp_c,
                product_temp_c,
                condenser_temp_c,
                chamber_pressure_mbar,
                phase,
                raw_payload
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
        )
        .bind(run_id)
        .bind(sampled_at.to_rfc3339())
        .bind(round(shelf_temp, 2))
        .bind(round(product_temp, 2))
        .bind(round(condenser_temp, 2))
        .bind(round(pressure, 4))
        .bind(phase)
        .bind(serde_json::json!({ "source": "demo", "index": index }).to_string())
        .execute(pool)
        .await?;
    }

    sqlx::query(
        r#"
        INSERT INTO events (run_id, occurred_at, level, message)
        VALUES (?1, ?2, ?3, ?4)
        "#,
    )
    .bind(run_id)
    .bind(now.to_rfc3339())
    .bind("info")
    .bind("Demo run seeded")
    .execute(pool)
    .await?;

    Ok(())
}

fn ensure_sqlite_parent(database_url: &str) -> anyhow::Result<()> {
    if database_url == "sqlite::memory:" || database_url.ends_with(":memory:") {
        return Ok(());
    }

    let Some(path) = database_url
        .strip_prefix("sqlite://")
        .or_else(|| database_url.strip_prefix("sqlite:"))
    else {
        return Ok(());
    };

    let path = Path::new(path);

    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create SQLite directory {}", parent.display()))?;
    }

    Ok(())
}

fn round(value: f64, digits: i32) -> f64 {
    let factor = 10_f64.powi(digits);
    (value * factor).round() / factor
}
