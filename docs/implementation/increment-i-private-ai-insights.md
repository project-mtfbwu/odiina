# Increment I — consent-based transcription and private AI insights

Status: implemented and certified locally with the deterministic fake provider.
Live provider use and production worker deployment remain blocked by explicit
approval gates.

## Delivered

- Default-off, independently recorded consent for transcription, transcript
  Search and insights, plus a master kill switch.
- Request-only voice/video-audio transcription with durable jobs, leases,
  heartbeats, cancel, bounded retry and dead-letter states.
- Timed transcript segments, separate append-only corrections, click-to-seek,
  explicit deletion and current-revision staleness.
- Transcript text in the existing private indexed Search system, with a
  “Matched transcript” result label and the same filters/cursor pagination.
- Private insight scope preview, explicit evidence selection, frozen revision
  snapshots, normalized citations, staleness and deletion.
- Two active jobs per user, 20 hours of transcription per month, ten insight
  requests per day and 100 per month. Usage records cost zero for the fake
  provider.
- A restricted non-human AI worker identity. The bootstrap service role is
  local-only and never belongs in app configuration or browser code.

## Provider decision

The only implemented adapter is `fake-local`, using deterministic transcript
and insight fixtures with no network or content egress. It exists for database,
worker and UI certification. No OpenAI or other live SDK/key was added because
there is no approved provider-region-retention contract. A live provider may be
introduced only as a separately reviewed adapter behind the same contracts.

The current official OpenAI model documentation describes transcription models
as audio-input models. That supports a future audio-only video path, but it does
not itself approve a vendor or retention policy. Video frames are never sent in
this increment.

## Known deployment blockers

- Select and approve a live provider, exact models, region, data retention,
  training policy and commercial limits.
- Deploy and monitor a durable worker outside the Next.js request lifecycle.
- Define hosted database and object-backup retention so deletion language can
  state the real expiration window.
- Validate live-provider multilingual and long-recording behavior with safe
  synthetic fixtures before any private beta.

Do not begin Increment J until these Increment I boundaries remain intact.
