# Increment F â€” private video capture, processing and playback

Status: implemented and locally certified, subject to the physical-device and
hosted-infrastructure gates below.

## Capture and consent

The composer and Entry editor support one video per revision with optional text
and up to five photos. A video and standalone voice note cannot share a
revision. The browser dialog explains private handling before requesting camera
or optional microphone permission; recording starts only after the user presses
Start recording. The native device picker remains available when MediaRecorder
is missing, blocked or unsuitable.

Users can switch enumerated cameras before recording, stop, review with native
controls, record again, discard or approve the local draft. Selection and
recording do not authorize or upload anything until Entry submission. Cancel,
discard, camera switching, device loss, backgrounding, route change and unmount
stop all acquired tracks. A usable interrupted recording is retained locally
for review. The hard limit is 250 MiB and five minutes; the server is
authoritative.

## Accepted formats and safe processing

Approved sources are WebM VP8/VP9 with optional Opus, MP4/M4V H.264 with
optional AAC, and MOV H.264/HEVC with optional AAC. The private signed TUS
upload lands in quarantine. The lease-fenced worker then performs:

1. fail-closed ClamAV scanning;
2. signature, MIME and extension agreement;
3. bounded FFprobe inspection and exact stream/codec policy;
4. duration, resolution, frame-rate, pixel-format and HDR rejection checks;
5. orientation-normalized, non-upscaled H.264 `yuv420p` MP4 transcoding with
   optional AAC-LC and unnecessary metadata removed;
6. playback re-probing and private JPEG poster generation;
7. immutable original/playback/poster upload and atomic acceptance.

Source limits are 250 msâ€“5 minutes, at most 3840 pixels on either side,
at most 3840Ã—2160 pixel area and at most 60 fps. Playback is bounded to a
1920Ã—1080 pixel area, 30 fps and 180 MiB; the poster is at most 1280 pixels on
either side and 2 MiB. Output never upscales. FFmpeg/FFprobe execute without a
shell or user-controlled command fragments inside the resource-bounded worker.
The certified local image currently provides FFmpeg and FFprobe
`5.1.9-0+deb12u1`; the deployment gate requires reviewing and pinning the
selected image digest rather than assuming that mutable package version.

## Privacy, playback and revisions

Only the accepted H.264 rendition and required poster are delivered to the
owner through an authenticated same-origin route. Responses are private and
no-store; byte-range requests are preserved for seeking. Storage buckets stay
private, original object paths do not enter browser markup, and originals are
never inline playback sources. Players do not autoplay and use native controls,
inline mobile playback, a poster, duration/audio labelling, failure messaging,
and cross-player pause coordination.

Adding, replacing or removing video creates a new immutable Entry revision.
Historical accepted video remains visible in revision history. Trash retains
authorized playback and restore behavior. Profile Video Entries counts active
Entries whose current revision contains an accepted video.

No transcription, captions, audio extraction, AI sampling, analysis, OpenAI
dependency, public sharing or service-worker caching is present.

## Local certification

```powershell
corepack pnpm supabase:start
corepack pnpm supabase:reset
corepack pnpm media:scanner
corepack pnpm media:worker:container
corepack pnpm test:scanner
corepack pnpm test:audio
corepack pnpm test:video
corepack pnpm test:db
```

Authenticated browser certification sets `ODIINA_E2E=1`, a temporary local
service-role key for test-user creation only, `ODIINA_MAILBOX_URL`, and
`ODIINA_E2E_SERVER_MODE=production`, then runs the six layout projects, mobile
capability project, and desktop/mobile journeys. The journeys validate local
selection/discard, no pre-submit authorization, TUS upload, real worker
processing, playback policy, authenticated 206 ranges, private posters,
record/review/retake/use, immutable replacement/removal, Calendar, Profile,
Trash/restore, logout, axe and track cleanup.

Synthetic container certification covers WebM VP8/Opus, portrait MP4
H.264/AAC, silent MP4, MOV H.264/AAC, signature rejection, canonical output,
orientation, poster generation and metadata removal. Fixtures contain no
private user data.

## Browser and deployment gates

Desktop/mobile Chromium automation is evidence, not a physical-device waiver.
Before release, test current iOS Safari and Android Chromium with real front and
rear cameras, microphone allow/deny, native pickers, rotation, backgrounding,
large files, interrupted networks, storage pressure, VoiceOver/TalkBack,
keyboard use, 200%/400% reflow, reduced motion and high contrast. Safari/HEVC
MOV and hosted resumable/range behavior require explicit device evidence.

Before production deployment, pin/review the worker and codec image digests,
confirm FFmpeg licensing and security support, benchmark the maximum approved
input under the configured 1.5 GiB/2 CPU/768 MiB temporary-storage bounds, set
worker concurrency from measured capacity, and approve storage, bandwidth and
transcoding cost. Permanent media deletion remains a future retention slice.
