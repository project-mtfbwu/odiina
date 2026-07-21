# Odiina

Odiina is a private raw-life and work feed that turns your daily activity into
traceable personal intelligence.

This repository contains the local scaffold and the first three MVP increments.
It is not deployed, `odiina.app` is only a suggested placeholder, and no
tagline or final brand assets have been selected.

## Implemented scope

- Responsive application shell and accessible public sign-in screen
- Invite-compatible email magic-link authentication
- Per-request, server-only Supabase clients with HttpOnly session cookies
- Explicit timezone onboarding and settings
- Text Entry creation, cursor-paginated Feed, detail and editing
- Immutable Entry revisions with optimistic-concurrency protection
- Trash, 30-day purge metadata, restore and logout
- Private JPEG, PNG and WebP capture/upload, with five images per Entry
- Signed resumable uploads into private quarantine storage
- Fail-closed ClamAV scanning, strict decoding and metadata-stripping derivatives
- Image-only Entries and immutable, ordered image membership per revision
- Calendar recall using explicit occurrence dates
- Private Profile identity with display name, canonical unique handle and bio
- Private avatar/banner processing and owner-authorized delivery
- Truthful owner-scoped Profile statistics
- Honest loading, empty, error and offline states
- Repository migration, seed data, pgTAP, unit and browser-test scaffolds

AI, OpenAI calls, video, audio, sharing, reports, search, tags, projects,
charts, voice and private-content service-worker caching are
deliberately absent. Their feature flags are false.

## Media boundary

Attachments use a media-general domain model. Slice 2 accepts only the `image`
kind and only JPEG, PNG and WebP through its implemented pipeline. The
`video` and `audio` kinds remain reserved and cannot be submitted through
routes or RPCs. Common attachment records do not require image dimensions;
those facts live in image metadata.

Video scope includes existing-file upload and accessible mobile capture,
preview/retake/discard, optional text, resumable progress and cancellation,
validated processing states, private authorized playback, transcription and
time-coded evidence. Uploaded bytes must remain quarantined until signature
validation, probing, malware scanning and safe transcoding succeed. Playback
must use a validated rendition, not the original upload.

See [Slice 2 implementation](docs/implementation/vertical-slice-2.md) and
[deferred media architecture](docs/architecture/deferred-media-attachments.md).

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

Image bytes upload directly to a private quarantine bucket using a one-time
signed TUS authorization. Browser code receives neither a Supabase session
token nor a service-role credential. A narrow non-human worker claims jobs
through Postgres queues, leases only the object for its active job, scans it,
validates its real signature and decoder limits, and writes immutable original,
display and AI-sample variants. Odiina renders only the verified display
derivative through an owner-authorized same-origin route.

See [vertical-slice-1.md](docs/implementation/vertical-slice-1.md),
[vertical-slice-2.md](docs/implementation/vertical-slice-2.md),
[the auth ADR](docs/decisions/0001-server-only-supabase-auth.md),
[database errata](docs/architecture/database-errata.md), and
[deferred media architecture](docs/architecture/deferred-media-attachments.md).
Increment C's identity, media-retention and statistics policies are documented
in [increment-c-private-profile.md](docs/implementation/increment-c-private-profile.md).

## Local prerequisites

- Node 24 LTS (`.nvmrc` pins 24.18.0; 24.16+ is accepted)
- Corepack and pnpm 11.15.0
- Docker Desktop or another Docker-compatible daemon
- Enough Docker memory for Supabase and the ClamAV scanner

## Setup

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm supabase:start
corepack pnpm configure:local-env
corepack pnpm supabase:reset
corepack pnpm media:scanner
corepack pnpm dev
```

`configure:local-env` writes only browser-safe local settings from the running
stack: the API URL, anon/publishable key, application URL and disabled feature
flags. It refuses non-loopback URLs and never writes a service-role credential
or OpenAI variable. Never commit `.env.local`. Local mail is visible at
`http://127.0.0.1:54324`. `ada@example.test` is a non-login seed placeholder
with one synthetic Entry.

To retrieve the exact local values:

```powershell
corepack pnpm exec supabase status -o env
```

The generator maps `API_URL` to `SUPABASE_URL` and `ANON_KEY` to
`SUPABASE_PUBLISHABLE_KEY`. The local anon key is suitable for this local
publishable-key setting; never use `SERVICE_ROLE_KEY`.

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

Only the documented Supabase, application, signed-TUS, worker/scanner and
feature-flag variables are active. OpenAI is not configured. No secret may
receive a `NEXT_PUBLIC_` prefix.

Image processing needs a separately bootstrapped worker identity. The bootstrap
service-role key is accepted only from the current process, only against
loopback Supabase, and must never be written to `.env.local`. See the exact
commands in [vertical-slice-2.md](docs/implementation/vertical-slice-2.md).
The running worker uses only the publishable key plus its own non-human
credentials.

For a hosted Supabase project, set `ODIINA_STORAGE_TUS_URL` to the reviewed
direct Storage signed-upload endpoint. Do not assume the local default or a
project hostname. Keep every bucket private.

The in-memory rate limiter is single-process and local-only. Replace it with a
shared privacy-safe adapter before any public beta. Do not use real personal
data, expose a service-role key, or commit `.env.local`. Entry text is plain
text, never appears in URLs or logs, authenticated responses are
`private, no-store`, and worker logs contain only opaque identifiers and safe
codes. Permanent deletion is intentionally unimplemented.

## Quality commands

```powershell
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:db
corepack pnpm test:scanner
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
