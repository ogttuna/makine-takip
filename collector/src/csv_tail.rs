use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use anyhow::{Context, anyhow, bail};
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use tokio::sync::{Mutex, Notify, RwLock, watch};
use tokio::task::JoinHandle;

use crate::csv_import::{
    ParsedCsv, parse_csv_bytes, record_csv_row_quality_events, validate_csv_header,
};
use crate::ingest::{
    AppendMeasurementRequest, AppendSampleRequest, AppendSamplesRequest, CreateRunRequest,
    append_samples, create_run,
};

const SOURCE_ID: i64 = 1;
const DEFAULT_NAME: &str = "Freeze dryer CSV";
const DEFAULT_PATTERN: &str = "*.csv";
const DEFAULT_SCAN_INTERVAL_MS: i64 = 30_000;
const MAX_HEADER_BYTES: usize = 64 * 1024;

#[derive(Debug, Deserialize)]
pub struct CsvTailConfigRequest {
    pub name: Option<String>,
    pub directory_path: String,
    pub file_pattern: Option<String>,
    pub scan_interval_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CsvTailStatus {
    pub configured: bool,
    pub name: String,
    pub directory_path: String,
    pub file_pattern: String,
    pub scan_interval_ms: i64,
    pub enabled: bool,
    pub status: String,
    pub active_file_path: Option<String>,
    pub active_run_id: Option<i64>,
    pub byte_offset: Option<i64>,
    pub last_source_sequence: Option<i64>,
    pub last_sampled_at: Option<String>,
    pub last_scan_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
struct CsvTailSource {
    id: i64,
    name: String,
    directory_path: String,
    file_pattern: String,
    scan_interval_ms: i64,
    enabled: i64,
    active_file_path: Option<String>,
    active_run_id: Option<i64>,
    last_scan_at: Option<String>,
    last_error: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
struct CsvTailCheckpoint {
    id: i64,
    run_id: Option<i64>,
    byte_offset: i64,
    last_source_sequence: i64,
    header_line: Option<String>,
    completed: i64,
}

#[derive(Debug, Clone)]
struct RuntimeState {
    status: String,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            status: "stopped".to_string(),
        }
    }
}

struct WorkerControl {
    stop: watch::Sender<bool>,
    join: JoinHandle<()>,
}

struct CsvTailInner {
    pool: SqlitePool,
    runtime: RwLock<RuntimeState>,
    worker: Mutex<Option<WorkerControl>>,
    rescan: Notify,
}

#[derive(Clone)]
pub struct CsvTailManager {
    inner: Arc<CsvTailInner>,
}

impl CsvTailManager {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            inner: Arc::new(CsvTailInner {
                pool,
                runtime: RwLock::new(RuntimeState::default()),
                worker: Mutex::new(None),
                rescan: Notify::new(),
            }),
        }
    }

    pub async fn start_if_enabled(&self) -> anyhow::Result<()> {
        if load_source(&self.inner.pool)
            .await?
            .is_some_and(|source| source.enabled == 1)
        {
            self.spawn_worker().await?;
        }

        Ok(())
    }

    pub async fn configure(&self, request: CsvTailConfigRequest) -> anyhow::Result<CsvTailStatus> {
        self.stop().await?;

        let name = non_empty(
            request.name.unwrap_or_else(|| DEFAULT_NAME.to_string()),
            "name",
        )?;
        let file_pattern = non_empty(
            request
                .file_pattern
                .unwrap_or_else(|| DEFAULT_PATTERN.to_string()),
            "file_pattern",
        )?;
        let scan_interval_ms = request.scan_interval_ms.unwrap_or(DEFAULT_SCAN_INTERVAL_MS);

        if !(250..=60_000).contains(&scan_interval_ms) {
            bail!("scan_interval_ms must be between 250 and 60000");
        }

        let directory = canonical_directory(&request.directory_path)?;
        let directory_path = directory.to_string_lossy().to_string();
        let existing_source = load_source(&self.inner.pool).await?;
        let same_source = existing_source.as_ref().is_some_and(|source| {
            source.directory_path == directory_path && source.file_pattern == file_pattern
        });

        if same_source {
            sqlx::query(
                r#"
                UPDATE csv_tail_sources
                SET
                    name = ?2,
                    scan_interval_ms = ?3,
                    enabled = 0,
                    last_error = NULL,
                    updated_at = ?4
                WHERE id = ?1
                "#,
            )
            .bind(SOURCE_ID)
            .bind(name)
            .bind(scan_interval_ms)
            .bind(now())
            .execute(&self.inner.pool)
            .await?;
        } else {
            let mut tx = self.inner.pool.begin().await?;

            if let Some(run_id) = existing_source.and_then(|source| source.active_run_id) {
                sqlx::query(
                    r#"
                    UPDATE runs
                    SET
                        status = 'completed',
                        finished_at = COALESCE(
                            finished_at,
                            (SELECT MAX(sampled_at) FROM sample_frames WHERE run_id = ?1)
                        )
                    WHERE id = ?1 AND status = 'running'
                    "#,
                )
                .bind(run_id)
                .execute(&mut *tx)
                .await?;
            }

            sqlx::query("DELETE FROM csv_tail_checkpoints WHERE source_id = ?1")
                .bind(SOURCE_ID)
                .execute(&mut *tx)
                .await?;
            sqlx::query(
                r#"
                INSERT INTO csv_tail_sources (
                    id,
                    name,
                    directory_path,
                    file_pattern,
                    scan_interval_ms,
                    enabled,
                    active_file_path,
                    active_run_id,
                    last_error,
                    updated_at
                )
                VALUES (1, ?1, ?2, ?3, ?4, 0, NULL, NULL, NULL, ?5)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    directory_path = excluded.directory_path,
                    file_pattern = excluded.file_pattern,
                    scan_interval_ms = excluded.scan_interval_ms,
                    enabled = 0,
                    active_file_path = NULL,
                    active_run_id = NULL,
                    last_error = NULL,
                    updated_at = excluded.updated_at
                "#,
            )
            .bind(name)
            .bind(directory_path)
            .bind(file_pattern)
            .bind(scan_interval_ms)
            .bind(now())
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
        }

        self.set_runtime_status("stopped").await;
        self.status().await
    }

    pub async fn start(&self) -> anyhow::Result<CsvTailStatus> {
        if load_source(&self.inner.pool).await?.is_none() {
            bail!("CSV tail directory is not configured");
        }

        sqlx::query(
            "UPDATE csv_tail_sources SET enabled = 1, last_error = NULL, updated_at = ?2 WHERE id = ?1",
        )
        .bind(SOURCE_ID)
        .bind(now())
        .execute(&self.inner.pool)
        .await?;

        self.spawn_worker().await?;
        self.status().await
    }

    pub async fn stop(&self) -> anyhow::Result<CsvTailStatus> {
        sqlx::query("UPDATE csv_tail_sources SET enabled = 0, updated_at = ?2 WHERE id = ?1")
            .bind(SOURCE_ID)
            .bind(now())
            .execute(&self.inner.pool)
            .await?;

        let control = self.inner.worker.lock().await.take();

        if let Some(control) = control {
            let _ = control.stop.send(true);
            let _ = control.join.await;
        }

        self.set_runtime_status("stopped").await;
        self.status().await
    }

    pub async fn rescan(&self) -> anyhow::Result<CsvTailStatus> {
        let is_running = self
            .inner
            .worker
            .lock()
            .await
            .as_ref()
            .is_some_and(|control| !control.join.is_finished());

        if is_running {
            self.inner.rescan.notify_one();
            self.status().await
        } else {
            self.scan_once().await
        }
    }

    pub async fn scan_once(&self) -> anyhow::Result<CsvTailStatus> {
        let source = load_source(&self.inner.pool)
            .await?
            .ok_or_else(|| anyhow!("CSV tail directory is not configured"))?;

        match self.scan_source(&source).await {
            Ok(()) => self.clear_error().await?,
            Err(error) => {
                self.record_error(&error).await?;
                return Err(error);
            }
        }

        self.status().await
    }

    pub async fn status(&self) -> anyhow::Result<CsvTailStatus> {
        let Some(source) = load_source(&self.inner.pool).await? else {
            return Ok(CsvTailStatus {
                configured: false,
                name: DEFAULT_NAME.to_string(),
                directory_path: String::new(),
                file_pattern: DEFAULT_PATTERN.to_string(),
                scan_interval_ms: DEFAULT_SCAN_INTERVAL_MS,
                enabled: false,
                status: "stopped".to_string(),
                active_file_path: None,
                active_run_id: None,
                byte_offset: None,
                last_source_sequence: None,
                last_sampled_at: None,
                last_scan_at: None,
                last_error: None,
            });
        };

        let checkpoint = match source.active_file_path.as_deref() {
            Some(path) => load_checkpoint(&self.inner.pool, path).await?,
            None => None,
        };
        let last_sampled_at = match source.active_run_id {
            Some(run_id) => {
                sqlx::query_scalar::<_, Option<String>>(
                    "SELECT MAX(sampled_at) FROM sample_frames WHERE run_id = ?1",
                )
                .bind(run_id)
                .fetch_one(&self.inner.pool)
                .await?
            }
            None => None,
        };
        let runtime_status = self.inner.runtime.read().await.status.clone();

        Ok(CsvTailStatus {
            configured: true,
            name: source.name,
            directory_path: source.directory_path,
            file_pattern: source.file_pattern,
            scan_interval_ms: source.scan_interval_ms,
            enabled: source.enabled == 1,
            status: if source.enabled == 0 {
                "stopped".to_string()
            } else {
                runtime_status
            },
            active_file_path: source.active_file_path,
            active_run_id: source.active_run_id,
            byte_offset: checkpoint.as_ref().map(|item| item.byte_offset),
            last_source_sequence: checkpoint.as_ref().map(|item| item.last_source_sequence),
            last_sampled_at,
            last_scan_at: source.last_scan_at,
            last_error: source.last_error,
        })
    }

    async fn spawn_worker(&self) -> anyhow::Result<()> {
        let mut worker = self.inner.worker.lock().await;

        if worker
            .as_ref()
            .is_some_and(|control| !control.join.is_finished())
        {
            return Ok(());
        }

        let (stop, stop_rx) = watch::channel(false);
        let manager = self.clone();
        let join = tokio::spawn(async move {
            manager.run_loop(stop_rx).await;
        });
        *worker = Some(WorkerControl { stop, join });
        self.set_runtime_status("scanning").await;

        Ok(())
    }

    async fn run_loop(&self, mut stop: watch::Receiver<bool>) {
        loop {
            if *stop.borrow() {
                break;
            }

            let source = match load_source(&self.inner.pool).await {
                Ok(Some(source)) if source.enabled == 1 => source,
                Ok(_) => break,
                Err(error) => {
                    tracing::error!(%error, "failed to load CSV tail source");
                    break;
                }
            };

            if let Err(error) = self.scan_source(&source).await {
                tracing::warn!(%error, "CSV tail scan failed");
                if let Err(record_error) = self.record_error(&error).await {
                    tracing::error!(%record_error, "failed to store CSV tail error");
                }
            } else if let Err(error) = self.clear_error().await {
                tracing::warn!(%error, "failed to clear CSV tail error");
            }

            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(source.scan_interval_ms as u64)) => {}
                _ = self.inner.rescan.notified() => {}
                changed = stop.changed() => {
                    if changed.is_err() || *stop.borrow() {
                        break;
                    }
                }
            }
        }
    }

    async fn scan_source(&self, source: &CsvTailSource) -> anyhow::Result<()> {
        self.set_runtime_status("scanning").await;
        let files = discover_files(&source.directory_path, &source.file_pattern)?;
        let scan_time = now();
        sqlx::query("UPDATE csv_tail_sources SET last_scan_at = ?2, updated_at = ?2 WHERE id = ?1")
            .bind(source.id)
            .bind(&scan_time)
            .execute(&self.inner.pool)
            .await?;

        let Some(newest) = files.last() else {
            return Ok(());
        };

        if let Some(active_path) = source.active_file_path.as_deref() {
            let run_id = source
                .active_run_id
                .ok_or_else(|| anyhow!("active CSV tail file has no active run"))?;
            let pending_files = files
                .iter()
                .position(|file| file.path == active_path)
                .map(|index| &files[index + 1..])
                .unwrap_or_else(|| std::slice::from_ref(newest));

            if pending_files.is_empty() {
                self.tail_path(active_path, false).await?;
            } else {
                let mut rotated = false;

                for file in pending_files {
                    match inspect_header(Path::new(&file.path))? {
                        CsvHeaderInspection::Ready { .. } => {}
                        CsvHeaderInspection::Incomplete => break,
                        CsvHeaderInspection::Invalid(error) => {
                            let issue = CsvFileIssue::new(&file.path, &error);
                            record_csv_file_issues(
                                &self.inner.pool,
                                run_id,
                                std::slice::from_ref(&issue),
                            )
                            .await?;
                            continue;
                        }
                    }

                    let current_source = load_source(&self.inner.pool)
                        .await?
                        .ok_or_else(|| anyhow!("CSV tail source disappeared during rotation"))?;
                    self.rotate_to(&current_source, &file.path).await?;
                    rotated = true;
                }

                if !rotated {
                    self.tail_path(active_path, false).await?;
                }
            }

            self.set_runtime_status("tailing").await;
            return Ok(());
        }

        let mut ready_files = Vec::new();
        let mut file_issues = Vec::new();

        for file in &files {
            match inspect_header(Path::new(&file.path))? {
                CsvHeaderInspection::Ready { .. } => ready_files.push(file),
                CsvHeaderInspection::Incomplete => break,
                CsvHeaderInspection::Invalid(error) => {
                    file_issues.push(CsvFileIssue::new(&file.path, &error));
                }
            }
        }

        let Some(newest_ready) = ready_files.last().copied() else {
            if let Some(issue) = file_issues.first() {
                bail!(issue.message.clone());
            }
            return Ok(());
        };

        if load_checkpoint(&self.inner.pool, &newest_ready.path)
            .await?
            .is_some_and(|checkpoint| checkpoint.completed == 1)
        {
            return Ok(());
        }

        let run_id = match source.active_run_id {
            Some(run_id) => run_id,
            None => {
                let run_id = create_run(
                    &self.inner.pool,
                    CreateRunRequest {
                        name: file_name(&newest_ready.path)?,
                        source_kind: "csv_tail".to_string(),
                        source_name: Some(source.directory_path.clone()),
                        started_at: None,
                        notes: Some(
                            "Continuous machine CSV stream; includes historical and daily files"
                                .to_string(),
                        ),
                    },
                )
                .await?;

                sqlx::query(
                    "UPDATE csv_tail_sources SET active_run_id = ?2, updated_at = ?3 WHERE id = ?1",
                )
                .bind(source.id)
                .bind(run_id)
                .bind(now())
                .execute(&self.inner.pool)
                .await?;
                run_id
            }
        };

        record_csv_file_issues(&self.inner.pool, run_id, &file_issues).await?;

        for file in ready_files.iter().take(ready_files.len().saturating_sub(1)) {
            self.backfill_file(source.id, run_id, &file.path)
                .await
                .with_context(|| format!("historical CSV backfill failed for `{}`", file.path))?;
        }

        self.start_file(source.id, &newest_ready.path, Some(run_id))
            .await?;
        self.set_runtime_status("tailing").await;

        Ok(())
    }

    async fn backfill_file(
        &self,
        source_id: i64,
        run_id: i64,
        file_path: &str,
    ) -> anyhow::Result<()> {
        if load_checkpoint(&self.inner.pool, file_path)
            .await?
            .is_some()
        {
            return Ok(());
        }

        let bytes = fs::read(file_path)
            .with_context(|| format!("failed to read historical CSV `{file_path}`"))?;
        let file_name = file_name(file_path)?;
        let parsed = parse_csv_bytes(file_name.clone(), &bytes)?;
        let sample_count = parsed.frames.len() as i64;
        let record_count = parsed.record_count as i64;
        let first_sequence = last_source_sequence(&self.inner.pool, source_id, run_id).await? + 1;
        let row_quality_events = parsed.quality_events.clone();

        if sample_count > 0 {
            append_samples(
                &self.inner.pool,
                run_id,
                parsed_to_append_request(parsed, first_sequence),
            )
            .await?;
        }
        record_csv_row_quality_events(
            &self.inner.pool,
            run_id,
            &file_name,
            &row_quality_events,
            first_sequence,
        )
        .await?;
        let header_line = read_header(Path::new(file_path))?.map(|item| item.0);

        sqlx::query(
            r#"
            INSERT INTO csv_tail_checkpoints (
                source_id,
                file_path,
                run_id,
                byte_offset,
                last_source_sequence,
                header_line,
                file_size,
                completed,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?4, 1, ?7)
            "#,
        )
        .bind(source_id)
        .bind(file_path)
        .bind(run_id)
        .bind(bytes.len() as i64)
        .bind(first_sequence + record_count - 1)
        .bind(header_line)
        .bind(now())
        .execute(&self.inner.pool)
        .await?;

        Ok(())
    }

    async fn start_file(
        &self,
        source_id: i64,
        file_path: &str,
        existing_run_id: Option<i64>,
    ) -> anyhow::Result<()> {
        let (header_line, header_offset) = read_header(Path::new(file_path))?
            .ok_or_else(|| anyhow!("CSV `{file_path}` does not contain a complete header"))?;
        let metadata = fs::metadata(file_path)?;
        let run_id = match existing_run_id {
            Some(run_id) => run_id,
            None => {
                create_run(
                    &self.inner.pool,
                    CreateRunRequest {
                        name: file_name(file_path)?,
                        source_kind: "csv_tail".to_string(),
                        source_name: Some(file_path.to_string()),
                        started_at: None,
                        notes: Some(
                            "Continuous machine CSV stream; may span daily files".to_string(),
                        ),
                    },
                )
                .await?
            }
        };
        let last_source_sequence =
            last_source_sequence(&self.inner.pool, source_id, run_id).await?;

        sqlx::query(
            r#"
            INSERT INTO csv_tail_checkpoints (
                source_id,
                file_path,
                run_id,
                byte_offset,
                last_source_sequence,
                header_line,
                file_size,
                completed,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)
            ON CONFLICT(source_id, file_path) DO UPDATE SET
                run_id = excluded.run_id,
                byte_offset = excluded.byte_offset,
                last_source_sequence = excluded.last_source_sequence,
                header_line = excluded.header_line,
                file_size = excluded.file_size,
                completed = 0,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(source_id)
        .bind(file_path)
        .bind(run_id)
        .bind(header_offset as i64)
        .bind(last_source_sequence)
        .bind(header_line)
        .bind(metadata.len() as i64)
        .bind(now())
        .execute(&self.inner.pool)
        .await?;

        sqlx::query(
            r#"
            UPDATE csv_tail_sources
            SET active_file_path = ?2, active_run_id = ?3, updated_at = ?4
            WHERE id = ?1
            "#,
        )
        .bind(source_id)
        .bind(file_path)
        .bind(run_id)
        .bind(now())
        .execute(&self.inner.pool)
        .await?;

        self.tail_path(file_path, false).await
    }

    async fn rotate_to(&self, source: &CsvTailSource, new_path: &str) -> anyhow::Result<()> {
        self.set_runtime_status("switching").await;

        if let Some(active_path) = source.active_file_path.as_deref() {
            self.tail_path(active_path, true).await?;
            sqlx::query(
                "UPDATE csv_tail_checkpoints SET completed = 1, updated_at = ?2 WHERE source_id = ?1 AND file_path = ?3",
            )
            .bind(source.id)
            .bind(now())
            .bind(active_path)
            .execute(&self.inner.pool)
            .await?;
        }

        sqlx::query(
            "UPDATE csv_tail_sources SET active_file_path = NULL, updated_at = ?2 WHERE id = ?1",
        )
        .bind(source.id)
        .bind(now())
        .execute(&self.inner.pool)
        .await?;

        self.start_file(source.id, new_path, source.active_run_id)
            .await
    }

    async fn tail_path(&self, file_path: &str, accept_eof: bool) -> anyhow::Result<()> {
        let checkpoint = load_checkpoint(&self.inner.pool, file_path)
            .await?
            .ok_or_else(|| anyhow!("missing checkpoint for `{file_path}`"))?;

        if checkpoint.completed == 1 {
            return Ok(());
        }

        let run_id = checkpoint
            .run_id
            .ok_or_else(|| anyhow!("checkpoint for `{file_path}` has no run"))?;
        let header_line = checkpoint
            .header_line
            .as_deref()
            .ok_or_else(|| anyhow!("checkpoint for `{file_path}` has no CSV header"))?;
        let metadata = fs::metadata(file_path)
            .with_context(|| format!("failed to inspect active CSV `{file_path}`"))?;

        if metadata.len() < checkpoint.byte_offset as u64 {
            bail!("active CSV `{file_path}` was truncated or replaced");
        }

        let chunk = read_new_bytes(Path::new(file_path), checkpoint.byte_offset as u64)?;
        let consumed = complete_prefix_len(&chunk, accept_eof);

        if consumed == 0 {
            update_checkpoint_size(&self.inner.pool, checkpoint.id, metadata.len()).await?;
            return Ok(());
        }

        let complete_bytes = &chunk[..consumed];

        if complete_bytes.iter().all(u8::is_ascii_whitespace) {
            update_checkpoint(
                &self.inner.pool,
                checkpoint.id,
                checkpoint.byte_offset + consumed as i64,
                checkpoint.last_source_sequence,
                metadata.len(),
            )
            .await?;
            return Ok(());
        }

        let mut csv_bytes = Vec::with_capacity(header_line.len() + 1 + complete_bytes.len());
        csv_bytes.extend_from_slice(header_line.as_bytes());
        csv_bytes.push(b'\n');
        csv_bytes.extend_from_slice(complete_bytes);
        let source_file_name = file_name(file_path)?;
        let parsed = parse_csv_bytes(source_file_name.clone(), &csv_bytes)?;
        let sample_count = parsed.frames.len() as i64;
        let record_count = parsed.record_count as i64;
        let first_sequence = checkpoint.last_source_sequence + 1;
        let row_quality_events = parsed.quality_events.clone();

        if sample_count > 0 {
            let request = parsed_to_append_request(parsed, first_sequence);
            append_samples(&self.inner.pool, run_id, request).await?;
        }
        record_csv_row_quality_events(
            &self.inner.pool,
            run_id,
            &source_file_name,
            &row_quality_events,
            first_sequence,
        )
        .await?;
        update_checkpoint(
            &self.inner.pool,
            checkpoint.id,
            checkpoint.byte_offset + consumed as i64,
            checkpoint.last_source_sequence + record_count,
            metadata.len(),
        )
        .await?;

        Ok(())
    }

    async fn record_error(&self, error: &anyhow::Error) -> anyhow::Result<()> {
        self.set_runtime_status("degraded").await;
        sqlx::query(
            "UPDATE csv_tail_sources SET last_error = ?2, last_scan_at = ?3, updated_at = ?3 WHERE id = ?1",
        )
        .bind(SOURCE_ID)
        .bind(error.to_string())
        .bind(now())
        .execute(&self.inner.pool)
        .await?;
        Ok(())
    }

    async fn clear_error(&self) -> anyhow::Result<()> {
        sqlx::query("UPDATE csv_tail_sources SET last_error = NULL, updated_at = ?2 WHERE id = ?1")
            .bind(SOURCE_ID)
            .bind(now())
            .execute(&self.inner.pool)
            .await?;
        Ok(())
    }

    async fn set_runtime_status(&self, status: &str) {
        self.inner.runtime.write().await.status = status.to_string();
    }
}

