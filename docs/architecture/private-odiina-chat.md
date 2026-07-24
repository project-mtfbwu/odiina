# Private Odiina Chat architecture

Odiina Chat (OC) is an authenticated, read-only conversation layer over the
owner's current Odiina evidence. It is not a general assistant. It cannot browse
the web, call tools, mutate Entries, inspect image pixels, infer from
untranscribed audio/video, or answer from uncited personal knowledge.

## Retrieval and answer boundary

The server converts each question into a bounded allowlisted retrieval plan:
civil date range, lexical terms, private tag names, media kinds, optional place
label and transcript-search permission. Relative dates use the owner's current
IANA timezone and week-start preference. A follow-up may inherit only this
structured scope; raw provider prose never becomes retrieval authority.

`build_chat_evidence` queries the existing current Search projection under
forced RLS. It returns no more than 20 active current Entry revisions plus five
eligible private reports, and caps the serialized packet at 50 KiB. Transcript
text is eligible only while both transcription and transcript-Search consent
remain on. Exact coordinates, Storage object paths, deleted transcript text,
Trash and another user's rows are excluded.

The restricted AI worker sends only that packet and the question to the
configured provider. The provider has no database, browser, Storage, network
tool or mutation capability. Output is size- and schema-validated, rejects
active markup, and may cite only source IDs in the frozen packet. Invalid
citations fail closed. Unsupported content may be removed explicitly; no
evidence produces an honest no-match answer.

## Consent, retention and deletion

Chat has a separate default-off consent below the existing Master AI and
Insights switches. Turning either parent off disables Chat, cancels outstanding
Chat work and records the consent event. Semantic Memory is a separate visible
switch that is forced off: this repository has no vector extension, embedding
model or approved semantic provider.

Saved conversations are private history. Temporary conversations are excluded
from the saved list, expire within one hour and are purged at logout, explicit
deletion or the next expiry sweep. A temporary conversation can be explicitly
converted to saved before expiry. Rename and context reset do not alter source
evidence. Delete one/all removes messages, normalized citations, job links and
content snapshots while leaving original Entries, media, insights and reports
unchanged. Hosted backup retention needs a deployment policy before release.

## Source lifecycle

Citations bind to the exact accepted Entry revision, transcript segment,
insight or report. Entry revision changes mark prior citations stale. Trash
makes them unavailable; restore can make the private Entry target available
again without pretending the old answer was regenerated. Transcript deletion
and place redaction remove copied excerpts/content from affected answers.
Original evidence remains governed by its own immutable-history and deletion
rules.

## Limits and production gate

Requests are idempotent and transactionally limited to 30 questions/day,
300/month, two active AI jobs, 100 conversations and 100 messages per
conversation. The same durable leased Increment I job queue, heartbeat,
cancellation, retry, dead-letter and privacy-safe usage accounting are reused.

Only the deterministic fake provider is implemented. It is refused off
loopback and incurs no provider cost. Production Chat stays unavailable until a
live provider/model, region, retention/training terms, subprocessors, deletion,
pricing, quota behavior and durable worker deployment are explicitly approved.
The local in-memory HTTP rate limiter must also be replaced by a shared
privacy-safe adapter before public beta.
