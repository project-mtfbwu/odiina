# Odiina V1 product handoff

## Product definition

Odiina is a private raw-life and work feed that turns daily activity into
traceable personal intelligence. The repository implements the V1 product
through Increment K. Odiina is a working name; `odiina.app` is a domain
placeholder only. No tagline, logo, public deployment, or live AI provider has
been approved.

## Certified increment map

| Increment | Delivered capability                                                                                                                                          | Certified commit                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| A         | Private product shell, rapid composer, chronological Feed, Entry detail/edit/revisions, Trash/restore, authentication and responsive production certification | `fd7d6df` with certification follow-up `27c7081` |
| B         | Calendar recall and explicit occurrence date/time                                                                                                             | `8f5a3ed`                                        |
| C         | Private Profile, display name, handle, bio, avatar/banner and owner statistics                                                                                | `fa98f7c`                                        |
| D         | Private photo picker, camera capture, safe processing and image Feed completion                                                                               | `05948dc`                                        |
| E         | Private voice-note capture, safe processing and playback                                                                                                      | `1f22757`                                        |
| F         | Private video capture, safe processing, poster and authorized byte-range playback                                                                             | `637bd25` with evidence follow-up `706c6f3`      |
| G         | Private place attachment, precision controls and all-history redaction                                                                                        | `5eb4a47`                                        |
| H         | Private tags and indexed Search                                                                                                                               | `aca382b` with certification follow-up `2bf2ebc` |
| H.1       | Inline hashtags and nested Bear-style tag collections                                                                                                         | `818e986`                                        |
| I         | Consent-based transcription and private evidence-linked insights                                                                                              | `25428ba`                                        |
| J         | Private factual recaps/stories, export and controlled sharing                                                                                                 | `63d2222`                                        |
| K         | Private evidence-backed Odiina Chat                                                                                                                           | `44f9170`                                        |

Increment J is a separate implementation and certification boundary. Increment
K reuses report sources during retrieval; that integration does not replace or
stand in for Increment J.

## User-visible V1

Users request an email magic link, complete timezone onboarding, and work in a
server-authenticated private application. The Feed accepts text-only,
photo-only, voice-only, video-only, place-only, and supported mixed Entries.
Occurrence time drives chronological Feed and Calendar placement. Editing
creates immutable revisions; users can inspect history, Trash, restore, and
log out.

Profile provides private identity fields, processed avatar/banner derivatives,
and owner-scoped statistics. Image, voice, and video uploads go to private
quarantine storage and become visible only after the scanner and processor
accept safe derivatives. Originals are never used for inline delivery. Place
capture is explicit and supports label-only, approximate, or exact private
storage followed by destructive all-history redaction.

Private Unicode tags can be selected or created, discovered from inline
hashtags, and organized with slash-based nested collections. Indexed Search
combines text, tags, place, date, media kind, transcript consent, and explicit
Trash scope with cursor pagination. Desktop and mobile provide accessible tag
collection navigation and active current-revision counts.

Master AI, transcription, transcript Search, insights, and Chat start off.
With explicit consent, the restricted worker can use the loopback-only fake
provider to transcribe accepted audio/video-audio and create evidence-linked
private insights. Citations bind to accepted Entry revisions and time-coded
transcript segments. Derived-data deletion leaves original Entries and media
intact.

Reports support daily, weekly, monthly, yearly, and bounded custom factual
recaps even while AI is off. Users can curate a fixed accessible story, attach
an eligible existing insight, print, export privacy-bounded Markdown, and
publish an immutable expiring/revocable text-only snapshot. Anonymous media is
not available.

Odiina Chat is an authenticated read-only conversation layer over bounded
current private Search evidence. Saved and one-hour temporary conversations
support validated citations, follow-ups, rename, context reset, conversion,
export, and deletion. Chat cannot browse, call tools, mutate Entries, inspect
image pixels, or claim knowledge without accepted evidence.

## Architecture and trust boundaries

Next.js App Router server components render private routes. Browser code calls
same-origin application endpoints and does not receive Supabase access tokens
or privileged credentials. HttpOnly cookies carry the session, and protected
mutations use verified server identity, Origin/Host enforcement, CSRF tokens,
safe errors, and bounded rate limits.

Postgres is the final authorization boundary. Private tables use forced RLS;
ownership derives from `auth.uid()`. Stable Entry rows point to an exact
owner/Entry/revision composite key. Mutation RPCs insert immutable revisions
and atomically advance the current pointer. Security-definer functions have
fixed empty search paths and narrow non-bypass owners.

Media and AI processing use separate restricted non-human identities with
leases, bounded retries, heartbeat recovery, opaque logging, and exact-object
authorization. The public report viewer uses a separate narrow database role
and only resolves hashed, expiring share tokens into immutable curated text.

## Operational boundaries

The repository is local and not deployed. Its in-memory rate limiter is not
suitable for a multi-instance public service. No live AI/transcription
provider, durable hosted worker runtime, production backup/retention policy,
anonymous media signer, scheduled report executor, server PDF renderer,
semantic memory, or production response streaming is included. Physical
iOS/Android camera, microphone, GPS and human screen-reader validation remain
manual gates.

Use synthetic fixtures for local certification. Setup and exact commands are
in the repository `README.md` and root `AGENTS.md`. Increment-specific policies
and threat models live under `docs/implementation` and `docs/architecture`.