fn parsed_to_append_request(parsed: ParsedCsv, first_sequence: i64) -> AppendSamplesRequest {
    let samples = parsed
        .frames
        .into_iter()
        .map(|frame| AppendSampleRequest {
            sampled_at: frame.sampled_at,
            source_timestamp_text: Some(frame.source_timestamp_text),
            source_sequence: Some(first_sequence + frame.source_row_number - 2),
            state_observation: frame.state_observation.map(|observation| {
                crate::ingest::AppendStateObservationRequest {
                    source_recipe_code: observation.source_recipe_code,
                    source_recipe_version: observation.source_recipe_version,
                    source_state_code: observation.source_state_code,
                    source_state_name: observation.source_state_name,
                    source_payload_json: observation.source_payload_json,
                }
            }),
            measurements: frame
                .measurements
                .into_iter()
                .map(|measurement| AppendMeasurementRequest {
                    channel_code: measurement.channel_code,
                    raw_text: Some(measurement.raw_text),
                    numeric_value: measurement.numeric_value,
                    value_text: measurement.value_text,
                    value_type: Some(measurement.value_type.as_str().to_string()),
                    quality: Some(measurement.quality.as_str().to_string()),
                    quality_reason: measurement.quality_reason,
                })
                .collect(),
        })
        .collect();

    AppendSamplesRequest { samples }
}

