# ADR 0015: Validate Environment Configuration at Boot

Date: 2026-06-16
Status: Accepted

## Context

Services read configuration from environment variables scattered across modules: the database
URL in `db/index.ts`, Entra tenant and client IDs in `auth.ts` and `jwks.ts`, the Azure Monitor
connection string in `instrumentation.ts` and the media and audit `server.js` stubs. Each read
used a truthiness guard (`if (process.env.X)`) or a default.

This pattern fails on placeholder values. `.env.example` ships `APPLICATIONINSIGHTS_CONNECTION_STRING=REPLACE_ME`.
A developer who copies it to `.env` without filling it in gets a truthy string that passes the
guard, reaches `useAzureMonitor()`, and crashes every Node service on boot with
`Error: No instrumentation key or connection string was provided`. The error points at the Azure
SDK, not at the real cause (an unfilled `.env`). The same trap hits `ENTRA_TENANT_ID`: a
placeholder is truthy, so the dev-token fallback (which only runs when the var is genuinely
blank) is skipped, and auth fails with a confusing 401 instead of a clear boot error.

The failure is also late. A misconfigured production deploy with no Entra config starts, serves,
and rejects every request, because the dev-token routes are not registered in production and the
JWKS falls back to a localhost URL that does not exist.

## Decision

core-api validates the whole environment once at boot, in `services/core-api/src/lib/config.ts`,
using a Zod schema plus semantic checks. The entrypoint (`instrumentation.ts`, imported first by
`server.ts`) calls `loadConfigOrExit()` before any app module loads. On failure it writes a
clear, var-named message to stderr and exits non-zero. On success it returns a typed, resolved
`AppConfig` that `db/index.ts` and `server.ts` consume through the cached `config()` accessor.

The rules:

- A placeholder value (`REPLACE_ME`, `xxxx`, `changeme`) is rejected for any secret. A
  half-filled `.env` aborts the boot with the variable named.
- A non-blank Azure Monitor connection string must contain `InstrumentationKey=`. This is the
  shape check that the old truthiness guard lacked.
- The database URL must be present and a `postgres://` string. `CORE_API_DB_URL`'s docker host is
  rewritten to the local host, preserving the prior `db/index.ts` behavior.
- `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, and `APPLICATIONINSIGHTS_CONNECTION_STRING` are required
  in development and production, not only in production. Dev runs against a personal Entra tenant
  and a real Application Insights workspace (Entra is blocked on the SAIT tenant, so dev mirrors
  prod on a personal tenant). A blank value is a setup mistake, not a valid "off" mode. The env is
  set once per developer and does not change until production, so this is a one-time setup cost,
  not a recurring burden.
- `NODE_ENV=test` is the one exemption: the test suite (Vitest, which sets `NODE_ENV=test`) runs
  without external Azure dependencies, so the required-value checks are skipped. Placeholder and
  shape checks still apply.

`auth.ts` and `jwks.ts` still read `ENTRA_*` live from `process.env` rather than the cached
config, so tests can toggle them per case. The boot validation guarantees those values are present
and valid in development and production; the live read is for test ergonomics, not a second source
of truth.

The media and audit services are single-file JS stubs with no Zod or build step. They carry an
inline version of the connection-string check (same rule, clear message, fail fast) rather than a
shared Zod module, which would be disproportionate for a thirty-line stub. When those services
grow a real runtime, the check moves into a shared package.

`.env.example` keeps `REPLACE_ME` for the required secrets, with a comment stating they are
required in dev and where to obtain the real values. A fresh copy does not boot until they are
filled in, which is the intended behavior: the value is now caught with a clear message instead
of the opaque Azure SDK crash that the old placeholder produced.

## Consequences

Positive: a half-configured `.env` fails at boot with the offending variable named, instead of an
opaque SDK crash or a late 401. The placeholder trap that bit the team during DEV-24 (and the
Entra variant noted in earlier debugging) cannot recur silently. Development and production both
fail to start without auth and observability config, so dev mirrors prod and a missing value is
caught on the developer's machine, not in staging.

Negative: a developer cannot run the stack until their `.env` carries the real dev values (from
the shared personal-tenant setup). This re-blocks a teammate who only wanted to run unrelated
work, but it is the deliberate trade for dev matching prod; the failure now names the variable
and points at `.env.example`. The boot path also depends on a config module, and new required
variables must be added to the schema or boot fails. This is intentional friction, matching the
fail-closed posture of ADR 0014. `NODE_ENV=test` remains the escape hatch for CI and unit tests.

## Alternatives Considered

- **Keep the truthiness guard, just blank the placeholder in `.env.example`.** Rejected: it fixes
  the one known value but leaves the next placeholder, and the next service, exposed. The class of
  bug stays open.
- **Validate lazily at first use of each variable.** Rejected: the failure still arrives far from
  the cause and only on the code path that reads the variable. Boot validation reports every
  problem at once, before serving.
- **A shared Zod config package for all services now.** Rejected as out of scope. core-api is the
  service with real configuration surface; the media and audit stubs do not justify a build
  pipeline yet. The inline check applies the same rule until they do.
