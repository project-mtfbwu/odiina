# Private AI architecture

Increment I is an opt-in derived-data pipeline. Every account starts with the
master switch, transcription, insights, transcript Search and automatic
transcription off. Automatic transcription is prohibited by both schema and
RPC validation.

## Trust boundaries

- Browser mutations use same-origin Odiina routes, a verified server session
  and the existing CSRF token. No browser request accepts a user ID.
- Postgres derives ownership from `auth.uid()`, forces RLS on every AI table,
  and exposes only bounded security-definer RPCs with an empty search path.
- The human session can enqueue, inspect, cancel, retry, correct and delete only
  its own artifacts. It cannot write jobs or provider output directly.
- A generated non-human worker identity has no profile and must match an active
  generation record. Its function-owner role is `NOINHERIT` and `NOBYPASSRLS`.
- Worker storage reads are authorized only for the exact verified playback
  object held by a current lease. Logs contain job IDs, job kinds and safe
  codes, never Entry text, transcripts, tag queries or provider payloads.

## Transcription

Only accepted current-revision audio or a video with an audio track is
eligible. A request freezes attachment ID, object ID, SHA-256, media version and
duration. Transcript segments are bounded to the accepted duration and stored
with millisecond offsets. Corrections are append-only rows; machine output is
not rewritten. Search uses the latest correction only when separate transcript
Search consent is on.

The deterministic fake provider runs only against loopback and performs no
media download or network egress. Before a live provider can be enabled, the
worker must locally extract a bounded audio derivative from accepted video
playback, validate it, send audio only, and delete the temporary derivative.
No implementation may imply that selected audio or transcript segments amount
to continuous visual observation.

## Insights and citations

The preview RPC returns counts and approximate input size without provider
egress. Generation freezes at most 100 active current revisions in a bounded
JSON snapshot. Authored text, transcripts and place labels are independently
selectable; places default off. Provider output is schema- and size-validated.
Every citation must name a source ID from the snapshot before normalization to
an exact Entry and revision. Later edits mark dependent artifacts stale instead
of silently regenerating them.

Entry content is untrusted evidence, never instructions. The provider adapter
delimits evidence, the deterministic test provider neutralizes instruction-like
phrases, and database validation rejects unsupported citations.

## Cancellation, limits and deletion

The master switch cancels queued jobs and sets a cancellation request on active
leases. Workers re-check consent before persistence. Leases, heartbeats,
bounded retries and dead-letter states make work recoverable without duplicate
artifacts. Current limits are two active jobs, 1,200 transcription minutes per
month, ten insights per day and 100 per month.

Derived deletion removes segments, corrections, searchable transcript text and
normalized insight citations, leaving only non-content tombstones needed for
idempotency and audit. Original Entries and accepted media are unchanged.
Hosted backups may retain deleted rows until their separately configured backup
retention window expires; that policy is a deployment blocker, not silently
claimed as immediate erasure.

## Live-provider approval gate

No live provider is approved. Before changing the provider allowlist, record
the exact provider, region, model/version, audio and text retention, training
policy, subprocessors, deletion behavior, pricing, rate limits and outage
handling. Production also needs a durable worker runtime. Until both reviews
are complete, server routes fail closed and the UI states that nothing was
sent.
