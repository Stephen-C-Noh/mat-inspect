# ADR 0014: Fail-Closed Route Authorization Guard at Boot

Date: 2026-06-12
Status: Accepted

## Context

CLAUDE.md (Auth) states the rule: "Endpoints without a declared role fail closed (return
403)." Until now nothing enforced it. Authorization is declared per route through the
`requireRole(...)` preHandler (there is no central `policy.ts`; that file named in CLAUDE.md
Section 8 was never built). A developer who registers a route and forgets the `preHandler`
gets a working, unauthenticated endpoint. The mistake is silent: the route returns 200 to any
caller, and no test fails unless someone wrote one for that specific route.

DEV-25 verifies the App Role claims flow end-to-end. Part of that verification is proving the
fail-closed rule is real, not aspirational.

## Decision

core-api registers an `onRoute` hook (`registerAuthRouteGuard`, wired in `buildApp` before any
route). For every route registered after it, the hook checks the route's preHandlers for one
tagged as an authenticator. `verifyToken` and the function returned by `requireRole(...)` carry
a `Symbol.for('mat-inspect.authPreHandler')` marker. If no tagged preHandler is present and the
route's URL is not in an explicit public allowlist, the hook throws and the boot crashes.

The public allowlist is `['/health', '/dev/jwks', '/dev/token']`. `/health` is the liveness
probe. The `/dev/*` routes are the dev-only JWKS and token issuer, registered only outside
production. Listing them by name keeps the auth-bypass surface visible.

The guard fails at route registration (boot), not at request time with a 403. A misgated route
never starts serving, which is stronger than returning 403 per request: the defect cannot reach
a running deployment. This satisfies the intent of the CLAUDE.md rule.

## Consequences

Positive: forgetting to declare a role is now a crash at boot, caught in dev and CI, not a
silent open endpoint. The marker plus allowlist make "is this route gated" answerable in one
place, which is the seam a future central permission matrix would grow from.

Negative: a genuinely public route must be added to the allowlist by hand, or the boot fails.
This is intentional friction. Adding a public endpoint is a security-relevant act and should be
explicit. The marker also couples the guard to the two auth preHandlers; a third auth mechanism
must carry the same marker to be recognized.

## Alternatives Considered

- **Global preHandler that returns 403 at request time.** Rejected: it enforces the rule only
  when a request arrives, so a misgated route can ship and is caught only if exercised. The boot
  guard removes the route from any running build.
- **A test that asserts every registered route has an auth preHandler, no runtime change.**
  Rejected: it relies on the test being kept in sync and does not protect a build that skips the
  test. The runtime guard protects every boot, including production.
- **Build the central `policy.ts` matrix now and gate through it.** Rejected as out of scope for
  DEV-25, which is a verification ticket. A central matrix is an architectural change that needs
  its own ADR. The inline `requireRole` model is verified as-is; the guard is the first step
  toward a matrix if endpoint count or permission granularity later justifies one.
