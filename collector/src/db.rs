use std::path::Path;
use std::str::FromStr;

use anyhow::Context;
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
