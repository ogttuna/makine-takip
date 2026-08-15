PRAGMA foreign_keys = ON;

CREATE TABLE browser_tail_sources (
    source_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    active_file_name TEXT,
    active_run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
    last_seen_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE browser_tail_files (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES browser_tail_sources(source_id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
    header_line TEXT NOT NULL,
    byte_offset INTEGER NOT NULL CHECK (byte_offset >= 0),
    last_source_sequence INTEGER NOT NULL DEFAULT 1 CHECK (last_source_sequence >= 1),
    file_size INTEGER NOT NULL DEFAULT 0 CHECK (file_size >= 0),
    last_modified_ms INTEGER NOT NULL DEFAULT 0 CHECK (last_modified_ms >= 0),
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    discovered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (source_id, file_name)
) STRICT;

CREATE INDEX idx_browser_tail_files_source_completed
    ON browser_tail_files(source_id, completed, updated_at);
