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

Search is not implemented in vertical slice 1.

## Attachment-capable Entries

Future finalization must allow either non-empty text or at least one valid
attachment. The revision table therefore permits an empty `body_text` and does
not encode a permanent “all active Entries contain text” invariant. The current
text-only `create_entry` and `revise_entry` RPCs require 1–100,000 trimmed
characters. Attachment-aware finalization will replace that RPC-level rule.

Attachments must not be modeled as image-only. A later extension will use a
general media abstraction with reserved kinds `image`, `video` and `audio`.
These values are architectural reservations only: this migration creates no
attachment table, upload route or MIME allowlist and accepts none of them.

Common attachment records must not require image dimensions. Image dimensions
and EXIF-derived facts belong in image metadata or media-variant structures.
Video-specific duration, codecs, rotation, renditions, thumbnails, extracted
audio and transcripts likewise belong in typed metadata or variant records.
The original accepted video remains private and immutable.

See [deferred-media-attachments.md](deferred-media-attachments.md) for the
future extension boundary.
