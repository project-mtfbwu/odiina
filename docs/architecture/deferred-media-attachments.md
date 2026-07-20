# Deferred media and video architecture

Status: the general attachment boundary and private image pipeline are
implemented in vertical slice 2. Video and audio remain deferred.

## Domain boundary

Odiina's attachment domain is media-general. Reserved media kinds are `image`,
`video` and `audio`. Only `image` is accepted today, and only through the
implemented JPEG, PNG and WebP pipeline. Video and audio must be enabled only
when each pipeline is complete.

The common attachment identity owns object variants without requiring image
dimensions. Image dimensions and image-only metadata belong in
`image_metadata`. Video
duration, codecs, rotation and orientation belong in video-specific metadata.
This document defines constraints, not a database schema.

The original accepted video is private and immutable. An uploaded object is not
accepted merely because storage succeeded.

## User journey

- Upload an existing video from desktop or mobile.
- Record from a supported phone or tablet through an accessible file input with
  video capture hints.
- Evaluate a richer MediaRecorder flow as an optional enhancement, never as the
  only capture route.
- Preview before submission and permit retake or discard.
- Add optional plain-text context.
- Show progress, cancellation and honest processing, failed, unsupported and
  ready states.
- Pause, resume or recover interrupted large uploads where supported.

The design must be tested on current iOS Safari and Android browser behavior,
including permission, backgrounding, memory pressure and capture-format
differences. Controls must remain keyboard, touch and screen-reader operable.

## Upload and acceptance pipeline

- Define explicit maximum duration and file size before enabling uploads.
- Maintain a narrow container, codec and MIME policy per implemented pipeline.
- Validate both declared MIME type and file signature.
- Upload into private quarantine storage using a suitable resumable protocol.
- Probe metadata in an isolated processing boundary.
- Perform malware scanning and reject unsupported or suspicious objects.
- Remove GPS and unnecessary metadata.
- Normalize rotation and orientation.
- Transcode into validated playback renditions.
- Generate posters or thumbnails without making image metadata universal.
- Extract audio only for an approved transcription flow.
- Advance state atomically so uploaded bytes are never treated as ready early.

Playback must use a validated or transcoded rendition. Odiina must never treat
the original uploaded bytes as safe inline playback content.

## Object variants

Future object variants may include `quarantine`, `original`, `playback`,
`thumbnail`, `audio`, `transcript_input` and `ai_sample`. Variant identity,
provenance and generation state must be traceable to the exact accepted media
version. These are reserved terms, not a current enum or allowlist.

## Private playback

Objects remain private. Download and playback authorization must be owner-scoped
and independently tested. The design must support authorized byte range
requests for seeking without making storage objects public.

Signed URLs require short, purpose-specific expiry and leakage analysis across
referrers, browser history, logs, copied links, proxy caches and downstream
players. Private media must not be cached by a service worker.

## Transcription and evidence

A future transcript contains time-coded segments connected to an exact accepted
media version. AI findings based on video must cite:

- Attachment ID.
- Exact accepted media version.
- `start_ms`.
- `end_ms`.
- Transcript segment or sampled-frame evidence where applicable.

Video interpretation must state its evidence coverage. It must never claim
continuous observation when only selected frames, clips or transcript segments
were analyzed. Explicit user consent is required before AI video analysis.

## Lifecycle, cost and deletion

Deletion coordination must cover originals, quarantine remnants, playback
renditions, thumbnails, extracted audio, transcript inputs, transcripts, AI
samples and derived evidence references. Partial failures must not leave
publicly reachable objects.

Architecture review must model storage, upload and playback bandwidth, scanning,
probing, transcoding, transcription and model costs before enabling video.

## Future implementation gates

1. Approve limits, browser matrix, formats and codecs.
2. Approve the general attachment, accepted-version and variant data model.
3. Prove private resumable upload, recovery and cancellation.
4. Prove quarantine, validation, scanning and safe transcoding.
5. Prove authorized range playback and signed-URL containment.
6. Prove deletion propagation across every original and derived object.
7. Add accessible capture, preview, retake and recovery journeys.
8. Add transcription and time-coded evidence only after explicit consent.
9. Add AI interpretation only after evidence-coverage language is enforced.

No video dependency, endpoint, control, transcoding service or production
infrastructure is justified by this deferred document alone.
