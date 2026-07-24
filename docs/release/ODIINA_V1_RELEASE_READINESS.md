# Odiina V1 release-readiness record

## Certification scope and verdict

This record covers the integrated local application from Increment A through
Increment K at certified base commit
`44f91707218c23929ca5c67a969921c973591e20`. It is a local release-candidate
certification using synthetic fixtures and loopback services, not permission to
deploy or a claim that the public-production gates below are complete.

Increment J is independently present at `63d2222` and delivers factual reports,
stories, Markdown/print export, and controlled text-only sharing. Increment K's
report retrieval support is an integration consumer, not a substitute for J.

The integrated local release candidate has no known code blocker for a
controlled closed beta with provider-backed functionality kept disabled. The
physical-device and human-assistive-technology checks remain beta gates. A live
AI/transcription provider must remain disabled until it is separately approved
and certified.

## Certified increment map

| Increment | Capability                                      | Commit                                       |
| --------- | ----------------------------------------------- | -------------------------------------------- |
| A         | Product shell, Feed and immutable Entries       | `fd7d6df`; certification follow-up `27c7081` |
| B         | Calendar and occurrence time                    | `8f5a3ed`                                    |
| C         | Private Profile                                 | `fa98f7c`                                    |
| D         | Photos and camera                               | `05948dc`                                    |
| E         | Voice                                           | `1f22757`                                    |
| F         | Video                                           | `637bd25`; evidence follow-up `706c6f3`      |
| G         | Place                                           | `5eb4a47`                                    |
| H         | Tags and indexed Search                         | `aca382b`; certification follow-up `2bf2ebc` |
| H.1       | Bear-style nested tag collections               | `818e986`                                    |
| I         | Consent-based transcription and private insight | `25428ba`                                    |
| J         | Reports, stories, export and controlled sharing | `63d2222`                                    |
| K         | Evidence-backed Odiina Chat                     | `44f9170`                                    |

## Evidence ledger

| Gate                                | Command/evidence                                                                  | Result                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Base tree and history               | `git status --short --branch`; `git log --oneline --reverse`                      | Base clean; A-K history and separate J confirmed                                          |
| Prettier                            | `corepack pnpm format:check`                                                      | Pass                                                                                      |
| ESLint                              | `corepack pnpm lint`                                                              | Pass; zero warnings                                                                       |
| TypeScript                          | `corepack pnpm typecheck`                                                         | Pass                                                                                      |
| Vitest                              | `corepack pnpm test`                                                              | 24 files, 164 tests passed; 0 failed, 0 skipped                                           |
| Production build                    | `corepack pnpm build`                                                             | Pass; Next.js 16.2.11, 29 static routes/pages generated                                   |
| Dependency audit                    | `corepack pnpm audit --audit-level moderate`                                      | Pass; zero known vulnerabilities                                                          |
| Client/source/private-fixture scans | committed scanner plus release source scans                                       | Pass: 49 built-client, 294 source/config and 169 production files; zero hits              |
| Fresh migrations                    | `corepack pnpm supabase:reset`                                                    | Pass; 14 migrations applied in order from zero                                            |
| pgTAP/RLS                           | `corepack pnpm test:db`                                                           | 12 files, 409 assertions passed                                                           |
| ClamAV                              | `corepack pnpm test:scanner`                                                      | Pass: health, clean, EICAR and unavailable/fail-closed cases                              |
| Image/photo                         | Vitest image contracts plus authenticated production browser projects             | Pass                                                                                      |
| Audio processor                     | `corepack pnpm test:audio`                                                        | Pass: processor, WebM/Opus, unknown-length WebM, Ogg, M4A, metadata, waveform and rejects |
| Video processor                     | `corepack pnpm test:video`                                                        | 7 passed, 0 failed, 0 skipped                                                             |
| Media worker                        | restricted worker plus production browser media journeys                          | Pass with publishable key and dedicated worker identity; no service role at runtime       |
| AI worker/provider contracts        | fake-provider unit, database and production browser journeys                      | Pass with loopback-only fake provider; no live-provider claim                             |
| Search performance                  | `scripts/certify-search-performance.sql`                                          | Pass with 1,000 synthetic Entries; measurements below                                     |
| Full production Playwright          | `corepack pnpm exec playwright test --workers=1` with release environment         | 115 passed, 0 failed, 0 skipped                                                           |
| Cross-feature journey               | serial authenticated production campaign over one isolated shared journey account | Pass; coverage mapping below                                                              |
| Responsive/axe                      | 320, 390, 768, 960, 1200 and 1440 px projects                                     | Pass; axe enabled, no automated violations                                                |

The authoritative Playwright run used Chromium 149.0.7827.55 against `next
start`, not the development server. It ran every configured project with one
worker and the upload, place, AI, report, sharing and Chat feature flags enabled.
The AI provider was the deterministic loopback-only fake. The campaign created
45 synthetic screenshots under `test-results/evidence`.

## Integrated journey coverage

The production campaign intentionally uses isolated accounts for the two
login/onboarding journeys and one shared `journey@example.test` storage state
for the dependent A-K projects. With one worker, that shared account exercises
the V1 system serially instead of mocking feature boundaries:

- Login, onboarding, text/photo capture, Profile media, edit/history,
  Trash/restore, logout and protected-route denial are covered by the desktop
  and mobile authenticated journeys.
- Calendar, photo/camera, voice, video, place/redaction, tag collections and
  indexed Search projects create and revise real owner-scoped records. The
  projects verify occurrence placement, Profile statistics, current counts,
  Trash/restore propagation and immutable history.
