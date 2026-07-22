# Section 7 implementation errata

These corrections are authoritative for implementation and preserve the
approved product intent.

## Search projection uniqueness

Do not use `UNIQUE NULLS NOT DISTINCT` on `(user_id, source_entry_id)` or
`(user_id, source_task_id)`. That would permit only one null-valued row per
user. The future search projection must use partial unique indexes:

```sql
create unique index ...
on private.search_documents (user_id, source_entry_id)
where document_kind = 'entry' and source_entry_id is not null;

create unique index ...
on private.search_documents (user_id, source_task_id)
where document_kind = 'task' and source_task_id is not null;
```

Search is not implemented in vertical slice 1 or 2.

## Attachment-capable Entries

Finalization allows either non-empty text or at least one accepted attachment.
The revision table therefore permits an empty `body_text` and does not encode
an “all active Entries contain text” invariant. Slice 2 adds attachment-aware
activation and revision RPCs while retaining the text-only RPCs for backward
compatibility.

Attachments are modeled through a general media abstraction with media kinds
`image`, `video` and `audio`. The image pipeline accepts JPEG, PNG and WebP.
Increment E adds a narrow audio pipeline for WebM/Opus, Ogg/Opus and M4A/AAC.
Increment F adds a separate, purpose-limited video pipeline; it does not widen
the audio route or treat generic attachments as safe video.

Common attachment records do not require image dimensions. Image dimensions
and EXIF-derived facts belong in image metadata or media-variant structures.
Video-specific duration, codecs, rotation, renditions, thumbnails, extracted
audio and transcripts likewise belong in typed metadata or variant records.
The original accepted video remains private and immutable.

The Slice 2 extension is additive:

- `attachments` owns the media identity and lifecycle.
- `attachment_objects` records quarantine and immutable accepted variants.
- `entry_revision_attachments` freezes ordered membership per revision.
- `image_metadata` contains image-only facts.
- `media_processing_jobs` and `media_worker_principals` support narrow,
  lease-bound background processing.

Exact composite ownership keys prevent cross-user and cross-Entry references.
An immutable-membership trigger blocks updates and deletes. Private Storage
policies expose only a signed quarantine insert to the owner, the active lease
to a registered worker, and verified display objects through Odiina’s
owner-authorized delivery route.

See [deferred-media-attachments.md](deferred-media-attachments.md) for the
implemented video boundary and the remaining transcription/AI restrictions.

## Increment E voice-note extension

Increment E remains additive. It adds a private `playback` object variant and
bucket, plus forced-RLS `audio_metadata` containing the accepted duration,
source facts and a fixed 96-point waveform. The common attachment table has no
audio-only columns. Entry revision membership permits up to five images and
one audio attachment; its immutable-history trigger still blocks update and
delete.

Audio authorization derives ownership from the verified request claim and
accepts only a matching filename/MIME pair within 25 MiB. The media worker
claims audio through the existing lease queue, scans quarantine bytes before
probing, rejects ambiguous or video-bearing input, and produces a mono 48 kHz
AAC-LC M4A playback rendition with unnecessary metadata removed. Acceptance
commits the immutable original, playback object, metadata and queue state in
one lease-fenced function. Playback is delivered only through an owner-scoped,
no-store same-origin route with byte-range support.

## Increment F video extension

Increment F adds a private `poster` variant and bucket and forced-RLS
`video_metadata`. The table records the accepted source container/codecs,
duration, dimensions, frame rate, normalized rotation, audio presence, and the
canonical playback/poster facts. These fields are deliberately absent from the
common attachment table.

Authorization derives ownership from the verified request claim and accepts a
single entry-purpose video attempt within 250 MiB. Entry revision membership
permits up to five images plus either one audio attachment or one video
attachment. The immutable membership trigger and composite ownership keys are
unchanged. Replacing or removing video creates a new revision and retains every
accepted historical version.

The lease-fenced worker scans quarantine bytes before bounded probing. It
accepts WebM VP8/VP9 with optional Opus, MP4 H.264 with optional AAC, and MOV
H.264/HEVC with optional AAC; rejects extra streams, unsupported pixel formats,
HDR transfer functions, more than 3840Ã—2160 pixels, more than 60 fps, and
durations outside 250 msâ€“5 minutes; then creates an orientation-normalized,
non-upscaled H.264 `yuv420p` MP4 at no more than 1920Ã—1080/30 fps plus a JPEG
poster. Atomic acceptance requires all immutable objects and validated metadata.

Owner playback and poster reads require an accepted Entry attachment on an
active or trashed Entry. Playback is proxied as `private, no-store` and preserves
authorized byte ranges. Original bytes remain private and immutable and are
never exposed for inline playback. No transcript, extracted-audio, caption, AI
sample or public-sharing object is created in Increment F.

## Private Profile media purpose

Increment C keeps Profile images in the certified attachment pipeline rather
than creating a parallel uploader. `attachments.purpose` distinguishes Entry,
avatar and banner images. Entry-revision membership rejects non-Entry purposes,
and `profile_media` stores the current owner-scoped avatar/banner pointers with
composite ownership foreign keys. Profile saving can advance a pointer only to
an accepted image of the matching purpose.

Removal or replacement does not synchronously delete accepted bytes. A future
retention worker must reconcile unreferenced Profile attachments across
quarantine, original, display and reserved derivative variants without ever
deleting media referenced by immutable Entry history.

## Purpose-specific function ownership

The baseline migration runs as `postgres`, verifies that runner explicitly,
and transfers each private `SECURITY DEFINER` function to a purpose-specific
`NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role. For each exact function signature,
the runner grants itself temporary SET membership and grants the proposed
owner temporary `CREATE` on `app`, transfers ownership, then revokes both
privileges immediately. The function owners own no tables and remain subject
to forced RLS.

Supabase Auth's schema is intentionally not granted to either custom role.
Odiina uses a security-invoker `app.request_user_id()` equivalent of
`auth.uid()` that reads the request JWT settings, including PostgREST's JSON
claims fallback. This removes the ineffective Auth-schema grant that emitted
`no privileges were granted for "auth"` while keeping identity derived solely
from the verified request claim.

## Increment D media activation and revision uploads

Increment D preserves the existing attachment tables. It expands the Entry
upload authorization command so an owner may stage a new image against an
active Entry before creating a new immutable revision. The five-image limit is
calculated from current-revision membership plus unattached live attempts;
historical accepted attachments do not consume a current revision slot.

Media-draft activation now takes a client request UUID and records
`activate_media_entry` in `entry_command_receipts`. Replaying the same canonical
activation returns the original Entry and revision; reusing the UUID with a
different body, occurrence or ordered attachment set fails. The former
non-idempotent function signature is removed.
