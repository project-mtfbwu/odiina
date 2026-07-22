# Increment G — private place attachment and location picker

Increment G adds optional, private place context to the composer and Entry
editor. An Entry may contain text, media, a place, or a valid combination. The
current place appears in Feed, Calendar recall, detail, Trash and owner-only
Profile statistics; each historical snapshot appears in revision history.

Manual entry always works. The current-location control uses one explicit
one-time browser request after an explanatory step. Permission denial,
unavailable positions, timeouts and insecure/unsupported environments leave
manual entry usable. Browser provider search, nearby results, reverse
geocoding and maps are honestly unavailable because this repository has no
approved provider configuration.

Privacy choices are label-only, approximate (client-reduced to a 0.025° grid
and described as about 3 km), and exact (separately confirmed). Server
validation and database constraints enforce the same policy. The normal edit
path creates an immutable revision and never silently erases history. An
explicit all-history redaction RPC clears place data from every revision for
the authenticated owner.

The migration adds `app.entry_revision_places` plus narrowly authorized
`create_entry_place`, `activate_media_entry_place`, `revise_entry_place`,
`revision_places`, and `redact_entry_places` functions. They accept no user ID,
derive ownership from `auth.uid()`, use fixed empty search paths, and are not
invokable by `PUBLIC` or `anon`.

Before enabling provider-backed discovery, complete and document a provider
privacy/security review and add only the required CSP and restricted server
credentials. Do not put provider secrets or service-role credentials in the
browser.

## Product and integration definitions

Place describes where an Entry occurred. It never replaces occurrence time or
`created_at`, and selecting a device coordinate does not change either value.
Feed, detail, Calendar recall and Trash render the current private textual
snapshot; revision history renders each authorized historical snapshot. The
Profile `Place Entries` statistic counts active, non-trashed Entries whose
current revision has a non-redacted place, once per Entry.

There is no background tracking, location history, geofencing, map, public
place API or sharing. Increment G does not inspect photo/video EXIF, infer a
place with AI, or send stored coordinates to an external service. Manual entry
continues to work offline; device lookup requires a secure browser context
(localhost is accepted by browsers for local development) and degrades to
specific permission, timeout, unavailable or unsupported states.

## Provider and production gates

`ODIINA_FEATURE_PLACES=true` enables the implemented manual and device flows.
No provider environment variable is accepted in Increment G, and no provider
domain was added to CSP. Production must use HTTPS for geolocation. Search,
reverse geocoding and nearby venues remain disabled rather than silently using
a public service.

A future provider implementation requires an approved privacy, terms,
retention, residency, attribution and credential-exposure review. Its server
abstraction must add authenticated per-user rate limits, a sensible minimum
query length, debouncing, stale-request cancellation, bounded timeouts and
result counts, response validation, safe errors, `no-store` behavior where
appropriate, and only the required CSP domains. Provider attribution must be
shown exactly as its approved terms require. None of these unimplemented
controls is represented by a fake search box or dormant production secret.

Physical-device certification remains a release gate. Increment G has been
certified with Playwright's deterministic browser geolocation only; it has not
been certified as real GPS. Before public release, test iOS Safari and Android
Chrome permission variants, precise/approximate OS settings, denial recovery,
GPS-disabled and poor-accuracy states, background/tab restoration, offline
manual entry, keyboard/safe-area reflow, and shared-device logout privacy.
