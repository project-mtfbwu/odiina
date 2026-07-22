# Media architecture and deferred video intelligence

Status: private image, voice-note and video capture/processing/playback are
implemented for local certification. Video transcription, caption generation,
AI sampling and interpretation remain deferred.

## Domain boundary

Odiina's attachment identity is media-general. Media kinds are `image`, `audio`
and `video`; each is accepted only through its own narrow route and worker
policy. Common records do not assume dimensions, duration or codecs.
`image_metadata`, `audio_metadata` and `video_metadata` own those typed facts.

The accepted original is private and immutable. Storage completion does not
mean acceptance. Entry revisions freeze ordered attachment membership; one
revision may contain up to five images plus either one voice note or one video.

## Implemented video boundary

- Existing-file selection on desktop and mobile.
- Explicit browser camera permission, optional microphone permission and a
  second explicit action before recording starts.
- Native `capture="environment"` picker fallback.
- Local preview, retake, discard and approval before submission.
- Visible upload progress, cancellation, bounded in-session TUS recovery, and
  scanning/validating/transcoding/poster/ready/failed states.
- Maximum 250 MiB, 250 msâ€“5 minutes, 3840Ã—2160 pixel area and 60 fps source.
- WebM VP8/VP9 + optional Opus, MP4 H.264 + optional AAC, or MOV H.264/HEVC +
  optional AAC, with MIME, extension, signature and probe agreement.
- Fail-closed malware scanning before probing or transcoding.
- Rotation normalization, metadata stripping, no upscale, H.264 `yuv420p` MP4
  bounded to 1920Ã—1080 pixel area/30 fps, and a required private JPEG poster.
- Authenticated same-origin playback with `private, no-store` and byte ranges.

The browser never plays an uploaded original. It receives only the validated
playback rendition. GPS and unnecessary descriptive/device metadata are not
carried into derivatives. Original, playback and poster object keys remain
private and are not placed in rendered URLs.

## Lifecycle and operations

The existing signed TUS quarantine path, ClamAV scanner, pgmq job queue,
worker-principal generation, leases and heartbeats are shared infrastructure;
video validation and commit logic remain media-specific. The worker has one
consumer per container plus explicit memory, CPU, process and temporary-storage
bounds. Retry never widens validation, and a stale lease cannot commit.

Deletion coordination must ultimately cover quarantine remnants, originals,
playback, posters and any later derivatives. Permanent byte deletion remains a
separate retention increment; Trash and restore preserve owner playback today.
Before hosted deployment, review exact container digests, FFmpeg license and
security support, storage/bandwidth/transcoding cost, worker concurrency and
large-file memory pressure.

## Deferred transcription and evidence

No audio extraction, transcript, caption, `transcript_input`, `ai_sample`, AI
analysis or OpenAI call exists in Increment F. A future approved workflow must
obtain explicit consent and bind every result to the exact accepted Attachment
version. Evidence must cite Attachment ID, `start_ms`, `end_ms`, and the exact
transcript segment or sampled frame. It must never claim continuous observation
when only selected frames, clips or transcript segments were analyzed.

Future object variants may include `audio`, `transcript_input` and `ai_sample`,
but those values are not accepted through current upload routes. Private media
must never be cached by a service worker or made public through long-lived
signed URLs.

## Remaining release gates

- Physical iOS Safari and Android Chromium capture/picker tests, including
  permission denial, orientation, backgrounding and memory pressure.
- Keyboard, screen-reader, touch, reduced-motion, high-contrast and 400% reflow
  human review on real devices.
- Hosted-object range and cancellation/recovery tests against the selected
  production Storage endpoint.
- Retention/deletion propagation for every original and derived object.
- Cost/concurrency baselines using approved maximum-size fixtures.
- Separate approval for transcription or evidence-linked AI.
