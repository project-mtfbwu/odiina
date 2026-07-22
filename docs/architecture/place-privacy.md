# Private place architecture

Odiina stores an optional place snapshot against an immutable Entry revision.
The snapshot is owner-scoped by the exact composite key `(user_id, entry_id,
revision_id)` and protected by forced RLS. A place is not an attachment and no
map tile, geocoder, reverse-geocoder or nearby service is called in Increment G.

## Privacy levels

- **Label only** stores the reviewed name and optional area/address with no
  coordinates.
- **Approximate** reduces latitude and longitude in the browser to a 0.025°
  grid before submission. Odiina describes this conservatively as about 3 km
  and enforces both the grid and 3,000 metre radius marker in Postgres.
- **Exact** stores the reviewed device coordinate only after a separate,
  unchecked-by-default confirmation. It is still private, not harmless.

Current location is a one-shot browser request triggered only after Odiina
explains the request and the user selects Continue. There is no background
watch. Raw coordinates stay in component memory while the picker is open and
are neither logged nor sent elsewhere. Dismissing the picker clears that state.

## Revision and removal semantics

Normal editing creates a new immutable revision. A removed or changed current
place therefore remains as historical evidence on earlier revisions. The
separate **Remove place from all revisions** action is the privacy exception:
it clears labels, addresses, coordinates and provider identifiers across the
owned Entry while retaining only the revision relationship and a redaction
timestamp. This action is explicit, destructive and cannot be undone.

Search, nearby discovery, reverse geocoding and map presentation require a
separate provider review covering terms, data residency, retention, request
logging, accessibility, cost, key restrictions and CSP domains. They are
unavailable until that review and configuration exist.

The schema reserves vendor-neutral provider metadata for a reviewed future
migration, but Increment G's application validation and database normalizer
accept only `manual` and `device` sources and require both provider fields to be
null. This prevents a client from bypassing the disabled provider boundary by
calling an authenticated RPC directly. Existing snapshots never depend on live
provider data.
