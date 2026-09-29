# Factory read-only telemetry contract v1

Factory reads `GET /api/integration/v1/machines` and
`GET /api/integration/v1/machines/{id}/readings` with `X-Monitoring-Key`.
Configure `FREEZEDRY_INTEGRATION_TOKEN` with at least 24 characters. Without it the
integration returns 503; missing/incorrect credentials return 401. There are no
write routes in this group. Existing collection, import and desktop APIs remain intact.

Readings parameters:

- `from`, `to`: explicit RFC3339 instants, increasing, at most 366 days.
- `limit`: distinct timestamps per page, 1–5000 (default 1000).
- `snapshotFrameId`: ingestion high-water mark from the first response.
- `after`: previous `nextCursor`; a snapshot is required when continuing.

Responses use `contractVersion: machine-monitoring-v1`, UTC `recordedAt`, dynamic
channel descriptions, selected values with their original frame/run/timestamp
provenance, and duplicate/conflict/quality-difference flags. Bounds are inclusive
lower / exclusive upper. Sub-millisecond work boundaries are preserved when
comparing millisecond source samples. A recording run/file is not a physical
production work cycle; queries span every recording run for the physical machine.

Stored naive CSV clocks are Istanbul wall time (UTC+03 for the available history).
RFC3339 source timestamps were normalized to UTC by ingestion before their offset
was removed from `sampled_at`; retained source timestamp text distinguishes them.
The reader normalizes these cases without rewriting source records. Adapters should
retain an original timestamp matching the timestamp supplied to ingestion.

For the same timestamp/channel, the latest ingested frame wins deterministically.
The response flags disagreeing values and quality labels; it does not discard raw
database copies or use mutable recording heartbeat times to choose a winner.
Pagination pins all selected frames to the first page's high-water mark so late
imports cannot shift subsequent pages. Factory additionally hashes selected data
to reject export of a stale graph if a record is corrected in place.

FD750-01 keeps the existing known channel units. FD25 pressure scale could not be
confirmed by the operator: H_PRES/L_PRES have `unit: null`, retain their exact raw
numbers, and Factory displays an explicit unverified-unit warning. No guessed
bar/kPa conversion is applied. Dynamic RAF channels (including RAF5–7) are shelf
targets; S channels are measured temperatures. Unknown channels have no inferred unit.
This contract does not change the older standalone dashboard's channel labels.

Tests: `cargo test -p collector --locked` and
`cargo clippy -p collector --all-targets --locked -- -D warnings`.
The dedicated integration tests cover mixed clocks, boundaries, duplicates,
contradictory qualities/values, late imports, pinned paging, long windows, invalid
requests, authentication, and unverified channel metadata.

The 2026-09-29 implementation is deployed only to an isolated test copy. Do not
replace the production image, share its writable SQLite volume, enable live CSV
watchers in test, or change production routing without the owner's explicit approval.
