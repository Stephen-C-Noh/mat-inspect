# Runbook: Entra Test Users and Tokens for Role Verification

Covers DEV-25. Lists the test identities that exercise every App Role and shows how to
obtain a bearer token for each, both against the dev token issuer and against the real Entra
tenant. No secrets are recorded here.

## App Roles

The app registration defines four App Roles (ADR 0002, ARCHITECTURE.md Section 4):
`operator`, `supervisor`, `manager`, `admin`. A user may hold more than one. The `roles`
claim on the access token carries the assigned roles.

Auditor is a reporting persona, not an Entra App Role (settled in DEV-30). It is not gated by
`requireRole`, so it has no test user here. Auditor access is covered by the reporting
endpoints, not by a role claim.

## Test users (personal dev tenant)

Development runs against the team personal Entra tenant (`lowell2753gmail.onmicrosoft.com`),
not the SAIT tenant (see the project note on the personal dev tenant). The accounts below
already have their App Roles assigned in that tenant. The `oid` is the Entra Object ID, which
equals the token `oid` claim and `req.user.id` in core-api.

| Role       | upn (sign-in)                                   | oid (object id)                      | Notes                                 |
| ---------- | ----------------------------------------------- | ------------------------------------ | ------------------------------------- |
| operator   | test-operator1@lowell2753gmail.onmicrosoft.com  | 2fad0aa0-bc0d-4106-aea3-8604d37a5a0d | Submits inspections. Operator2 spare. |
| supervisor | Test-Supervisor@lowell2753gmail.onmicrosoft.com | 54448301-a695-48c3-a8d1-01a2ababee60 | Reviews equipment status.             |
| manager    | Test-Manager@lowell2753gmail.onmicrosoft.com    | caa3d255-6115-4e9a-af32-0bb02e19de97 | Dashboard, manager actions.           |
| admin      | Test-Admin@lowell2753gmail.onmicrosoft.com      | 2f273cee-72e7-4f33-b3d7-8c6d4d1aa49d | Publishes checklist templates.        |

A second operator account, `Test-Operator2@lowell2753gmail.onmicrosoft.com`
(oid `782b9d28-2764-47e3-90c2-852c5c239ca2`), exists as a spare for multi-operator scenarios.
A `Test-Auditor@lowell2753gmail.onmicrosoft.com` account
also exists; Auditor is a reporting persona, not an App Role gated by `requireRole`, so it is
not part of the role matrix above.

At handover, recreate these users and role assignments in the SAIT tenant and update the
table. The tenant and client IDs move too (see the personal-dev-tenant project note).

## Getting a token

### Real Entra access token

The token is scoped to `api://{clientId}/access_as_user` (ADR 0012) and sent as
`Authorization: Bearer <token>`. Its `aud` equals `ENTRA_CLIENT_ID` and its `roles` claim
lists the user's App Roles.

Two ways to obtain one by hand:

1. Device code flow, covers all four roles uniformly. Run `scripts/get-entra-token.mjs` with
   the root `.env` so the tenant and client ids inject at runtime:

   ```
   node --env-file=.env scripts/get-entra-token.mjs --role admin --call http://localhost:3000
   ```

   Sign in as that role's test user at the printed URL. The script prints `roles`, `aud`,
   `oid`, and `upn`, and with `--call` it hits core-api and prints allow/deny per endpoint.
   The app registration must have "Allow public client flows" enabled for the device code
   flow to issue a token without a client secret. The PWA (SPA, PKCE) does not need this
   toggle, so keep it off by default and enable it only while running this script, then turn
   it off again (least privilege).

2. PWA login, copy the access token from the browser. The PWA acquires the access token and
   sends it to core-api, so the `Authorization` header on an `/api/v1` request carries a real
   token. The PWA only admits operator and supervisor (`ALLOWED_ROLES`), so this path does
   not cover manager or admin.

core-api validates the token against the Entra JWKS endpoint through `verifyToken`. An
invalid, expired, wrong-audience, or wrong-issuer token is rejected with 401. This is
covered by `services/core-api/src/middleware/auth.test.ts`.

### Verification result (2026-06-16, dev tenant)

All four App Roles were checked end to end against core-api with real tokens. `GET
/api/v1/equipment` requires `operator`; `POST /api/v1/checklists` requires `admin`.

| Role       | roles claim      | GET /equipment | POST /checklists   |
| ---------- | ---------------- | -------------- | ------------------ |
| operator   | `["operator"]`   | 200 allow      | 403 deny           |
| supervisor | `["supervisor"]` | 403 deny       | 403 deny           |
| manager    | `["manager"]`    | 403 deny       | 403 deny           |
| admin      | `["admin"]`      | 403 deny       | allow (past authz) |

A request with no token and a request with a malformed token both returned 401, confirming
JWKS validation. Note: schema validation runs before the role check in Fastify, so a token
test that asserts 403 must send a body that passes the Zod schema, otherwise the 400 from
validation masks the role check.

### Dev token issuer (local development and tests)

When `NODE_ENV` is not `production`, core-api registers `/dev/token`. It signs a JWT with a
chosen role against an ephemeral keypair served at `/dev/jwks`. Use it for local development
and integration tests, never in production.

```
# operator token
curl 'http://localhost:3000/dev/token?role=operator&sub=test-operator-id'

# admin token
curl 'http://localhost:3000/dev/token?role=admin&sub=test-admin-id'
```

Pass the returned token as `Authorization: Bearer <token>`. Swap `role=` to
`operator`, `supervisor`, `manager`, or `admin` to exercise each role.

## What is verified

- Login succeeds for a user in each role; the `roles` claim is present and correct on the
  access token.
- `verifyToken` validates the token against the JWKS endpoint and rejects invalid or expired
  tokens (`auth.test.ts`).
- Allow and deny per role on a representative endpoint: `POST /api/v1/checklists` is
  admin-only. The role matrix in `checklists.integration.test.ts` proves admin is allowed
  and operator, supervisor, and manager are denied with 403.
- A route that declares no role and is not in the public allowlist fails closed at boot
  (ADR 0014). The `onRoute` guard throws at registration, verified by
  `services/core-api/src/middleware/route-guard.test.ts`.