async fn load_source(pool: &SqlitePool) -> anyhow::Result<Option<CsvTailSource>> {
    Ok(sqlx::query_as::<_, CsvTailSource>(
        r#"
        SELECT
            id,
            name,
            directory_path,
            file_pattern,
            scan_interval_ms,
            enabled,
            active_file_path,
            active_run_id,
            last_scan_at,
            last_error
        FROM csv_tail_sources
        WHERE id = 1
        "#,
    )
    .fetch_optional(pool)
    .await?)
}

async fn load_checkpoint(
    pool: &SqlitePool,
    file_path: &str,
) -> anyhow::Result<Option<CsvTailCheckpoint>> {
    Ok(sqlx::query_as::<_, CsvTailCheckpoint>(
        r#"
        SELECT
            id,
            run_id,
            byte_offset,
            last_source_sequence,
            header_line,
            completed
        FROM csv_tail_checkpoints
        WHERE source_id = 1 AND file_path = ?1
        "#,
    )
    .bind(file_path)
    .fetch_optional(pool)
    .await?)
}

async fn last_source_sequence(
    pool: &SqlitePool,
    source_id: i64,
    run_id: i64,
) -> anyhow::Result<i64> {
    let checkpoint_sequence = sqlx::query_scalar::<_, Option<i64>>(
        r#"
        SELECT MAX(last_source_sequence)
        FROM csv_tail_checkpoints
        WHERE source_id = ?1 AND run_id = ?2
        "#,
    )
    .bind(source_id)
    .bind(run_id)
    .fetch_one(pool)
    .await?
    .unwrap_or(1);
    let sample_sequence = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT MAX(source_row_number) FROM sample_frames WHERE run_id = ?1",
    )
    .bind(run_id)
    .fetch_one(pool)
    .await?
    .unwrap_or(1);

    Ok(checkpoint_sequence.max(sample_sequence))
}

