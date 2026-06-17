# ADR 0014: Routes Fail Closed at Boot via an onRoute Role Guard

Date: 2026-06-16
Status: Accepted

## Context

Every core-api route declares its required role with a `requireRole(...)` preHandler
(CLAUDE.md Auth). There is no central `policy.ts`; authorization is inline per route. The
risk in an inline model is omission. A new route that forgets `requireRole(...)` is not
denied, it is open. Fastify returns 200 for a handler with no preHandler, so a missing
guard fails open. CLAUDE.md states that endpoints without a declared role must fail closed,
but nothing enforced it. The gap is invisible in review until someone notices the missing
line.

A per-request 403 default does not solve this well. It protects only the routes that pass
through a shared default, and a route registered outside that path still ships open. The
failure is also discovered late, at request time in a running deployment.

## Decision

core-api registers an `onRoute` hook (`enforceRoleGating` in
`services/core-api/src/middleware/route-guard.ts`) before any route is registered. For each
route the hook checks two things: the route URL is in an explicit public allowlist
(`PUBLIC_ROUTES`: `/health`, `/dev/jwks`, `/dev/token`), or one of the route's preHandlers
is a role guard. `requireRole(...)` tags the function it returns with the `ROLE_GUARD`
symbol, so the hook recognizes a gated route by the tag, not by name or position.

A route that satisfies neither condition makes the hook throw at registration. The throw
crashes boot. core-api does not start, so a misgated route never reaches a running
deployment.

Public routes are an allowlist by exact URL, not a convention. Adding a new unauthenticated
route is a deliberate edit to `PUBLIC_ROUTES`, visible in review.

## Consequences

Positive: a forgotten `requireRole(...)` is caught at boot, not at request time, and not in
production. The check is stronger than a per-request 403 because the deployment fails rather
than serving an open route. The inline `requireRole` model stays; routes need no extra
boilerplate, only the guard they already declare. A boot test asserts the throw.

Negative: a genuinely public route must be added to `PUBLIC_ROUTES` or boot fails. This is
intended friction. The tag couples `requireRole` and the guard through the `ROLE_GUARD`
symbol; a future role-checking preHandler that bypasses `requireRole` must carry the same
tag to be recognized.

This ADR does not introduce a central permission matrix. The matrix is deferred to a future
ADR-backed ticket if endpoint count or permission granularity later justifies one (DEV-25).
