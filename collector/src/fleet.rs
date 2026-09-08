use anyhow::{anyhow, bail};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct MachineSummary {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub model: Option<String>,
    pub location: Option<String>,
    pub status: String,
    pub active_run_id: Option<i64>,
    pub active_run_name: Option<String>,
    pub last_sampled_at: Option<String>,
    pub last_seen_at: Option<String>,
    pub source_count: i64,
    pub run_count: i64,
    pub warning_count: i64,
    pub error_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateMachineRequest {
    pub code: String,
    pub name: String,
    pub model: Option<String>,
    pub location: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMachineRequest {
    pub code: Option<String>,
    pub name: Option<String>,
    pub model: Option<String>,
    pub location: Option<String>,
    pub status: Option<String>,
}

pub async fn list_machines(pool: &SqlitePool) -> anyhow::Result<Vec<MachineSummary>> {
    Ok(
        sqlx::query_as::<_, MachineSummary>(machine_summary_query(None))
            .fetch_all(pool)
            .await?,
    )
}

pub async fn create_machine(
    pool: &SqlitePool,
    request: CreateMachineRequest,
) -> anyhow::Result<MachineSummary> {
    let code = valid_code(&request.code)?;
    let name = required_text(&request.name, "machine name", 120)?;
    let model = optional_text(request.model, 80)?;
    let location = optional_text(request.location, 160)?;

    let id = sqlx::query_scalar::<_, i64>(
        r#"
        INSERT INTO machines (code, name, model, location)
        VALUES (?1, ?2, ?3, ?4)
        RETURNING id
        "#,
    )
    .bind(code)
    .bind(name)
    .bind(model)
    .bind(location)
    .fetch_one(pool)
    .await
    .map_err(|error| {
        if error.to_string().contains("UNIQUE constraint failed") {
            anyhow!("machine code is already in use")
        } else {
            error.into()
        }
    })?;

    machine_by_id(pool, id).await
}

pub async fn update_machine(
    pool: &SqlitePool,
    id: i64,
    request: UpdateMachineRequest,
) -> anyhow::Result<MachineSummary> {
    let current = machine_by_id(pool, id).await?;
    let code = request
        .code
        .as_deref()
        .map(valid_code)
        .transpose()?
        .unwrap_or(current.code);
    let name = request
        .name
        .as_deref()
        .map(|value| required_text(value, "machine name", 120))
        .transpose()?
        .unwrap_or(current.name);
    let model = match request.model {
        Some(value) => optional_text(Some(value), 80)?,
        None => current.model,
    };
    let location = match request.location {
        Some(value) => optional_text(Some(value), 160)?,
        None => current.location,
    };
    let status = request.status.unwrap_or(current.status);

    if !matches!(status.as_str(), "active" | "maintenance" | "inactive") {
        bail!("machine status must be active, maintenance, or inactive");
    }

    let result = sqlx::query(
        r#"
        UPDATE machines
        SET code = ?2, name = ?3, model = ?4, location = ?5, status = ?6,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?1
        "#,
    )
    .bind(id)
    .bind(code)
    .bind(name)
    .bind(model)
    .bind(location)
    .bind(status)
    .execute(pool)
    .await
    .map_err(|error| {
        if error.to_string().contains("UNIQUE constraint failed") {
            anyhow!("machine code is already in use")
        } else {
            error.into()
        }
    })?;

    if result.rows_affected() == 0 {
        bail!("machine {id} was not found");
    }

    machine_by_id(pool, id).await
}

pub async fn machine_by_id(pool: &SqlitePool, id: i64) -> anyhow::Result<MachineSummary> {
    sqlx::query_as::<_, MachineSummary>(machine_summary_query(Some(id)))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow!("machine {id} was not found"))
}

pub async fn resolve_machine_id(
    pool: &SqlitePool,
    requested_id: Option<i64>,
) -> anyhow::Result<i64> {
    if let Some(id) = requested_id {
        let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM machines WHERE id = ?1")
            .bind(id)
            .fetch_one(pool)
            .await?;

        if exists == 0 {
            bail!("machine {id} was not found");
        }

        return Ok(id);
    }

    sqlx::query_scalar::<_, i64>(
        "SELECT id FROM machines ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, id LIMIT 1",
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow!("no machine is configured"))
}

fn machine_summary_query(id: Option<i64>) -> &'static str {
    const ALL: &str = r#"
        SELECT
            m.id,
            m.code,
            m.name,
            m.model,
            m.location,
            m.status,
            (
                SELECT r.id
                FROM runs r
                WHERE r.machine_id = m.id AND r.status = 'running'
                  AND (
                      r.source_kind <> 'csv_tail'
                      OR EXISTS (
                          SELECT 1
                          FROM browser_tail_sources b
                          WHERE b.active_run_id = r.id
                            AND b.enabled = 1
                            AND julianday(b.last_seen_at) >= julianday('now', '-5 minutes')
                      )
                      OR EXISTS (
                          SELECT 1
                          FROM csv_tail_sources c
                          WHERE c.active_run_id = r.id AND c.enabled = 1
                      )
                  )
                ORDER BY COALESCE(r.started_at, r.created_at) DESC, r.id DESC
                LIMIT 1
            ) AS active_run_id,
            (
                SELECT r.name
                FROM runs r
                WHERE r.machine_id = m.id AND r.status = 'running'
                  AND (
                      r.source_kind <> 'csv_tail'
                      OR EXISTS (
                          SELECT 1
                          FROM browser_tail_sources b
                          WHERE b.active_run_id = r.id
                            AND b.enabled = 1
                            AND julianday(b.last_seen_at) >= julianday('now', '-5 minutes')
                      )
                      OR EXISTS (
                          SELECT 1
                          FROM csv_tail_sources c
                          WHERE c.active_run_id = r.id AND c.enabled = 1
                      )
                  )
                ORDER BY COALESCE(r.started_at, r.created_at) DESC, r.id DESC
                LIMIT 1
            ) AS active_run_name,
            (
                SELECT MAX(f.sampled_at)
                FROM sample_frames f
                JOIN runs r ON r.id = f.run_id
                WHERE r.machine_id = m.id
            ) AS last_sampled_at,
            (
                SELECT MAX(b.last_seen_at)
                FROM browser_tail_sources b
                WHERE b.machine_id = m.id
            ) AS last_seen_at,
            (
                SELECT COUNT(*)
                FROM browser_tail_sources b
                WHERE b.machine_id = m.id
            ) AS source_count,
            (
                SELECT COUNT(*)
                FROM runs r
                WHERE r.machine_id = m.id
            ) AS run_count,
            (
                SELECT COUNT(*)
                FROM quality_events q
                JOIN runs r ON r.id = q.run_id
                WHERE r.machine_id = m.id AND q.severity = 'warning'
                  AND r.id = (
                      SELECT rr.id
                      FROM runs rr
                      WHERE rr.machine_id = m.id
                      ORDER BY COALESCE(rr.started_at, rr.created_at) DESC, rr.id DESC
                      LIMIT 1
                  )
            ) AS warning_count,
            (
                SELECT COUNT(*)
                FROM quality_events q
                JOIN runs r ON r.id = q.run_id
                WHERE r.machine_id = m.id AND q.severity = 'error'
                  AND r.id = (
                      SELECT rr.id
                      FROM runs rr
                      WHERE rr.machine_id = m.id
                      ORDER BY COALESCE(rr.started_at, rr.created_at) DESC, rr.id DESC
                      LIMIT 1
                  )
            ) AS error_count
        FROM machines m
        ORDER BY CASE m.status WHEN 'active' THEN 0 WHEN 'maintenance' THEN 1 ELSE 2 END,
                 m.code COLLATE NOCASE,
                 m.name COLLATE NOCASE,
                 m.id
    "#;
    const ONE: &str = r#"
        SELECT
            m.id,
            m.code,
            m.name,
            m.model,
            m.location,
            m.status,
            (
                SELECT r.id
                FROM runs r
                WHERE r.machine_id = m.id AND r.status = 'running'
                  AND (
                      r.source_kind <> 'csv_tail'
                      OR EXISTS (
                          SELECT 1
                          FROM browser_tail_sources b
                          WHERE b.active_run_id = r.id
                            AND b.enabled = 1
                            AND julianday(b.last_seen_at) >= julianday('now', '-5 minutes')
                      )
                      OR EXISTS (
                          SELECT 1
                          FROM csv_tail_sources c
                          WHERE c.active_run_id = r.id AND c.enabled = 1
                      )
                  )
                ORDER BY COALESCE(r.started_at, r.created_at) DESC, r.id DESC
                LIMIT 1
            ) AS active_run_id,
            (
                SELECT r.name
                FROM runs r
                WHERE r.machine_id = m.id AND r.status = 'running'
                  AND (
                      r.source_kind <> 'csv_tail'
                      OR EXISTS (
                          SELECT 1
                          FROM browser_tail_sources b
                          WHERE b.active_run_id = r.id
                            AND b.enabled = 1
                            AND julianday(b.last_seen_at) >= julianday('now', '-5 minutes')
                      )
                      OR EXISTS (
                          SELECT 1
                          FROM csv_tail_sources c
                          WHERE c.active_run_id = r.id AND c.enabled = 1
                      )
                  )
                ORDER BY COALESCE(r.started_at, r.created_at) DESC, r.id DESC
                LIMIT 1
            ) AS active_run_name,
            (
                SELECT MAX(f.sampled_at)
                FROM sample_frames f
                JOIN runs r ON r.id = f.run_id
                WHERE r.machine_id = m.id
            ) AS last_sampled_at,
            (
                SELECT MAX(b.last_seen_at)
                FROM browser_tail_sources b
                WHERE b.machine_id = m.id
            ) AS last_seen_at,
            (
                SELECT COUNT(*)
                FROM browser_tail_sources b
                WHERE b.machine_id = m.id
            ) AS source_count,
            (
                SELECT COUNT(*)
                FROM runs r
                WHERE r.machine_id = m.id
            ) AS run_count,
            (
                SELECT COUNT(*)
                FROM quality_events q
                JOIN runs r ON r.id = q.run_id
                WHERE r.machine_id = m.id AND q.severity = 'warning'
                  AND r.id = (
                      SELECT rr.id
                      FROM runs rr
                      WHERE rr.machine_id = m.id
                      ORDER BY COALESCE(rr.started_at, rr.created_at) DESC, rr.id DESC
                      LIMIT 1
                  )
            ) AS warning_count,
            (
                SELECT COUNT(*)
                FROM quality_events q
                JOIN runs r ON r.id = q.run_id
                WHERE r.machine_id = m.id AND q.severity = 'error'
                  AND r.id = (
                      SELECT rr.id
                      FROM runs rr
                      WHERE rr.machine_id = m.id
                      ORDER BY COALESCE(rr.started_at, rr.created_at) DESC, rr.id DESC
                      LIMIT 1
                  )
            ) AS error_count
        FROM machines m
        WHERE m.id = ?1
    "#;

    if id.is_some() { ONE } else { ALL }
}

fn valid_code(value: &str) -> anyhow::Result<String> {
    let value = required_text(value, "machine code", 48)?.to_uppercase();

    if !value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        bail!("machine code may contain only letters, numbers, '-' and '_'");
    }

    Ok(value)
}

fn required_text(value: &str, label: &str, max_len: usize) -> anyhow::Result<String> {
    let value = value.trim();
    if value.is_empty() {
        bail!("{label} must not be empty");
    }
    if value.chars().count() > max_len {
        bail!("{label} must not exceed {max_len} characters");
    }
    Ok(value.to_string())
}

fn optional_text(value: Option<String>, max_len: usize) -> anyhow::Result<Option<String>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.chars().count() > max_len {
        bail!("optional machine field must not exceed {max_len} characters");
    }
    Ok(Some(value.to_string()))
}
