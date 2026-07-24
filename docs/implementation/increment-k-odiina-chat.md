# Increment K — Odiina Chat

Increment K adds authenticated `/chat` and `/chat/[conversationId]` screens,
same-origin Chat APIs, private Markdown export, the compact OC product mark and
an Ask Odiina action. Desktop uses a secondary conversation rail; narrow
screens use an accessible Conversations disclosure and keep the composer above
the product navigation.

Migration `202607290001_odiina_chat.sql` adds Chat consent and quota accounting,
extends the existing AI queue with the `chat` kind, and creates forced-RLS
conversation, message, normalized source and job-link tables. Browser mutations
derive ownership from `auth.uid()`. Protected functions use a fixed empty
search path, accept no user ID and are revoked from PUBLIC and anon. The
restricted worker completes a Chat only while its lease and all three consent
switches remain valid.

The browser shows explicit retrieval, generation, citation-validation, ready,
cancel and failure states. Saved and one-hour temporary conversations support
bounded follow-ups, rename, reset context, conversion, deletion, delete-all and
authenticated no-store export. Entry/transcript citations deep-link to the
accepted source and seek to a time-coded transcript segment when available.

The fake local provider covers cited evidence, no evidence, visual limitations,
prompt-injection-shaped Entry text, unsupported-claim removal, invalid
citations, malformed/oversized output, timeout and rate-limit errors. Database
tests cover RLS, function grants, idempotency, consent cancellation, exact
sources, source lifecycle, deletion and cross-user isolation. Playwright covers
the authenticated feature at 320, 390, 768, 960, 1200 and 1440 pixels, axe,
saved/temporary history and the restricted fake-provider journey.

No live provider, embeddings, vector index, production streaming transport,
production worker runtime, autonomous action, web access or semantic memory is
claimed. See [private-odiina-chat.md](../architecture/private-odiina-chat.md).
