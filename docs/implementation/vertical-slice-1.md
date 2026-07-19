# Vertical slice 1

## Scope

This slice closes one real loop: invited user signs in, confirms a timezone,
captures text, reviews it in a cursor-paginated Feed, creates immutable edits,
moves it to Trash, restores it, changes settings and logs out.

## Routes

| Route                          | Boundary                                         |
| ------------------------------ | ------------------------------------------------ |
| `/login`                       | Public, enumeration-resistant magic-link request |
| `/auth/callback`               | Same-origin PKCE exchange and verified claims    |
| `/onboarding`                  | Authenticated timezone confirmation              |
| `/feed`                        | Server-rendered current Entry projection         |
| `/entries/[entryId]`           | Owner-scoped detail and revision history         |
| `/entries/[entryId]?mode=edit` | New-revision editor                              |
| `/trash`                       | Recoverable trashed Entries                      |
| `/settings`                    | Time preferences, feature status and logout      |
| `/api/feed`                    | Authenticated cursor page                        |
| `/api/entries*`                | CSRF-protected create/revise/trash/restore       |
| `/api/preferences`             | CSRF-protected preference update                 |

All authenticated HTML, RSC and API responses receive private no-store headers.

## Database and RPCs

The migration creates `app.profiles`, `app.user_preferences`, `app.entries`,
`app.entry_revisions` and `app.entry_command_receipts`. Auth-user insertion
provisions the first two rows. Forced RLS grants owner reads. Narrow NOLOGIN
roles own `create_entry`, `revise_entry`, `trash_entry`, `restore_entry` and
`save_preferences`; no RPC accepts `user_id`.

The mutation owner is still constrained by an explicit `auth.uid()` RLS policy.
Composite foreign keys prevent cross-owner and cross-Entry current pointers.
Revisions reject UPDATE and DELETE. Service-role visibility is tested
separately and is never described as RLS protection.

## Acceptance evidence

- Strict TypeScript, ESLint and Prettier gates
- Unit tests for validation, timezones, cursors, safe errors, CSRF/origin,
  redirect allowlisting and Unicode previews
- pgTAP ownership, immutability, idempotency, stale-edit and lifecycle tests
- Playwright responsive login and axe scans at 320, 390, 768, 960, 1200 and
  1440 CSS pixels
- A reset-stack authenticated Playwright journey covering magic-link login,
  onboarding, create, edit/history, Trash, restore, logout, cookie attributes,
  parallel refresh reads, offline preservation and key axe scans
- A loopback-only Auth-admin fixture setup, keeping its local service-role key
  in the test process and out of Odiina application and browser code
- Manual in-app browser inspection for layout, keyboard focus and reflow

Tests requiring Docker must be reported as unexecuted when Docker is absent.

## Known limitations

- The memory rate limiter is not multi-instance.
- Parallel local session reads are covered; hosted parallel-refresh behavior
  still needs proof before deployment.
- Authenticated browser coverage requires Docker, local Supabase and Mailpit and
  must not be reported as passing on a machine where those are unavailable.
- No permanent-delete coordinator exists.
- Video and all other media capture are deferred; no media kind, MIME type or
  upload endpoint is enabled.
- The single light theme has future theme tokens but no rushed dark mode.
- Automated accessibility evidence needs human screen-reader and zoom review.

## Next slice

Add permanent-delete coordination and hosted-equivalent parallel session
refresh proof. Then design a general attachment/media contract and secure
quarantine pipeline before implementing any individual image, video or audio
upload route. A later video slice must cover accessible mobile capture,
resumable upload, validation, transcoding, private playback, time-coded
transcripts and evidence references. AI interpretation remains deferred until
the evidence boundary and explicit consent journey are approved.
