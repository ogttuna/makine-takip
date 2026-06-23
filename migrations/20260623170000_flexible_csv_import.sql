PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS samples;
DROP TABLE IF EXISTS runs;
DROP TABLE IF EXISTS recipes;
DROP TABLE IF EXISTS settings;

CREATE TABLE runs (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('csv_import', 'csv_tail', 'replay', 'live', 'demo')),
    source_name TEXT,
    started_at TEXT,
    finished_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('imported', 'running', 'completed', 'aborted', 'failed')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE import_files (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_sha256 TEXT NOT NULL,
    row_count INTEGER NOT NULL CHECK (row_count >= 0),
    warning_count INTEGER NOT NULL CHECK (warning_count >= 0),
    error_count INTEGER NOT NULL CHECK (error_count >= 0),
    parser_version TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE channels (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL,
    display_name TEXT NOT NULL,
    unit TEXT,
    group_name TEXT,
    value_type TEXT NOT NULL DEFAULT 'number',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE sample_frames (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    sampled_at TEXT NOT NULL,
    source_timestamp_text TEXT NOT NULL,
    source_row_number INTEGER NOT NULL CHECK (source_row_number > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE measurements (
    id INTEGER PRIMARY KEY,
    frame_id INTEGER NOT NULL REFERENCES sample_frames(id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
    raw_text TEXT NOT NULL,
    numeric_value REAL,
    value_text TEXT,
    value_type TEXT NOT NULL DEFAULT 'number',
    quality TEXT NOT NULL CHECK (quality IN ('good', 'suspect', 'invalid')),
    quality_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE quality_events (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    frame_id INTEGER REFERENCES sample_frames(id) ON DELETE CASCADE,
    channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
    message TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE UNIQUE INDEX idx_import_files_sha256 ON import_files(file_sha256);
CREATE UNIQUE INDEX idx_channels_code ON channels(code);
CREATE UNIQUE INDEX idx_sample_frames_run_row ON sample_frames(run_id, source_row_number);
CREATE UNIQUE INDEX idx_measurements_frame_channel ON measurements(frame_id, channel_id);
CREATE INDEX idx_runs_started_at ON runs(started_at DESC);
CREATE INDEX idx_sample_frames_run_time ON sample_frames(run_id, sampled_at);
CREATE INDEX idx_quality_events_run ON quality_events(run_id, event_type);
