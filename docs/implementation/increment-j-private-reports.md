# Increment J — private recaps, stories, export and controlled sharing

## Delivered surface

Authenticated routes are `/reports`, `/reports/new`, `/reports/[id]`,
`/reports/[id]/edit`, `/reports/[id]/share` and `/reports/[id]/print`.
`/s/[opaque-token]` is the isolated anonymous viewer. Reports are reachable
from desktop navigation and mobile Settings without crowding the bottom bar.

Daily, weekly, monthly, yearly and bounded custom creation start with a factual
source preview and an explicit private draft action. The library filters by
type and draft/ready/shared/stale state. Stories expose factual metrics,
chronological moments and selected authenticated derivatives. Editors preserve
source evidence while changing presentation. Export/share are separate
actions; nothing is published automatically.

## APIs and RPCs

Same-origin authenticated routes provide preview, create, update, insight
attachment, Markdown export, publish and revoke. They verify the server
session, CSRF and origin/host policy through existing helpers. RPCs are
`preview_factual_report`, `create_factual_report`, `update_report`,
`attach_report_insight`, `record_report_export`, `publish_report_share`,
`revoke_report_share` and disabled-intent `save_report_schedule`. Anonymous
access is limited to `resolve_report_share`.

The report source-change, place-redaction and insight-state triggers implement
staleness and prospective publication removal. Published text stays immutable;
updates require a new reviewed share.

## Certification intent

Unit coverage freezes civil boundaries, leap handling and request limits.
pgTAP covers ownership, FORCE RLS, grants, AI-off factual creation, exact
snapshots, metric derivation, private default, token hashing, narrow anonymous
resolution, expiration, revocation, Trash/restore, cross-user isolation and
place redaction. Production-mode Playwright covers all six widths, axe,
factual creation with AI off, curation, print HTML, Markdown privacy, explicit
sharing, anonymous viewing, protected routes and revocation.

The fake Increment I provider remains the only automated AI provider. No live
provider, report worker, export worker, scheduler, anonymous media or generated
PDF exists. See `docs/architecture/private-reports-sharing.md` for the threat
model and release gates.
