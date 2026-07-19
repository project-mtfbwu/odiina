# Odiina

Odiina is a private raw-life and work feed that turns your daily activity into
traceable personal intelligence.

This repository contains Section 8: the local scaffold and first vertical
slice. It is not deployed, `odiina.app` is only a suggested placeholder, and
no tagline or final brand assets have been selected.

## Implemented scope

- Responsive application shell and accessible public sign-in screen
- Invite-compatible email magic-link authentication
- Per-request, server-only Supabase clients with HttpOnly session cookies
- Explicit timezone onboarding and settings
- Text Entry creation, cursor-paginated Feed, detail and editing
- Immutable Entry revisions with optimistic-concurrency protection
- Trash, 30-day purge metadata, restore and logout
- Honest loading, empty, error and offline states
- Repository migration, seed data, pgTAP, unit and browser-test scaffolds

AI, OpenAI calls, media uploads, workers, sharing, reports, search, tags,
projects, calendar, charts, voice and private-content service-worker caching
are deliberately absent. Their feature flags are false.

## Deferred media scope

Future Entries may carry attachments through a general private media
abstraction. Reserved future media kinds are `image`, `video` and `audio`, but
none is accepted by this slice and no broad media MIME allowlist exists.

Video scope includes existing-file upload and accessible mobile capture,
preview/retake/discard, optional text, resumable progress and cancellation,
validated processing states, private authorized playback, transcription and
time-coded evidence. Uploaded bytes must remain quarantined until signature
validation, probing, malware scanning and safe transcoding succeed. Playback
must use a validated rendition, not the original upload.

See [deferred media architecture](docs/architecture/deferred-media-attachments.md).

## Architecture

Next.js App Router server components render authenticated pages. Browser code
calls only same-origin Odiina routes and never receives Supabase tokens or a
service-role key. Each request constructs its own Supabase SSR client. Postgres
is the final authorization boundary: forced RLS controls reads and narrowly
owned `SECURITY DEFINER` RPCs perform state changes.

Entries are stable containers. Every change inserts an immutable revision and
atomically advances an exact `(user_id, entry_id, revision_id)` pointer.
Creation is idempotent by `(user_id, client_request_id, canonical payload)`.
The Feed uses occurrence time plus Entry UUID as a deterministic cursor; its
page size is 24.

See [vertical-slice-1.md](docs/implementation/vertical-slice-1.md),
[the auth ADR](docs/decisions/0001-server-only-supabase-auth.md),
[database errata](docs/architecture/database-errata.md), and
[deferred media architecture](docs/architecture/deferred-media-attachments.md).

## Local prerequisites

- Node 24 LTS (`.nvmrc` pins 24.18.0; 24.16+ is accepted)
- Corepack and pnpm 11.15.0
- Docker Desktop or another Docker-compatible daemon

## Setup

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm supabase:start
Copy-Item .env.example .env.local
corepack pnpm supabase:reset
corepack pnpm dev
```

After `supabase:start`, copy its local API URL and publishable key into
`.env.local`. Never commit `.env.local`. Local mail is visible at
`http://127.0.0.1:54324`. `ada@example.test` is a non-login seed placeholder
with one synthetic Entry.

To retrieve the exact local values:

```powershell
corepack pnpm exec supabase status -o env
```

Map `API_URL` to `SUPABASE_URL` and `ANON_KEY` to
`SUPABASE_PUBLISHABLE_KEY` in `.env.local`. The local anon key is suitable for
this local publishable-key setting; never use `SERVICE_ROLE_KEY`.

Create the login-capable local test identity through the supported Auth admin
API. Copy the local `SERVICE_ROLE_KEY` printed by the status command into this
temporary shell variable only:

```powershell
$env:ODIINA_E2E_SERVICE_ROLE_KEY = "<local SERVICE_ROLE_KEY>"
corepack pnpm seed:e2e-user
```

The setup script refuses non-loopback Supabase URLs. Do not put this credential
in `.env.local`; Odiina itself neither needs nor reads it.

Open `http://localhost:3000`. The exact start command is:

```powershell
corepack pnpm dev
```

## Environment and privacy

Only `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `ODIINA_APP_URL`, the local
rate-limit adapter and disabled flags are active. OpenAI variables are inactive
server-only placeholders and must never receive a `NEXT_PUBLIC_` prefix.

The in-memory rate limiter is single-process and local-only. Replace it with a
shared privacy-safe adapter before any public beta. Do not use real personal
data, expose a service-role key, or commit `.env.local`. Entry text is plain
text, never appears in URLs or logs, and authenticated responses are
`private, no-store`. Permanent deletion is intentionally unimplemented.

## Quality commands

```powershell
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:db
corepack pnpm test:e2e
corepack pnpm test:a11y
corepack pnpm build
corepack pnpm scan:client
corepack pnpm audit --audit-level moderate
```

`test:db` requires local Supabase. Install Playwright Chromium with
`corepack pnpm exec playwright install chromium`.

After a clean database reset, exercise the complete authenticated journey with:

```powershell
$env:ODIINA_E2E = "1"
$env:ODIINA_E2E_SERVICE_ROLE_KEY = "<local SERVICE_ROLE_KEY>"
$env:ODIINA_MAILBOX_URL = "http://127.0.0.1:54324"
corepack pnpm test:e2e:authenticated
```

For a manual magic-link test, open `http://localhost:3000/login`, submit
`journey@example.test`, open Mailpit at `http://127.0.0.1:54324`, and follow
the newest link. Odiina should open timezone onboarding before the Feed.

Automated accessibility checks are evidence, not human WCAG approval. Keyboard,
screen-reader, zoom/reflow, high-contrast and mobile assistive-technology review
remain required before release.
