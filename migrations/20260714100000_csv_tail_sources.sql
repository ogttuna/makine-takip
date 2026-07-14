PRAGMA foreign_keys = ON;

CREATE TABLE csv_tail_sources (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL,
    directory_path TEXT NOT NULL,
    file_pattern TEXT NOT NULL DEFAULT '*.csv',
    scan_interval_ms INTEGER NOT NULL DEFAULT 30000 CHECK (scan_interval_ms BETWEEN 250 AND 60000),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    active_file_path TEXT,
    active_run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
    last_scan_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE csv_tail_checkpoints (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES csv_tail_sources(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
    byte_offset INTEGER NOT NULL DEFAULT 0 CHECK (byte_offset >= 0),
    last_source_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_source_sequence >= 0),
    header_line TEXT,
    file_size INTEGER NOT NULL DEFAULT 0 CHECK (file_size >= 0),
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    discovered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (source_id, file_path)
) STRICT;

CREATE INDEX idx_csv_tail_checkpoints_source_completed
    ON csv_tail_checkpoints(source_id, completed, updated_at);
