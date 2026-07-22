# Increment H — private tags, search and filtered recall

Increment H answers “Can I find something I logged before?” with private,
indexed, current-snapshot recall. It adds tags to composition and immutable
editing, activates `/search`, and integrates current tags with Feed, detail,
revision history, Calendar cards, Trash, and the optional Profile `Tagged
Entries` statistic.

## User-visible behavior

The existing plus menu opens an accessible tag picker without submitting the
Entry or starting an upload. Users can create or reuse only their own tags,
remove one, clear all, and see the `x/10` limit. Suggestions are debounced,
abort stale requests, remain private, and support keyboard operation. Selected
tags survive text/media/place draft changes. Saving a tag edit creates a new
immutable revision and preserves the older tag snapshot.

Search restores its query, dates, selected tags, media types, place condition,
Trash scope, sort, and cursor from validated URL parameters. URLs contain no
Entry body. Tags match all selected values; media types match any. Search
results use Feed cards with current tags, accepted media indicators, confirmed
place, occurrence time, edited/recorded-later truth, and an explicit Trash
badge. Trash and restore reconcile successful results immediately and refresh
from authoritative server data on the next URL transition.

The route provides initial, invalid-filter, no-result, loading, error, result,
loading-more, and end states. Result counts use a polite status announcement.
Forms, filters, chips, dialogs, removal controls, and sort controls use native
semantics or React Aria primitives, visible focus, touch-sized controls, and
the existing reduced-motion/reflow rules. Certified widths are 320, 390, 768,
960, 1200, and 1440 pixels.

## Database and security delivery

Migration `202607260001_private_tags_search.sql` installs `pg_trgm` in the
existing extensions schema and adds `user_tags`, `entry_revision_tags`, and
`entry_search_documents`, all with RLS and FORCE RLS. Exact composite foreign
keys protect ownership and current-revision integrity. Account deletion may
cascade the user's private tag catalog, while normal application roles cannot
update or delete immutable revision memberships.

Tagged creation/activation/revision wrappers preserve the certified command
receipts, stale-revision protection, media/place snapshots, and auth-derived
ownership. `revision_tags`, `tag_suggestions`, and `search_entries` are the only
new authenticated read boundaries. Internal refresh/normalization helpers are
not browser-invokable. Every private function has a fixed empty search path;
`PUBLIC` and `anon` grants are revoked; no service-role credential enters
browser or application code.

There are no new environment variables. Search does not require OpenAI, a
third-party index, geocoding, analytics, OCR, transcription, embeddings, or a
vector database.

## Certification and fixtures

The pgTAP suite adds normalization, per-user uniqueness/isolation, immutable
history, stale safety, current-only text, Trash/restore, place redaction,
media/date/tag filters, cursors, grants, and account-lifecycle coverage. Unit
tests cover shared Unicode normalization, limits, tags-only rejection,
validated URL state, default sorting, and filter-bound cursors. Playwright adds
the six-width Search/axe matrix and production-mode authenticated desktop and
mobile journeys through create, exact multi-tag recall, revise/history,
Trash/include/restore, logout, and protected access.

Performance fixtures are synthetic (`perf-owner@example.test` and
`perf-isolated@example.test`), rollback-only, and contain no personal content.
See [private-tags-search.md](../architecture/private-tags-search.md) for exact
index, pagination, privacy, and measured-plan details.

Future Increment I may propose transcripts or semantic interpretation only as
a separate consented capability. It must cite accepted media versions and
evidence spans, distinguish sampled evidence from continuous observation, and
must not silently add unavailable media contents to ordinary Increment H
search.

## Certification record — 2026-07-22

- `corepack pnpm check`: passed formatting, ESLint with zero warnings,
  TypeScript, 18 test files/119 tests, the Next.js production build, and the
  42-file built-client credential scan.
- `corepack pnpm audit --audit-level moderate`: no known vulnerabilities.
- Fresh local reset: all nine migrations applied. PostgreSQL 17.6, `pg_trgm`
  1.6; `unaccent` remains intentionally uninstalled.
- pgTAP/RLS: 8 files, 262 assertions, all passed.
- Search performance: passed the rollback-only fixture and plan assertions
  documented in the architecture note.
- ClamAV: health, clean, EICAR, and unavailable cases passed. Audio processor
  certification passed all accepted/rejected/unavailable cases. Video passed
  7, failed 0, skipped 0 synthetic fixtures. The constrained worker was
  re-registered after reset and remained stable.
- Production Playwright used Chromium 149.0.7827.55. Search setup, six widths,
  and desktop/mobile journeys passed 9/9 (zero failures and zero skips). Each
  journey creates real accepted image, voice, and video media plus a confirmed
  place, proves individual and combined media filters, place text/condition,
  occurrence-date filtering, 20+1 cursor pagination without duplicates, tag
  revision history, Trash/include/restore, logout, and protected access. The
  final matrix used the production `next start` server, one worker, desktop
  1440Ã—1000, mobile Chromium emulation at 390Ã—844, and axe at 320, 390, 768,
  960, 1200, and 1440 pixels. It also caught and fixed a real client-state bug
  where the active cursor was omitted from the Search results component key.
  Public login/reflow/axe passed 18/18; Profile setup plus four widths passed
  5/5; isolated first-login desktop and mobile passed 1/1 each; isolated
  Calendar desktop and mobile passed 1/1 each.
- In the broad regression invocation, 73 tests passed before 14 suite-state
  failures exposed a missing public-project `@profile` exclusion, the former
  eight-stat expectation, and four invalid shared first-login preconditions.
  The first two test defects were corrected, and every affected project passed
  in the isolated runs above. The first-login projects remain intentionally
  separate because their onboarding guarantee requires a fresh user state.
- Visual artifacts were inspected at 390×844 and 1440×1000. Automated axe
  checks passed at every Search width. Physical-device iOS/Android,
  screen-reader, and assistive-technology manual review remain release gates,
  not claimed passes.
- Source and built output contained no key/credential pattern or private
  non-synthetic Entry fixture. Search-query logging candidates: zero.
