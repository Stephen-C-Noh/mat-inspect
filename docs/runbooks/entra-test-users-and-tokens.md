# Runbook: Entra Test Users and Per-Role Tokens

Supports DEV-25 (verify Entra ID login and App Role claims across all roles). This runbook lists
the test identities and shows how to obtain a token for each role, for both automated tests and
manual end-to-end verification. It contains no secrets.

## App Roles

core-api authorizes requests from the `roles` claim on the access token (ADR 0012). The Entra
app registration defines four App Roles. Values are lowercase to match `UserRole` in
`packages/shared-types`.

| App Role   | `roles` claim value | Example gated endpoint              |
| ---------- | ------------------- | ----------------------------------- |
| Operator   | `operator`          | `GET /api/v1/equipment`             |
| Supervisor | `supervisor`        | return-to-service approval (future) |
| Manager    | `manager`           | dashboard read endpoints (future)   |
| Admin      | `admin`             | `POST /api/v1/checklists`           |

A user may hold more than one App Role; the `roles` claim is an array.

### Auditor is a reporting persona, not an App Role

Auditor is not an Entra App Role and does not appear in `UserRole` or in any `requireRole(...)`
call. An auditor consumes the PDF audit reports the audit service produces from the append-only
audit chain; they do not authenticate to a role-gated core-api endpoint. This was settled in
DEV-30. Do not add an `auditor` App Role without an ADR reversing that decision.

## Test users

Five test users in the team's personal Azure tenant (the project runs on a personal tenant in
dev; see the dev-tenant note in the team's setup docs). Every App Role is exercised by at least
one user. Fill the UPN and object id columns from the Azure portal (App registrations > Users,
or Enterprise applications > Users and groups). No passwords or secrets go in this file.

| Test user  | UPN (fill in) | Object id (oid, fill in) | Assigned App Role(s) |
| ---------- | ------------- | ------------------------ | -------------------- |
| Operator   | REPLACE_ME    | REPLACE_ME               | operator             |
| Supervisor | REPLACE_ME    | REPLACE_ME               | supervisor           |
| Manager    | REPLACE_ME    | REPLACE_ME               | manager              |
| Admin      | REPLACE_ME    | REPLACE_ME               | admin                |
| Multi-role | REPLACE_ME    | REPLACE_ME               | operator, supervisor |

## Getting a token per role

### Automated tests: inject a local key set

Integration tests do not call a token endpoint. Each suite generates an ephemeral RS256 keypair,
injects the public key through `setJwksForTest` (from `@mat-inspect/shared-auth-server`), and signs
its own JWT per role with `jose`'s `SignJWT`. Verification never reaches the network, and no real
tenant is needed. This is the test-only JWKS stub; there is no `/dev/token` HTTP endpoint.

The role-matrix integration test
(`services/core-api/src/routes/role-authorization.integration.test.ts`) mints one such token per
App Role this way and asserts the allow/deny outcome on representative endpoints.

### Local manual and end-to-end: real Entra access token

The dev-only `/dev/token` and `/dev/jwks` endpoints were removed once real Entra auth was proven
end to end (DEV-61, ADR 0021). Local development uses the real "Sign in with Microsoft" (MSAL)
flow: ADR 0015 requires real Entra config in dev, so a locally-minted token would not verify
against the real Entra JWKS anyway. To call a gated endpoint by hand, acquire a real **access
token** (not an ID token, ADR 0012) scoped to `api://{clientId}/access_as_user`:

1. Sign in as the test user through the dashboard or PWA MSAL login.
2. Capture the access token the SPA sends to core-api (browser dev tools, Network tab,
   `Authorization` header), or acquire it directly with MSAL using the custom API scope.
3. Decode the token (for example at the team's preferred local JWT decoder, never paste a real
   token into a public site) and confirm:
   - `aud` equals `ENTRA_CLIENT_ID`.
   - `iss` is `https://login.microsoftonline.com/{tenantId}/v2.0`.
   - `roles` contains the expected App Role value.
4. Call a gated endpoint with the token and confirm the expected allow/deny.

## What is covered by automated tests

- Token validation (JWKS signature, expiry, tampered token, `aud`/`iss` mismatch, missing
  `roles`): `services/core-api/src/middleware/auth.test.ts`.
- Per-role allow/deny on representative endpoints:
  `services/core-api/src/routes/role-authorization.integration.test.ts`.
- Fail-closed (a route with no declared role crashes the boot, ADR 0014):
  `services/core-api/src/middleware/auth-route-guard.test.ts`.

The manual step above (real-user login per role) is the part that cannot run in CI without a live
tenant and is verified by hand using this runbook.
