PRAGMA foreign_keys = ON;

CREATE TABLE recipes (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    target_shelf_temp_c REAL,
    target_pressure_mbar REAL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE runs (
    id INTEGER PRIMARY KEY,
    recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
    recipe_name TEXT NOT NULL,
    batch_code TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'aborted', 'failed')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE samples (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    sampled_at TEXT NOT NULL,
    shelf_temp_c REAL NOT NULL,
    product_temp_c REAL NOT NULL,
    condenser_temp_c REAL NOT NULL,
    chamber_pressure_mbar REAL NOT NULL CHECK (chamber_pressure_mbar > 0),
    phase TEXT NOT NULL,
    raw_payload TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    run_id INTEGER REFERENCES runs(id) ON DELETE CASCADE,
    occurred_at TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'alarm', 'error')),
    message TEXT NOT NULL,
    raw_payload TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX idx_runs_started_at ON runs(started_at DESC);
CREATE INDEX idx_samples_run_time ON samples(run_id, sampled_at);
CREATE INDEX idx_events_run_time ON events(run_id, occurred_at);
