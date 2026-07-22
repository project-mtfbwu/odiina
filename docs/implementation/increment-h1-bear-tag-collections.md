# Increment H.1 — Bear-style private tag collections

Increment H.1 completes the private tag experience without replacing Increment
H Search. Text, photo, voice, video, place and mixed-media Entries all use the
same revision-level tag array and the same per-user catalog.

## Authoring behavior

The composer and revision editor recognize Unicode hashtags in authored text.
`#work`, `#work/oas` and `#guitar/practice` become selected tag associations
while the authored `#…` text remains unchanged. A user can remove the
association without editing the text; that association remains ignored until
the hashtag leaves the draft or the user explicitly selects it again.

Recognition requires a word boundary suitable for prose. Email fragments, URL
fragments, inline-code spans and an isolated `#` are not tags. Normalized
duplicates are coalesced and the existing ten-tag database and browser limit
still applies. The picker treats a leading `#` as search syntax, resolves
existing catalog values, and uses Enter to choose an exact match or create a
new private tag.

## Collections and counts

A slash is presentation hierarchy only. `work/oas` remains one canonical tag
and is never rewritten into two memberships. `app.tag_collection_counts()`
expands paths in SQL over active Entries and current revision memberships,
returning exact and descendant counts without fetching Entry rows into the
browser. Trash is excluded; create, revision, Trash and restore are reflected
on the next server render.

The existing `app.search_entries` indexed-query family has an explicit
`p_include_tag_descendants` parameter. Parent collection links set the
bookmarkable `tagScope=collection` URL state; exact child links do not. All
existing date, media, place, Include Trash, sort and cursor behavior remains in
the same Search implementation.

## Privacy and accessibility

Both count and collection Search RPCs derive the owner from the authenticated
claim, use an empty fixed search path, run under the constrained
`odiina_owner_api` role, and deny PUBLIC and anon. Forced RLS remains active on
the tag catalog, immutable revision memberships and current Search documents.

Desktop presents a native collapsible Tags section in the secondary rail.
Mobile exposes `/tags` from the authenticated header without adding another
bottom-navigation item. Nested semantic lists, descriptive count labels,
`aria-current`, 44-pixel targets, visible focus, normal text wrapping and the
existing reduced-motion policy cover keyboard, touch, screen-reader and zoom
use.

## Certification record

- Fresh database reset: all ten migrations, including
  `202607260002_bear_tag_collections.sql`, applied successfully.
- pgTAP/RLS: 9 files and 279 assertions passed, including 17 H.1 assertions.
- Unit: 19 files and 126 assertions passed, including Unicode, nested paths,
  false-positive prevention, association removal, limits and tree construction.
- Responsive axe: `/tags` passed at 320, 390, 768, 960, 1200 and 1440 pixels.
- Authenticated collection journey: desktop 1440×1000 and mobile 390×844
  passed sequentially against local Supabase. It proves inline recognition,
  association removal without text loss, leading-`#` Enter creation, parent and
  child collections, keyboard activation, count changes, Trash and restore.

The authenticated journeys intentionally use one worker because their shared
synthetic account mutates Trash and tag counts. Read-only width checks run in
parallel. No private tag text is logged by the application and no content or
credential leaves the local machine.