async fn update_checkpoint(
    pool: &SqlitePool,
    checkpoint_id: i64,
    byte_offset: i64,
    last_source_sequence: i64,
    file_size: u64,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        UPDATE csv_tail_checkpoints
        SET
            byte_offset = ?2,
            last_source_sequence = ?3,
            file_size = ?4,
            updated_at = ?5
        WHERE id = ?1
        "#,
    )
    .bind(checkpoint_id)
    .bind(byte_offset)
    .bind(last_source_sequence)
    .bind(file_size as i64)
    .bind(now())
    .execute(pool)
    .await?;
    Ok(())
}

async fn update_checkpoint_size(
    pool: &SqlitePool,
    checkpoint_id: i64,
    file_size: u64,
) -> anyhow::Result<()> {
    sqlx::query("UPDATE csv_tail_checkpoints SET file_size = ?2, updated_at = ?3 WHERE id = ?1")
        .bind(checkpoint_id)
        .bind(file_size as i64)
        .bind(now())
        .execute(pool)
        .await?;
    Ok(())
}

#[derive(Debug)]
struct FileCandidate {
    path: String,
    modified: SystemTime,
    log_date: Option<NaiveDate>,
}

#[derive(Debug)]
struct CsvFileIssue {
    file_name: String,
    path: String,
    message: String,
}

