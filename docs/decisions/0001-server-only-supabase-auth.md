# ADR 0001: Server-only Supabase session boundary

Status: accepted for vertical slice 1

## Context

Odiina requires secure HttpOnly cookies and prohibits browser JavaScript from
reading authentication tokens. Supabase's standard hybrid SSR pattern refreshes
sessions in proxy/middleware and makes session material available to both
browser and server clients. Supabase documents that HttpOnly is not generally
necessary for that hybrid model because the browser needs the refresh token.

## Decision

Odiina does not create a Supabase browser client. Browser components call only
same-origin Odiina routes. Route handlers, server components and `proxy.ts`
create independent per-request Supabase SSR clients using custom cookie storage.
Every Supabase auth cookie is forced to `HttpOnly`, `SameSite=Lax`, `Path=/`,
and `Secure` in production. Identity is authorized using `getClaims()`, not an
unverified session user object.

State-changing routes additionally require same-origin `Origin`, matching
`Host`, Fetch Metadata and a timing-safe double-submit CSRF token.

## Consequences

This is a deliberate server-only alternative, not the standard hybrid browser
pattern. Client-side Supabase APIs, Realtime authenticated channels and direct
PostgREST calls are unavailable by design. Parallel refresh and cookie-rotation
tests are a release gate because refresh-token rotation can race across
requests. The slice must not proceed to public deployment until those tests
pass against the selected hosted configuration.
