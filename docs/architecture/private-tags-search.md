# Private tags and search architecture

Increment H adds owner-created labels and indexed recall over the authenticated
user's current Entry snapshots. It is ordinary PostgreSQL search, not AI
search. `/search` is protected, dynamically rendered, marked `noindex`, and all
private reads use `no-store` request behavior inherited from the authenticated
application shell.

Increment I extends this same owner-scoped current-snapshot index with optional
transcript text. The projection is populated only while explicit transcript
Search consent is on, prefers the latest append-only correction, excludes stale
or trashed source revisions, and is cleared on consent revocation or derived
deletion. Search results may state “Matched transcript”; existing media, date,
tag, place, Trash and cursor behavior is unchanged.

## Tag identity and immutable evidence

`app.user_tags` is a forced-RLS, per-user catalog. Display labels are Unicode
NFKC-normalized, trimmed, and have internal whitespace collapsed. Comparison
values are lowercased after the same normalization. Labels contain 1–40 Unicode
characters, may use international scripts or be emoji-only, and may not contain
control characters. A `(user_id, normalized_name)` unique constraint makes
case- and compatibility-equivalent reuse race safe without creating a global
tag namespace.

Each revision stores zero to ten ordered memberships in
`app.entry_revision_tags`. Exact composite foreign keys bind owner, Entry,
revision, and catalog tag. Normal editing appends a revision and never changes
older memberships. The first accepted clean capitalization remains the catalog
display form; global rename and destructive catalog cleanup are deferred.
Unused catalog tags may remain as private suggestions because immutable history
can still reference them.

Tags classify content. They do not make a tags-only Entry valid. Text, an
accepted photo/voice/video draft, or a confirmed place must also be present.

## Current search document

`app.entry_search_documents` contains one derived row per current Entry
revision. It stores only the current body, non-redacted current place name and
area/address, current tags, occurrence facts, lifecycle state, and trusted
accepted-media booleans. Transactional triggers refresh the row after current
revision changes, Trash/restore, place redaction, revision tag changes, and
accepted attachment-state changes. Migration backfill reads existing current
revisions and invents no tags.

The document deliberately excludes historical text/tags, raw filenames,
object keys, coordinates, provider IDs, EXIF, quarantined/rejected media,
media contents, transcripts, OCR, and AI meaning. Stored place search never
calls a geocoding provider. Future transcript indexing requires a separate
schema and explicit product/privacy approval; semantic/AI search additionally
requires explicit consent and must not reuse this index silently.

The search vector uses PostgreSQL's `simple` configuration so user-created and
multilingual tokens are not passed through an English stemmer. Weights are:

- exact normalized tag match: `4.0` bonus;
- tag vector: weight A;
- Entry body: weight B;
- place name: weight C;
- place area/address: weight D;
- normalized trigram similarity: a secondary additive score.

GIN indexes cover the `tsvector`, normalized trigram document, and normalized
tag array. Composite B-tree indexes cover owner/lifecycle occurrence ordering
and civil-date filtering. PostgreSQL remains free to choose the cheaper
owner-key scan for a small tenant; certification records the actual plan rather
than forcing an index.

## Query and filter contract

`app.search_entries` is a bounded, fixed-empty-search-path `SECURITY DEFINER`
RPC owned by the constrained `odiina_owner_api` role. It derives ownership from
the verified JWT claim, accepts no user ID or dynamic SQL, and is executable by
`authenticated` only—not `PUBLIC` or `anon`. Query length is 2–200 characters
when present, tag count is at most 10, media count at most 5, and page size is
1–50 (the application requests 20). Raw database errors are mapped to safe
messages and query contents are not logged or sent to analytics, AI, or third
parties.

Multiple tags use AND. Multiple media types use OR. `text`, `image`, `audio`,
`video`, and `place` describe current trusted relationships, never inferred
contents. `has place` is a separate current non-redacted-place condition. Date
ranges compare `occurred_local_date`, preserving Increment B's civil-date and
DST policy instead of parsing dates as browser UTC instants.

Text queries default to relevance; filter-only recall defaults to newest
occurrence. Users may choose relevance, newest occurrence, or oldest
occurrence. Ties use occurrence time and stable Entry UUID. Default scope is
active only. `Include Trash` is explicit, and returned trashed cards are labeled
and use the existing authorized restore operation.

The opaque application cursor contains rank where relevant, occurrence time,
and Entry UUID. It is signed to the normalized query/filter scope, rejected
when malformed or reused with different filters, and never carries identity or
private result text. Search hydration is bounded to one result RPC plus three
batched revision RPCs for media, place, and tags—never one authorization query
per card.

## Measured development profile

`scripts/certify-search-performance.sql` creates synthetic rows inside a
transaction and always rolls back. The July 2026 certification used PostgreSQL
17.6 with 1,000 owner Entries, 1,200 immutable revisions, 2,001 tag
memberships, 111 accepted media relationships, 100 places, 50 trashed Entries,
and 100 same-keyword Entries for an isolated second owner.

After `ANALYZE`, the owner-scoped selective text and tag plans used the
owner/current primary-key path and completed in 0.326 ms and 0.232 ms. At this
dataset size PostgreSQL correctly estimated that scanning 1,000 already
owner-bounded rows was cheaper than starting from the global GIN indexes. The
civil-date plan used `entry_search_documents_local_date_idx` as an index-only
scan and completed in 0.109 ms. The actual relevance RPC returned two stable,
non-overlapping 20-row pages; the first serialized row payload was 8,955 bytes.
Tag suggestions returned their 12-row bound. No cross-owner row was returned.
These local timings are evidence of bounded behavior, not a production SLO.
