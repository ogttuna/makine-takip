PRAGMA foreign_keys = ON;

CREATE TABLE machines (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL COLLATE NOCASE,
    name TEXT NOT NULL,
    model TEXT,
    location TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'maintenance', 'inactive')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE UNIQUE INDEX idx_machines_code ON machines(code);
CREATE INDEX idx_machines_status_name ON machines(status, name);

INSERT INTO machines (code, name, model, location)
VALUES ('FD750-01', 'Makine 1', 'FD-750', NULL);

ALTER TABLE runs
    ADD COLUMN machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL;

ALTER TABLE import_files
    ADD COLUMN machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL;

ALTER TABLE csv_tail_sources
    ADD COLUMN machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL;

ALTER TABLE browser_tail_sources
    ADD COLUMN machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL;

ALTER TABLE browser_tail_sources
    ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1));

UPDATE runs
SET machine_id = (SELECT id FROM machines WHERE code = 'FD750-01')
WHERE machine_id IS NULL;

UPDATE import_files
SET machine_id = (
    SELECT r.machine_id
    FROM runs r
    WHERE r.id = import_files.run_id
)
WHERE machine_id IS NULL;

UPDATE csv_tail_sources
SET machine_id = (SELECT id FROM machines WHERE code = 'FD750-01')
WHERE machine_id IS NULL;

UPDATE browser_tail_sources
SET machine_id = (SELECT id FROM machines WHERE code = 'FD750-01')
WHERE machine_id IS NULL;

DROP INDEX idx_import_files_sha256;
CREATE UNIQUE INDEX idx_import_files_machine_sha256
    ON import_files(machine_id, file_sha256);

CREATE INDEX idx_runs_machine_started
    ON runs(machine_id, started_at DESC);
CREATE INDEX idx_browser_tail_sources_machine
    ON browser_tail_sources(machine_id, enabled, last_seen_at DESC);

PRAGMA foreign_key_check;
