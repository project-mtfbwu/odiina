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

Attachments are modeled through a general media abstraction with reserved
kinds `image`, `video` and `audio`. Slice 2 accepts only `image` through the
implemented JPEG, PNG and WebP pipeline. Video and audio remain architectural
reservations and are rejected by current routes and mutation functions.

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
remaining video and audio extension boundary.

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
