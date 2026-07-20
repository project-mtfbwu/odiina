# Vertical Slice 2 — private image capture and safe processing

Status: implemented locally; production-readiness gates remain below.

## User journey

An authenticated owner can choose JPEG, PNG or WebP images, or invoke the
device camera through an accessible file input. Up to five images can be
previewed, reordered, removed, uploaded with real progress, cancelled or
retried. Text is optional when an image is present. Odiina reports honest
uploading, checking, preparing, ready and failed states.

Activation waits for every selected image to be accepted. The new Entry then
appears in the chronological Feed. The owner can view it, create a new
immutable revision with an exact reordered or reduced image set, inspect prior
revision media, trash it, view it in Trash and restore it. Feed, detail and
Trash render only the safe display derivative.

## Trust and privacy boundaries

The browser requests a narrow upload authorization from a same-origin Odiina
route protected by the existing server-side session and CSRF controls. Postgres
derives ownership from the verified request claim. Odiina returns a one-time
signed upload token, opaque object key and exact TUS endpoint; it never returns
the browser session token or a service-role key.

The upload lands in private `odiina-quarantine`. It is not renderable. A
registered non-human worker signs in with the public key and its own
credentials, claims one PGMQ job with a timed lease, and receives Storage
access only for that lease. Its function owner is `NOLOGIN`, `NOINHERIT` and
`NOBYPASSRLS`.

The worker verifies the byte count and SHA-256 digest, scans through a private
ClamAV TCP service, checks the JPEG/PNG/WebP magic signature, decodes with
strict Sharp/libvips limits, rejects animation and excessive dimensions,
normalizes orientation and strips metadata. It writes immutable original,
display and AI-sample objects. Odiina serves only the verified JPEG display
derivative through an owner-authorized, `private, no-store` route. The AI
sample is stored but no AI feature consumes it.

Queues contain only opaque job and attachment identifiers plus a schema
version and idempotency key. Worker logs contain only opaque identifiers and
safe error codes. Retry attempts are bounded; terminal work moves to a private
dead-letter queue. Stale pre-processing uploads can be claimed by the worker’s
orphan reconciler and deleted from quarantine.

## Storage design

All buckets are private:

- `odiina-quarantine`: untrusted, signed TUS destination; 15 MiB; exact image
  MIME allowlist.
- `odiina-originals`: accepted immutable source bytes; never rendered inline.
- `odiina-display`: normalized JPEG derivatives rendered by Odiina.
- `odiina-ai`: reduced normalized JPEG samples reserved for later explicit
  AI-consent work; not exposed to users or models in this slice.

The upload route uses TUS because the flow needs visible progress,
cancellation and resumable transfer behavior without proxying large private
bytes through Next.js. It uses fixed 6 MiB chunks and no upsert. A hosted
environment must explicitly configure and verify the direct Storage signed-TUS
endpoint.

## Local setup

From the repository:

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm supabase:start
corepack pnpm configure:local-env
corepack pnpm supabase:reset
corepack pnpm media:scanner
```

Bootstrap a local worker. Keep the service credential in this shell only:

```powershell
$status = corepack pnpm exec supabase status -o json | ConvertFrom-Json
$env:SUPABASE_URL = $status.API_URL
$env:ODIINA_MEDIA_BOOTSTRAP_SERVICE_ROLE_KEY = $status.SERVICE_ROLE_KEY
$env:ODIINA_MEDIA_WORKER_EMAIL = "media-worker@odiina.local"
$env:ODIINA_MEDIA_WORKER_PASSWORD = "<generate-a-strong-local-only-password>"
corepack pnpm media:worker:bootstrap
Remove-Item Env:ODIINA_MEDIA_BOOTSTRAP_SERVICE_ROLE_KEY
```

In one terminal, start the narrow worker using the same email/password:

```powershell
$status = corepack pnpm exec supabase status -o json | ConvertFrom-Json
$env:SUPABASE_URL = $status.API_URL
$env:SUPABASE_PUBLISHABLE_KEY = $status.ANON_KEY
$env:ODIINA_MEDIA_WORKER_EMAIL = "media-worker@odiina.local"
$env:ODIINA_MEDIA_WORKER_PASSWORD = "<the-same-local-only-password>"
corepack pnpm media:worker
```

In another terminal:

```powershell
corepack pnpm dev
```

Open `http://localhost:3000`. Mailpit is at
`http://127.0.0.1:54324`.

## Failure recovery

- A browser retry creates a new authorized attempt; an abandoned pending,
  uploading or quarantined attempt is eligible for bounded orphan cleanup.
- The worker heartbeats its lease between download, scanning, decode, write and
  cleanup phases.
- Immutable object writes use no upsert. On a retry conflict, the worker
  re-downloads and verifies the expected digest before continuing.
- Scanner unavailability, timeout or unhealthy responses fail closed.
- Unsupported, corrupt, animated or over-limit images are terminally rejected.
- Retryable failures use bounded attempts and then the dead-letter queue.
- Operational reconciliation must alert on queue age, lease expiry, DLQ depth,
  scanner freshness and quarantine age before production.

## Production-readiness gates

- Validate the signed TUS endpoint against the hosted Storage version and use
  the direct Storage hostname.
- Deploy ClamAV privately with signature freshness and availability monitoring.
- Run the worker under a supervised, patched runtime with queue/DLQ alerts.
- Replace the single-process application rate limiter.
- Complete manual iOS Safari and Android capture/backgrounding testing.
- Complete human keyboard, screen-reader, high-contrast and 200%/400% reflow
  review.
- Add backup, permanent-deletion and storage-retention operations.
- Track Sharp/libvips and scanner security updates.
- Perform a production threat-model and privacy review before enabling users.

Video, audio, public sharing, reports and AI remain disabled. See
`docs/architecture/deferred-media-attachments.md` for their explicit future
gates.
