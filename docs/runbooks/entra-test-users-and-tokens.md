# Runbook: Entra Test Users and Per-Role Tokens

Supports DEV-25 (verify Entra ID login and App Role claims across all roles). This runbook lists
the test identities and shows how to obtain a token for each role, for both automated tests and
manual end-to-end verification. It contains no secrets.

## App Roles

core-api and the Audit Service authorize requests from the `roles` claim on the access token
(ADR 0012). The Entra app registration defines five App Roles. Values are lowercase to match
`UserRole` in `packages/shared-types`.

| App Role   | `roles` claim value | Example gated endpoint                    |
| ---------- | ------------------- | ----------------------------------------- |
| Operator   | `operator`          | `GET /api/v1/equipment`                   |
| Supervisor | `supervisor`        | return-to-service approval (future)       |
| Manager    | `manager`           | dashboard read endpoints (future)         |
| Admin      | `admin`             | `POST /api/v1/checklists`                 |
| Auditor    | `auditor`           | `POST /api/v1/reports/export` (Audit Svc) |

A user may hold more than one App Role; the `roles` claim is an array. Roles are not
hierarchical: `auditor` is read-only and is never inherited by, or treated as equivalent to,
`manager` or `admin`.

### Auditor was briefly a reporting persona, not an App Role — this reversed

An earlier note here (DEV-25 era) said Auditor was not an Entra App Role, per a decision recorded
against DEV-30, and that adding one needed an ADR reversing that. DEV-38 needed a read-only,
scoped export role and added it: see **ADR 0021** for the reversal and its reasoning. This
section is the update that ADR asked for; the App Roles table above is now current.

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
| Auditor    | REPLACE_ME    | REPLACE_ME               | auditor              |
| Multi-role | REPLACE_ME    | REPLACE_ME               | operator, supervisor |

## Getting a token per role

### Local and CI: dev token endpoint

For local development and integration tests, core-api exposes `/dev/token` (registered only when
`NODE_ENV !== 'production'`). It issues a signed JWT carrying the requested role, verifiable
against the matching `/dev/jwks` endpoint. No real tenant needed.

```
GET /dev/token?role=operator&sub=<any-uuid>
GET /dev/token?role=admin&sub=<any-uuid>
```

The role-matrix integration test
(`services/core-api/src/routes/role-authorization.integration.test.ts`) mints one such token per
App Role and asserts the allow/deny outcome on representative endpoints.

### Manual end-to-end: real Entra access token

To prove the real login path, acquire an **access token** (not an ID token, ADR 0012) scoped to
`api://{clientId}/access_as_user`:

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
