PRAGMA foreign_keys = OFF;

CREATE TABLE runs_new (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_name TEXT,
    started_at TEXT,
    finished_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('imported', 'running', 'completed', 'aborted', 'failed')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

INSERT INTO runs_new (
    id,
    name,
    source_kind,
    source_name,
    started_at,
    finished_at,
    status,
    notes,
    created_at
)
SELECT
    id,
    name,
    source_kind,
    source_name,
    started_at,
    finished_at,
    status,
    notes,
    created_at
FROM runs;

DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;

CREATE INDEX idx_runs_started_at ON runs(started_at DESC);

PRAGMA foreign_key_check;
PRAGMA foreign_keys = ON;
