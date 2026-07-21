# Occurrence time and Calendar policy

Odiina keeps three distinct temporal facts:

- `entry_revisions.occurred_at` is the accepted instant when the event happened.
- `entries.created_at` is the server timestamp when the Entry identity was recorded.
- `entry_revisions.created_at` is the server timestamp when each immutable
  revision was accepted.

Every occurrence revision also freezes the IANA timezone, civil date and UTC
offset used to interpret that instant. A later preference change does not
rewrite any existing revision.

## User-selected local time

The composer defaults to the current date and minute in the saved IANA
timezone. A Calendar-selected day replaces only the civil date and retains the
current local time as a sensible default. The UI states that recording time
remains truthful.

Odiina converts a selected civil date and wall-clock minute without parsing a
bare `YYYY-MM-DD` value as JavaScript time. A nonexistent wall time inside a
daylight-saving gap is rejected. If a wall time occurs twice during a fall-back
transition, Odiina deterministically selects the earlier instant.

The same tuple is checked again by server validation and by PostgreSQL. The
database rejects invalid IANA names, date shifts and offset mismatches.
Changing occurrence date or time uses the concurrency-checked revision RPC
with `change_reason = 'occurrence_corrected'`.

## Calendar queries

Calendar URLs contain civil dates (`/calendar?date=YYYY-MM-DD`). Month activity
queries accept only a real first-of-month date and return active current
revision counts grouped by civil day. Selected-day queries are owner-scoped,
chronological and cursor-bounded. Trashed Entries are excluded; restoring an
Entry makes its activity visible again.

Existing Entries require no data rewrite because the certified foundation
already stores a validated occurrence tuple on every revision. Increment B
adds an index and queries over those current revisions only.
