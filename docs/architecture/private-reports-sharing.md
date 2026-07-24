# Private reports and controlled sharing

## Boundary and data model

Reports are curated derived artifacts, separate from immutable Entries and
from Increment I insights. `reports` owns the civil scope and presentation
state. `report_sources` freezes exact Entry/revision evidence and a bounded
excerpt. `report_metrics` and `report_sections` are typed rows, not an
uncontrolled JSON document. `report_media_selections` points only at accepted
current source media. Exports, disabled schedule intent, command receipts,
shares and immutable share sections have separate tables.

Every private table uses RLS and FORCE RLS. Ownership is always derived from
the request JWT; no RPC accepts a user ID. Definer functions have a fixed empty
search path and constrained owners without `BYPASSRLS`. `PUBLIC` and `anon`
cannot call private report mutations.

## Factual engine and metrics

Factual creation does not inspect AI settings and makes no provider request.
The following metrics are counts over selected active current revisions in the
frozen civil scope:

- `entries`: distinct included Entries.
- `active_days`: distinct `occurred_local_date` values.
- `text_entries`: Entries with non-empty current text.
- `photo_entries`, `voice_entries`, `video_entries`: Entries with at least one
  accepted selected attachment of that kind.
- `voice_duration_ms`, `video_duration_ms`: accepted playback-duration totals
  from the typed scanner-produced metadata rows.
- `place_entries`: Entries with a current non-redacted confirmed place.
- `tagged_entries`: Entries with at least one immutable current-revision tag.
- `edited_entries`: source revisions beyond version one.

No streak, mood, personality, health, “best day,” productivity or engagement
score is inferred.

## Civil periods

Daily is one occurrence date. Weekly starts on the saved per-user week start
and spans seven civil dates. Monthly and yearly use calendar boundaries;
custom spans at most 367 inclusive dates. The report freezes the current IANA
timezone and week-start preference at generation. Generation time and later
media processing never move an Entry into another occurrence period. A later
timezone preference change affects new reports only.

## Story and curation

The fixed accessible reading model is Cover, At a glance, Timeline, Key
moments, Photos, Voice, Video, Places, Tags and Reflection. Users can reorder
the ten sections with keyboard-operable Move controls, hide sections, edit
authored text and select sources/media. Accepted image/display, audio/playback,
video/playback and poster routes remain authenticated. There is no autoplay.
Original, quarantine and rejected objects are never presented.

An optional matching ready Increment I insight can supply a clearly labeled AI
section. Regeneration never overwrites authored fields. Evidence remains with
the insight and private source links; public snapshots contain report-local
text only and no internal citation identifiers.

## Export strategy

Authenticated Markdown is generated synchronously under a bounded request and
omits media, coordinates, paths and internal IDs. Print-friendly HTML uses the
browser print dialog, removes players and describes the omission. The current
runtime has no reviewed Unicode-capable tagged-PDF renderer, so Odiina does not
claim a PDF artifact or PDF accessibility conformance. Downloaded files cannot
be recalled after redaction.

## Sharing threat model

Every report is private until a separate review and confirmation. Publishing
creates an immutable text snapshot with a 256-bit random opaque token; only its
SHA-256 digest is stored. The link is shown once. Token resolution is the only
anonymous database capability, has generic invalid handling, and returns only
active curated text or the minimal `expired`/`revoked` state. Links use
`noindex`, `no-store` and `no-referrer`; the viewer has no private navigation,
tracking, comments or discovery.

Places are off by default, coordinates are never stored in report/share
tables, and redaction revokes place-bearing shares. Trash revokes any dependent
share. Private edits do not mutate a published snapshot. Viewers can still
copy, save or screenshot content; revocation is prospective, not DRM.

Anonymous media is intentionally disabled. There is no reviewed signer that
can bind safe derivatives, range requests and every access to the exact active
manifest. Private buckets remain private. Enabling media without that boundary
would be a security regression.

The token endpoint has a bounded in-process limiter for local/single-instance
testing. A distributed privacy-safe limiter is required before public beta. It
must not log tokens, report text, viewer identity, exact location or tracking
identifiers. Production reverse proxies, CDNs, tracing systems and error
reporters must redact the `/s/[token]` path segment before recording request
URLs; the opaque token is a bearer secret even though only its digest is kept
in the database.

## Schedules, quotas and deployment gates

Schedule intent is optional and defaults paused with execution disabled. No
timer runs. Production scheduling requires a durable DST-safe executor,
idempotent period uniqueness, consent/quota rechecks and a missed-run policy.
Factual reports are capped at 200 sources and 20 selected media items and use no
AI quota. AI limits remain Increment I limits.

Release blockers are: a distributed public rate limiter, reviewed public-media
authorization, a durable scheduler, a production AI provider/worker approval,
a safe tagged-PDF renderer, and finalized hosted backup retention. None is
represented as implemented.