impl CsvFileIssue {
    fn new(path: &str, error: &anyhow::Error) -> Self {
        Self {
            file_name: file_name(path).unwrap_or_else(|_| path.to_string()),
            path: path.to_string(),
            message: format!("{error:#}"),
        }
    }
}

async fn record_csv_file_issues(
    pool: &SqlitePool,
    run_id: i64,
    issues: &[CsvFileIssue],
) -> anyhow::Result<()> {
    for issue in issues {
        let metadata_json = serde_json::json!({
            "source_file_name": issue.file_name,
            "source_file_path": issue.path,
            "reason": issue.message,
        })
        .to_string();
        let result = sqlx::query(
            r#"
            INSERT INTO quality_events (
                run_id,
                frame_id,
                channel_id,
                event_type,
                severity,
                message,
                metadata_json
            )
            SELECT ?1, NULL, NULL, 'csv_file_header_error', 'error', ?2, ?3
            WHERE NOT EXISTS (
                SELECT 1
                FROM quality_events
                WHERE run_id = ?1
                  AND event_type = 'csv_file_header_error'
                  AND metadata_json = ?3
            )
            "#,
        )
        .bind(run_id)
        .bind(format!(
            "CSV `{}` was skipped so valid files could continue: {}",
            issue.file_name, issue.message
        ))
        .bind(metadata_json)
        .execute(pool)
        .await?;

        if result.rows_affected() > 0 {
            tracing::warn!(
                file_name = %issue.file_name,
                error = %issue.message,
                "skipped unreadable CSV while continuing with valid files"
            );
        }
    }

    Ok(())
}

