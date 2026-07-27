PRAGMA foreign_keys = ON;

CREATE TABLE analysis_profiles (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL,
    version TEXT NOT NULL,
    machine_model TEXT NOT NULL,
    config_json TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (code, version)
) STRICT;

INSERT INTO analysis_profiles (
    code,
    version,
    machine_model,
    config_json,
    active
)
VALUES (
    'fd750_loop',
    '1.0.0',
    'FD-750',
    '{
        "shelf_off_value": 850.0,
        "shelf_off_tolerance": 0.5,
        "start_vacuum_upper": 2.0,
        "stop_vacuum_lower": 4.0,
        "defrost_start_temperature_c": 0.0,
        "defrost_stop_power_upper": 5.0,
        "state_reset_gap_minutes": 180.0,
        "parallel_window_minutes": 30.0,
        "parallel_window_tolerance_minutes": 10.0,
        "minimum_s4_s2_change_c": 3.0,
        "minimum_vacuum_change": 0.2,
        "maximum_energy_gap_minutes": 15.0
    }',
    1
);

CREATE TABLE process_cycles (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    analysis_profile_id INTEGER NOT NULL REFERENCES analysis_profiles(id) ON DELETE RESTRICT,
    loop_number INTEGER NOT NULL CHECK (loop_number > 0),
    started_at TEXT NOT NULL,
    dry_started_at TEXT,
    stopped_at TEXT,
    wait_started_at TEXT,
    defrost_started_at TEXT,
    defrost_stopped_at TEXT,
    finished_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'interrupted', 'incomplete')),
    confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    start_frame_id INTEGER REFERENCES sample_frames(id) ON DELETE SET NULL,
    end_frame_id INTEGER REFERENCES sample_frames(id) ON DELETE SET NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (run_id, analysis_profile_id, loop_number)
) STRICT;

CREATE TABLE process_state_segments (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    analysis_profile_id INTEGER NOT NULL REFERENCES analysis_profiles(id) ON DELETE RESTRICT,
    process_cycle_id INTEGER REFERENCES process_cycles(id) ON DELETE CASCADE,
    state_code TEXT NOT NULL CHECK (
        state_code IN ('START', 'DRY', 'STOP', 'WAIT', 'DEFROST', 'DEFROST_STOP')
    ),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    start_frame_id INTEGER REFERENCES sample_frames(id) ON DELETE SET NULL,
    end_frame_id INTEGER REFERENCES sample_frames(id) ON DELETE SET NULL,
    confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE diagnostic_events (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    analysis_profile_id INTEGER NOT NULL REFERENCES analysis_profiles(id) ON DELETE RESTRICT,
    process_cycle_id INTEGER REFERENCES process_cycles(id) ON DELETE CASCADE,
    frame_id INTEGER REFERENCES sample_frames(id) ON DELETE CASCADE,
    occurred_at TEXT NOT NULL,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning')),
    message TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (run_id, analysis_profile_id, frame_id, event_type)
) STRICT;

CREATE TABLE derived_measurements (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    analysis_profile_id INTEGER NOT NULL REFERENCES analysis_profiles(id) ON DELETE RESTRICT,
    frame_id INTEGER NOT NULL REFERENCES sample_frames(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    numeric_value REAL NOT NULL,
    unit TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (analysis_profile_id, frame_id, code)
) STRICT;

CREATE INDEX idx_process_cycles_run_start
    ON process_cycles(run_id, started_at);
CREATE INDEX idx_process_state_segments_run_start
    ON process_state_segments(run_id, started_at);
CREATE INDEX idx_diagnostic_events_run_time
    ON diagnostic_events(run_id, occurred_at);
CREATE INDEX idx_derived_measurements_run_code_time
    ON derived_measurements(run_id, code, frame_id);
