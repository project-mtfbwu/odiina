# Increment C — private Profile identity

Status: implemented for local certification.

## Identity and handle policy

Every authenticated account has one private Profile. Existing rows are
preserved and receive the deterministic defaults `Odiina member` and
`member_<23-character UUID digest>`. The digest is not an email or public
identifier.

Display names are trimmed, required, preserve chosen capitalization and accept
1–80 Unicode characters. Bios are plain text, preserve line breaks and accept
up to 500 Unicode characters.

Handles are stored and displayed in canonical lowercase form without the `@`.
They are 3–30 ASCII characters, start with a letter, and contain only lowercase
letters, digits and underscores. `handle_normalized` stores the comparison
value. Its database unique constraint resolves concurrent claims atomically.
Conflict errors do not identify the owner. Reserved handles are: `odiina`,
`admin`, `api`, `auth`, `login`, `logout`, `onboarding`, `feed`, `calendar`,
`profile`, `settings`, `trash`, `entries`, `reviews`, and `insights`.

Profile changes use `updated_at`; no user-visible Profile revision history is
created in this private MVP. Diagnostic paths must log only safe codes and
opaque identifiers, never display names or bio text.

## Private media lifecycle

Avatar and banner images extend the existing attachment domain with an
authoritative purpose. They use the same signed TUS authorization, private
quarantine, size verification, PGMQ lease, ClamAV scan, magic-byte validation,
strict Sharp decode limits, orientation normalization and metadata-stripping
derivative process as Entry images.

The display derivative is a centered 640×640 crop for avatars and a centered
1600×533 crop for banners. Focal-position editing is deliberately deferred;
the existing pipeline does not support recording it before derivative
generation cleanly. The Profile save command accepts only an accepted, owned
image whose purpose matches the slot. A failed replacement therefore leaves
the previous pointer intact. Odiina serves only the current verified display
object through an authenticated `private, no-store` route.

Removal clears the current pointer. Superseded accepted originals and
derivatives are not deleted synchronously; production retention/deletion work
must reconcile unreferenced Profile attachments without touching immutable
Entry history. Abandoned quarantine attempts remain covered by the certified
orphan reconciler.

## Statistics definitions

`profile_statistics()` performs one owner-scoped aggregate in Postgres:

- **Active Entries:** current Entries with lifecycle `active`; Trash and drafts
  are excluded.
- **Logging days:** distinct occurrence dates across active current revisions.
- **This month:** active current revisions whose occurrence date is within the
  current month in the confirmed profile timezone (UTC only if no timezone is
  yet confirmed).
- **Image Entries:** active current revisions containing at least one accepted
  `entry`-purpose image.
- **Edited Entries:** active current revisions with revision number greater
  than one.
- **Joined:** trustworthy `profiles.created_at`, rendered separately.

Trash immediately removes an Entry from every statistic. Restore includes it
again. The browser never downloads all Entries to calculate these values.

## Privacy boundary

`profiles`, `profile_media` and attachment rows use forced RLS and request JWT
ownership. The cohesive save RPC derives ownership from the verified claim and
accepts no user ID. Composite ownership foreign keys prevent cross-account
media pointers. Mutation function owners are `NOLOGIN`, `NOINHERIT`,
`NOBYPASSRLS`, use an empty search path, own no data tables, and receive only
the privileges required for their commands. There are no public Profile URLs,
search, discovery, followers, likes or public storage objects.
