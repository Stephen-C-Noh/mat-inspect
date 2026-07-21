# ADR 0021: Remove the Dev-Only /dev/token and /dev/jwks Endpoints

Date: 2026-07-21
Status: Proposed

Amends the dev-token portions of ADR 0012, ADR 0014, and ADR 0015. This is a security-sensitive
auth change; per the AI Usage Guide it needs team discussion and two human reviewers before the
status moves to Accepted.

## Context

core-api shipped a dev-only token issuer. `services/core-api/src/routes/dev-token.ts`
generated an ephemeral RS256 keypair at startup, served the public key at `/dev/jwks`, and
minted locally-signed JWTs at `/dev/token?role=...`. The routes were registered only when
`NODE_ENV !== 'production'` and listed by name in the fail-closed public allowlist (ADR 0014).
The shared verifier (`packages/shared-auth-server`) carried a matching fallback: when
`ENTRA_TENANT_ID` was blank it fetched signing keys from a dev JWKS URL instead of the real
Entra endpoint (ADR 0015). The gateway exposed `/dev/*` on its loopback dev listener, and the
PWA rewrote `/dev/*` to the gateway in development.

This scaffolding existed because the real Entra access-token path was not yet proven. Two
changes closed that gap:

- DEV-30 verified the real Entra access-token contract (custom API scope, `aud`, `iss`, and
  `roles` claim) end to end.
- DEV-26 built the PWA MSAL flow. `apps/pwa` now acquires a real access token through
  `acquireAccessToken` and no longer calls `/dev/token`.

Two facts make the endpoints dead in every environment that runs today:

- ADR 0015 requires `ENTRA_TENANT_ID` and `ENTRA_CLIENT_ID` in development and production. Only
  `NODE_ENV=test` may omit them. So outside tests the verifier always resolves the real Entra
  JWKS and applies the issuer and audience checks. A `/dev/token` token (no `aud`, `tid:
dev-tenant`, signed by the ephemeral dev key) fails verification. The endpoint cannot be used
  in development or production.
- The integration tests do not call `/dev/token`. They inject a local key set through the
  `setJwksForTest` seam and mint their own tokens with `SignJWT`. This is the test-only JWKS
  stub the endpoint's removal was gated on.

What remained was a route that mints arbitrary-role tokens, plus a verifier fallback that dials
it, both reachable in no supported environment. That is dead code and a latent auth-bypass
surface. CLAUDE.md forbids auth-bypass patterns, and ADR 0014 keeps the bypass surface minimal
and visible on purpose.

## Decision

Remove the dev-token mechanism end to end.

- Delete `services/core-api/src/routes/dev-token.ts` and its conditional registration in
  `app.ts`.
- Remove `/dev/jwks` and `/dev/token` from the fail-closed public allowlist
  (`PUBLIC_ROUTES` is now `['/health']`).
- Remove the dev-JWKS fallback from the shared verifier. `resolveJwksUri` builds the Entra keys
  URL from `ENTRA_TENANT_ID` and throws if it is blank. The boot validator (ADR 0015) already
  guarantees a value outside tests, and tests inject keys through `setJwksForTest`, so the
  throw is a belt-and-suspenders guard, not a runtime path. The `devJwksUri` option and the
  `DEV_JWKS_URL` environment variable are gone.
- Remove the `/dev/*` handle from the Caddy dev listener and the `/dev/*` rewrite from the PWA
  `next.config.ts`.

Identity in every environment now comes from a real Entra access token, validated by the one
shared verifier. Tests remain self-contained through `setJwksForTest`.

## Consequences

Positive: the auth-bypass surface is gone, not just gated. There is no route that issues a
token for any role, and no verifier path that trusts a non-Entra key set. The fail-closed
allowlist holds one entry (`/health`), so "which routes are public" has the shortest possible
answer. Dev and prod both authenticate the same way the tests assert, which removes a class of
"works in dev, not in prod" auth drift. No test or PWA change was needed, because neither
depended on the live route.

Negative: a developer who wants to call a gated endpoint by hand (curl, a REST client) must
acquire a real Entra access token through the MSAL login rather than fetch one from
`/dev/token`. This was already the case in practice: ADR 0015 requires real Entra config in
dev, so a `/dev/token` token would not have verified. The runbook
(`docs/runbooks/entra-test-users-and-tokens.md`) documents the real-token path and the
`setJwksForTest` seam for automated tests.

## Alternatives Considered

- **Keep `/dev/token` for local dev and tests (current state).** Rejected: the tests do not use
  it, and it cannot be used in development because ADR 0015 requires real Entra config, which
  makes the verifier reject a dev token. Keeping it retains dead code and an auth-bypass surface
  for no benefit.
- **Restrict it further (extra guards, bind to loopback, feature flag) instead of removing.**
  Rejected: the endpoint has no remaining consumer, so hardening it protects nothing. The
  minimal and honest state is to remove it.
- **Remove the core-api routes but leave the shared-auth-server dev-JWKS fallback in place.**
  Rejected: the fallback's only purpose was to verify `/dev/token` tokens against `/dev/jwks`.
  With the routes gone it dials a host that no longer exists and its comments describe a
  mechanism that is no longer there. Leaving it is exactly the half-removed dead code this
  ticket exists to clean up.
