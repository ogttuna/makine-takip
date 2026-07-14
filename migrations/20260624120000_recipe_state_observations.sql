PRAGMA foreign_keys = ON;

CREATE TABLE recipes (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE recipe_versions (
    id INTEGER PRIMARY KEY,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE recipe_states (
    id INTEGER PRIMARY KEY,
    recipe_version_id INTEGER NOT NULL REFERENCES recipe_versions(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    display_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    expected_duration_seconds INTEGER CHECK (expected_duration_seconds IS NULL OR expected_duration_seconds >= 0),
    external_code TEXT,
    external_aliases_json TEXT,
    transition_rule_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE recipe_channel_limits (
    id INTEGER PRIMARY KEY,
    recipe_state_id INTEGER NOT NULL REFERENCES recipe_states(id) ON DELETE CASCADE,
    channel_code TEXT NOT NULL,
    min_value REAL,
    max_value REAL,
    target_value REAL,
    warning_min REAL,
    warning_max REAL,
    alarm_min REAL,
    alarm_max REAL,
    unit TEXT,
    rule_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE run_recipe_assignments (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    recipe_version_id INTEGER NOT NULL REFERENCES recipe_versions(id) ON DELETE RESTRICT,
    role TEXT NOT NULL CHECK (role IN ('primary', 'candidate', 'comparison')),
    status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
    assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    notes TEXT
) STRICT;

CREATE TABLE run_state_observations (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    frame_id INTEGER REFERENCES sample_frames(id) ON DELETE CASCADE,
    sampled_at TEXT NOT NULL,
    source_sequence INTEGER NOT NULL CHECK (source_sequence > 0),
    source_recipe_code TEXT,
    source_recipe_version TEXT,
    source_state_code TEXT NOT NULL,
    source_state_name TEXT,
    source_payload_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE run_state_segments (
    id INTEGER PRIMARY KEY,
    run_recipe_assignment_id INTEGER NOT NULL REFERENCES run_recipe_assignments(id) ON DELETE CASCADE,
    recipe_state_id INTEGER REFERENCES recipe_states(id) ON DELETE SET NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    source TEXT NOT NULL CHECK (source IN ('machine', 'operator', 'inferred', 'replay')),
    confidence REAL CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE UNIQUE INDEX idx_recipe_versions_recipe_version ON recipe_versions(recipe_id, version);
CREATE UNIQUE INDEX idx_recipe_states_version_code ON recipe_states(recipe_version_id, code);
CREATE UNIQUE INDEX idx_recipe_channel_limits_state_channel ON recipe_channel_limits(recipe_state_id, channel_code);
CREATE UNIQUE INDEX idx_run_recipe_assignments_primary ON run_recipe_assignments(run_id, role) WHERE role = 'primary' AND status = 'active';
CREATE INDEX idx_run_recipe_assignments_run ON run_recipe_assignments(run_id, status);
CREATE INDEX idx_run_state_observations_run_time ON run_state_observations(run_id, sampled_at);
CREATE INDEX idx_run_state_observations_run_sequence ON run_state_observations(run_id, source_sequence);
CREATE INDEX idx_run_state_segments_assignment_time ON run_state_segments(run_recipe_assignment_id, started_at);
