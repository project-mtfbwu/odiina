# Odiina

Odiina is a private raw-life and work feed that turns your daily activity into
traceable personal intelligence.

This repository contains the local scaffold and the first seven MVP increments.
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
- Progressive live camera capture with review, retake and native-picker fallback
- Private safe-derivative Feed/detail inspection with accessible focus restoration
- Private live voice-note recording and existing-audio selection with local review
- One voice note per revision, mixed with optional text and up to five photos
- Malware scanning, strict audio probing and canonical private AAC playback
- Accessible waveform, seek, pause and single-active-player controls
- Private video selection and explicit browser camera/microphone recording
- Local video review, retake, discard and native device-picker fallback
- One video per revision, mutually exclusive with a standalone voice note
- Strict video probing, metadata removal, H.264/AAC playback and private posters
- Owner-authorized, no-store video playback with HTTP byte ranges
- Optional private place labels on Entries, including place-only Entries
- Explicit one-time device location with label-only, approximate or exact privacy
- Immutable per-revision place snapshots and explicit all-history redaction
- Calendar recall using explicit occurrence dates
- Private Profile identity with display name, canonical unique handle and bio
- Private avatar/banner processing and owner-authorized delivery
- Truthful owner-scoped Profile statistics
- Honest loading, empty, error and offline states
- Repository migration, seed data, pgTAP, unit and browser-test scaffolds

AI, OpenAI calls, sharing, reports, provider place search, nearby discovery,
maps, tags, projects, charts,
transcription, captions and private-content service-worker caching are
deliberately absent. Their feature flags are false.

## Media boundary

Attachments use a media-general domain model. Implemented pipelines accept
JPEG, PNG and WebP `image` media; WebM/Opus, Ogg/Opus and M4A/AAC `audio`; and
WebM VP8/VP9, MP4 H.264 or MOV H.264/HEVC `video`, with optional approved audio.
Common attachment records do not require image or video dimensions; typed
metadata tables own media-specific facts.

Video accepts at most 250 MiB and five minutes. Uploaded bytes remain private
and quarantined until malware scanning, signature/declaration agreement,
bounded FFprobe inspection, codec validation, rotation normalization,
metadata removal, H.264/AAC transcoding and poster generation succeed. The
browser receives only the accepted rendition through an authenticated
same-origin streaming route; originals are never used for inline playback.
Transcription, captions, extracted audio and AI interpretation remain deferred.

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

Media bytes upload directly to a private quarantine bucket using a one-time
signed TUS authorization. Browser code receives neither a Supabase session
token nor a service-role credential. A narrow non-human worker claims jobs
through Postgres queues, leases only the object for its active job, scans it,
validates its real signature and decoder limits, and writes purpose-specific
immutable variants. Odiina renders only verified display, audio-playback or
video-playback/poster derivatives through owner-authorized same-origin routes.

See [vertical-slice-1.md](docs/implementation/vertical-slice-1.md),
[vertical-slice-2.md](docs/implementation/vertical-slice-2.md),
[the auth ADR](docs/decisions/0001-server-only-supabase-auth.md),
[database errata](docs/architecture/database-errata.md), and
[deferred media architecture](docs/architecture/deferred-media-attachments.md).
Increment C's identity, media-retention and statistics policies are documented
in [increment-c-private-profile.md](docs/implementation/increment-c-private-profile.md).
Increment D's picker, camera, retry and image-revision policies are documented
in [increment-d-photo-capture.md](docs/implementation/increment-d-photo-capture.md).
Increment E's voice consent, processing, playback and revision policies are
documented in [increment-e-voice-capture.md](docs/implementation/increment-e-voice-capture.md).
Increment F's video limits, consent, processing, playback and browser gates are
documented in [increment-f-video-capture.md](docs/implementation/increment-f-video-capture.md).
Increment G's place privacy, coordinate-reduction and redaction policies are
documented in [increment-g-place-attachment.md](docs/implementation/increment-g-place-attachment.md).

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

Media processing needs a separately bootstrapped worker identity. The bootstrap
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
corepack pnpm test:audio
corepack pnpm test:video
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
