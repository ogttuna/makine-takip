use std::future::Future;

use anyhow::Context;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use crate::config::CollectorConfig;
use crate::csv_tail::CsvTailManager;
use crate::{analysis, db, routes};

pub async fn serve_with_shutdown<F>(config: CollectorConfig, shutdown: F) -> anyhow::Result<()>
where
    F: Future<Output = ()> + Send + 'static,
{
    let pool = db::connect_database(&config.database_url).await?;

    match analysis::analyze_missing_runs(&pool).await {
        Ok(count) if count > 0 => {
            tracing::info!(run_count = count, "backfilled missing FD-750 analyses");
        }
        Ok(_) => {}
        Err(error) => {
            tracing::warn!(%error, "failed to backfill missing FD-750 analyses");
        }
    }

    let csv_tail = CsvTailManager::new(pool.clone());
    csv_tail.start_if_enabled().await?;
    let app = routes::router_with_csv_tail(pool, csv_tail)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());
    let listener = TcpListener::bind(config.bind_addr)
        .await
        .with_context(|| format!("failed to bind collector on {}", config.bind_addr))?;

    tracing::info!(
        bind_addr = %config.bind_addr,
        database_url = %config.database_url,
        "collector started"
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await
        .context("collector server failed")
}
