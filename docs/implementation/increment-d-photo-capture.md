# Increment D — photo picker, camera capture and image Feed completion

Status: implemented for local certification.

## Composer and limits

Entry capture accepts one to five ordered JPEG, PNG or WebP photos, up to
15 MiB each. Choosing or capturing only creates local previews; no upload or
Entry mutation occurs until the user submits. The composer supports removal,
reordering, Add more and Clear all, and preserves optional text alongside
image-only Entries.

Submission processes each photo through the certified private pipeline and
waits for every accepted derivative before activating the Entry. A later-photo
failure retains earlier ready attachments and the local draft. Retry cancels a
failed attempt where possible and uploads only unfinished items. Activation is
idempotent through `entry_command_receipts`, so a lost response cannot publish
a duplicate Entry.

## Camera progressive enhancement

The compact camera action opens an explanation before requesting permission.
On secure contexts with `getUserMedia`, Odiina prefers an environment-facing
camera, provides a live preview, can switch enumerated cameras, captures one
JPEG still, stops all tracks, and offers Discard, Retake and Use photo. Retake
never uploads the rejected capture. Cancel, permission failure, route change
and component unmount stop every acquired track.

Browsers without live camera support, denied permission, or no camera device
receive explicit guidance plus native `capture="environment"` and ordinary
photo-picker fallbacks. iOS Safari commonly uses the native capture input;
Android Chromium can use either path. Physical current-device Safari and
Android permission/background testing remains a pre-release manual gate.

## Revisions, rendering and privacy

An owned active Entry may stage new photos through the same authorization,
quarantine, ClamAV, signature/decode validation and derivative worker used by
new Entries. Saving passes the final ordered accepted IDs to
`revise_entry_media`; historical membership and order remain immutable.

Feed, detail, Trash and revision history render only authenticated, stripped
JPEG display derivatives. A keyboard-accessible modal offers larger inspection
and restores focus to its trigger. Originals remain private and immutable.
Delivered derivatives contain no EXIF GPS or unnecessary metadata; Odiina does
not infer location, run face recognition, send images to AI, expose filenames
as alternative text, or make storage paths public.

Profile avatar/banner purposes remain distinct. Entry media cannot be attached
to Profile slots, Profile media cannot enter Entry revisions, and Profile Image
Entry statistics count only accepted media in the current active revision.