- AI Settings start off. The AI provider journey enables the master switch and
  narrow consent, processes synthetic transcription and insight work, verifies
  transcript Search and exact owner Entry citations, then covers consent and
  derived-data deletion boundaries. Database tests cover disabling consent
  during leased work and prove egress/persistence is rejected.
- Report projects create factual and AI-enhanced recaps, curate a story, export
  it, resolve an expiring hashed share token, revoke it and verify anonymous
  isolation. Chat asks about known current evidence, checks citations and a
  follow-up, then covers reset, export, temporary/saved conversion and deletion.
- Logout tests clear browser-visible private state and a fresh unauthenticated
  context is denied access to protected routes.

This is one optimized production campaign and one shared authenticated product
state, while retaining smaller test cases so failures remain diagnosable.

## Database and security findings

The zero-state reset applied all 14 immutable migrations. The final catalog
audit found:

- 0 application tables without both RLS and `FORCE ROW LEVEL SECURITY`.
- 0 security-definer functions owned by a `BYPASSRLS` role.
- 0 security-definer functions without a fixed empty `search_path`.
- 0 application-table grants to `PUBLIC` or `anon`.
- 0 unintended private function grants to `PUBLIC` or `anon`; the documented
  anonymous boundary is `resolve_report_share` only.
- `PUBLIC` cannot execute `app.claim_ai_job(integer)`; `authenticated` can
  reach the function, whose body admits only the registered AI worker identity.

Authentication callback/refresh/logout behavior, protected access, HttpOnly
session cookies, same-origin CSRF/Origin/Host enforcement, redirect validation,
safe errors and bounded local rate limits passed unit/database/browser coverage.
Upload authorization, immutable quarantine originals, accepted-derivative
delivery and owner-authorized video ranges passed. Share tokens are random,
stored hashed, expiry/revocation checked, text-only, isolated from private
tables and delivered with no-store/no-referrer controls.

AI consent and the master switch are rechecked before provider egress and
persistence. Evidence is treated as untrusted data, provider output citations
are validated against the frozen owner-scoped packet, and Search/Chat
cross-owner isolation is covered by pgTAP. Temporary Chats expire and logout
does not expose private cached state. Source and built-output scans found no
service-role key, provider key, worker credential, database password or private
Entry fixture. Security headers include a CSP and the application does not put
Supabase sessions in browser JavaScript.

## Performance and resource findings

The synthetic Search certification inserted 1,000 current documents plus tag,
transcript and Trash fixtures inside a rolled-back transaction. PostgreSQL
reported:

| Query                        | Execution time | Result bound          |
| ---------------------------- | -------------- | --------------------- |
| Text Search plan             | 0.213 ms       | 20 rows               |
| Exact tag Search plan        | 0.184 ms       | 20 rows               |
| Occurrence-date indexed plan | 0.061 ms       | 20 rows               |
| First Search page            | 4.381 ms       | 20 rows / 8,955 bytes |
| Second cursor page           | 3.196 ms       | 20 rows               |
| Owner tag suggestions        | 3.257 ms       | 12 rows               |

Feed, Search, collection, Calendar, report-source and Chat retrieval use
owner-scoped indexed queries with explicit limits and cursors where results can
grow. Report source assembly and AI evidence packets enforce entry, media and
byte ceilings. Private media authorization resolves an attachment/object in a
single owner-scoped request rather than authorizing every object through a list
scan. Media and AI workers use leases, heartbeats, bounded concurrency,
idempotent receipts, retry ceilings and dead-letter terminal states. Upload
attempts are resumable/idempotent and no worker job or AI evidence packet is
unbounded.

These are local synthetic measurements, not hosted load-test results.

## Accessibility and visual evidence

Automated keyboard/focus assertions and axe ran at 320, 390, 768, 960, 1200 and
1440 px. The campaign checks reflow/no horizontal overflow, reachable capture
controls, mobile navigation clearance, media controls, Calendar, tag hierarchy,
reports, Chat composer placement, focus restoration, status announcements and
reduced-motion styles. Final 390x844 and 1440x1000 screenshots are in
`test-results/evidence`; the place-redaction images were visually inspected
after streamed content completed.

Automated axe is not a human screen-reader certification. Physical keyboard,
screen-reader, high-contrast, 200%/400% zoom and mobile assistive-technology
review remain explicit beta gates.

## Remaining-item classification

### BLOCKER

- None known for a local or controlled closed beta that keeps unapproved live
  AI/transcription disabled.

### BETA GATE

- Certify real iOS Safari and Android camera, microphone, background upload and
  GPS behavior on physical devices.
- Complete human keyboard, screen-reader, high-contrast and 200%/400% reflow
  review.
- Approve and certify a live AI/transcription provider before enabling AI,
  transcription, insights or provider-backed Chat for beta users.

### PRODUCTION GATE

- Configure reviewed live-provider credentials only after provider approval and
  privacy/security review.
- Deploy supervised durable media and AI workers with queue age, scanner
  freshness, retry/dead-letter and cost alerts.
- Replace the in-memory limiter with a shared privacy-safe rate-limit adapter.
- Establish hosted database/object backup, retention, restore and deletion
  operations, plus production load/soak testing and observability.
- Validate hosted signed-resumable upload, private range delivery, proxy/header
  behavior and share abuse controls in the deployment environment.

### OPTIONAL POST-V1

- Semantic/vector memory.
- Production response streaming.
- Public media sharing, autonomous actions, web access, scheduled report
  execution and server-rendered PDF.

## Release-control note

No deployment, push, public tag, paid service or real-data test was performed.
The certification commit is the commit containing this record; its hash and the
post-commit clean-tree check are reported in the delivery message because a
commit cannot truthfully contain its own hash.