fn discover_files(directory_path: &str, pattern: &str) -> anyhow::Result<Vec<FileCandidate>> {
    let mut files = Vec::new();

    for entry in fs::read_dir(directory_path)
        .with_context(|| format!("failed to read CSV directory `{directory_path}`"))?
    {
        let entry = entry?;
        let metadata = entry.metadata()?;

        if !metadata.is_file() {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();

        if !matches_pattern(&file_name, pattern) {
            continue;
        }

        if is_download_duplicate_name(&file_name) {
            tracing::debug!(%file_name, "skipping browser/download duplicate CSV name");
            continue;
        }

        files.push(FileCandidate {
            path: entry.path().to_string_lossy().to_string(),
            modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            log_date: log_file_date(&file_name),
        });
    }

    files.sort_by(|left, right| match (left.log_date, right.log_date) {
        (Some(left_date), Some(right_date)) => left_date
            .cmp(&right_date)
            .then_with(|| left.path.cmp(&right.path)),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => left
            .modified
            .cmp(&right.modified)
            .then_with(|| left.path.cmp(&right.path)),
    });

    Ok(files)
}

fn log_file_date(file_name: &str) -> Option<NaiveDate> {
    let normalized = file_name.to_ascii_lowercase();
    let date = normalized.strip_prefix("logfile_")?.strip_suffix(".csv")?;

    NaiveDate::parse_from_str(date, "%Y_%m_%d").ok()
}

fn is_download_duplicate_name(file_name: &str) -> bool {
    let normalized = file_name.to_ascii_lowercase();
    let Some(stem) = normalized.strip_suffix(".csv") else {
        return false;
    };
    let Some((canonical_stem, copy_number)) = stem.rsplit_once(" (") else {
        return false;
    };
    let Some(copy_number) = copy_number.strip_suffix(')') else {
        return false;
    };

    !copy_number.is_empty()
        && copy_number
            .chars()
            .all(|character| character.is_ascii_digit())
        && log_file_date(&format!("{canonical_stem}.csv")).is_some()
}

fn matches_pattern(file_name: &str, pattern: &str) -> bool {
    let file_name = file_name.to_ascii_lowercase();
    let pattern = pattern.to_ascii_lowercase();

    if pattern == "*" {
        return true;
    }

    if let Some((prefix, suffix)) = pattern.split_once('*') {
        return file_name.starts_with(prefix) && file_name.ends_with(suffix);
    }

    file_name == pattern
}

fn canonical_directory(value: &str) -> anyhow::Result<PathBuf> {
    let value = value.trim();

    if value.is_empty() {
        bail!("directory_path must not be empty");
    }

    let path = fs::canonicalize(value)
        .with_context(|| format!("CSV directory `{value}` does not exist or is not readable"))?;

    if !path.is_dir() {
        bail!("CSV directory `{value}` is not a directory");
    }

    fs::read_dir(&path)
        .with_context(|| format!("CSV directory `{}` is not readable", path.display()))?;
    Ok(path)
}

#[derive(Debug)]
enum CsvHeaderInspection {
    Ready { line: String, end_offset: usize },
    Incomplete,
    Invalid(anyhow::Error),
}

fn inspect_header(path: &Path) -> anyhow::Result<CsvHeaderInspection> {
    let mut file = File::open(path)
        .with_context(|| format!("failed to open CSV header from `{}`", path.display()))?;
    let mut bytes = Vec::with_capacity(MAX_HEADER_BYTES + 1);
    file.by_ref()
        .take((MAX_HEADER_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .with_context(|| format!("failed to read CSV header from `{}`", path.display()))?;
    let Some(newline_index) = bytes.iter().position(|byte| *byte == b'\n') else {
        if bytes.len() > MAX_HEADER_BYTES {
            return Ok(CsvHeaderInspection::Invalid(anyhow!(
                "CSV header exceeds the {MAX_HEADER_BYTES}-byte safety limit"
            )));
        }

        return Ok(CsvHeaderInspection::Incomplete);
    };
    let mut header_bytes = &bytes[..newline_index];

    if header_bytes.ends_with(b"\r") {
        header_bytes = &header_bytes[..header_bytes.len() - 1];
    }

    if header_bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        header_bytes = &header_bytes[3..];
    }

    let header = match std::str::from_utf8(header_bytes).context("CSV header must be UTF-8") {
        Ok(header) => header.trim().to_string(),
        Err(error) => return Ok(CsvHeaderInspection::Invalid(error)),
    };
    let source_file_name = file_name(&path.to_string_lossy())?;
    let header = match validate_csv_header(&source_file_name, &header)
        .with_context(|| format!("CSV `{}` has an invalid header", path.display()))
    {
        Ok(header) => header,
        Err(error) => return Ok(CsvHeaderInspection::Invalid(error)),
    };

    Ok(CsvHeaderInspection::Ready {
        line: header,
        end_offset: newline_index + 1,
    })
}

fn read_header(path: &Path) -> anyhow::Result<Option<(String, usize)>> {
    match inspect_header(path)? {
        CsvHeaderInspection::Ready { line, end_offset } => Ok(Some((line, end_offset))),
        CsvHeaderInspection::Incomplete => Ok(None),
        CsvHeaderInspection::Invalid(error) => Err(error),
    }
}

fn read_new_bytes(path: &Path, offset: u64) -> anyhow::Result<Vec<u8>> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(offset))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn complete_prefix_len(bytes: &[u8], accept_eof: bool) -> usize {
    if accept_eof {
        return bytes.len();
    }

    bytes
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map(|index| index + 1)
        .unwrap_or(0)
}

fn file_name(file_path: &str) -> anyhow::Result<String> {
    Path::new(file_path)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .ok_or_else(|| anyhow!("CSV path `{file_path}` has no file name"))
}

fn non_empty(value: String, label: &str) -> anyhow::Result<String> {
    let value = value.trim().to_string();

    if value.is_empty() {
        bail!("{label} must not be empty");
    }

    Ok(value)
}

fn now() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{
        CsvHeaderInspection, MAX_HEADER_BYTES, inspect_header, is_download_duplicate_name,
    };

    #[test]
    fn recognizes_download_copy_names_without_hiding_canonical_logs() {
        assert!(is_download_duplicate_name("LogFile_2026_08_14 (1).csv"));
        assert!(is_download_duplicate_name("LogFile_2026_08_14 (23).CSV"));
        assert!(!is_download_duplicate_name("LogFile_2026_08_14.csv"));
        assert!(!is_download_duplicate_name("other (1).csv"));
    }

    #[test]
    fn distinguishes_incomplete_invalid_and_unreadable_headers() {
        let root = tempfile::tempdir().unwrap();
        let partial = root.path().join("LogFile_2026_08_14.csv");
        fs::write(&partial, "SAAT;RAF1").unwrap();
        assert!(matches!(
            inspect_header(&partial).unwrap(),
            CsvHeaderInspection::Incomplete
        ));

        let oversized = root.path().join("LogFile_2026_08_15.csv");
        fs::write(&oversized, vec![b'X'; MAX_HEADER_BYTES + 1]).unwrap();
        assert!(matches!(
            inspect_header(&oversized).unwrap(),
            CsvHeaderInspection::Invalid(_)
        ));

        let missing = root.path().join("LogFile_2026_08_16.csv");
        assert!(inspect_header(&missing).is_err());
    }
}
