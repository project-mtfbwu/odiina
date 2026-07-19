# ADR 0002: Stable Entries with immutable revisions

Status: accepted

An Entry is a stable UUID container. Its content and occurrence facts live in
append-only revision rows. Editing locks the Entry, compares the caller's
expected current revision, inserts the next revision, and advances the exact
same-owner/same-Entry composite foreign key in one transaction.

This makes evidence traceable and gives concurrent edits deterministic
behavior: from one expected revision, exactly one update can win. Direct
authenticated DML is not granted. A deferred constraint requires every
committed Entry container to have a current revision while still allowing the
staged circular insert inside `create_entry`.
