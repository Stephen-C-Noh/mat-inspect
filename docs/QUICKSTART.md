# Quick Start: Running the Stack Locally

This doc covers two ways to bring the stack up. Pick Path A to see the app
running with no code changes. Pick Path B to iterate on core-api, the PWA, or
the dashboard with hot reload.

Both paths need a real `.env` file first. Get it from Stephen directly (see
[ONBOARDING.md](ONBOARDING.md) Day 2); `.env.example` alone is not enough.
core-api and the audit service validate their environment at boot (ADR 0015)
and refuse to start with a blank or placeholder `ENTRA_TENANT_ID`,
`ENTRA_CLIENT_ID`, `APPLICATIONINSIGHTS_CONNECTION_STRING`, or
`AUDIT_INGEST_TOKEN`. `NODE_ENV=test` is the only mode exempt from this check.

## Bring-up order

The dependency graph, in the order things need to exist:

1. **postgres, azurite** — infra, no dependencies.
2. **DB migrate + seed** — one-time (or after a schema change), run from the
   host. Docker does not run migrations automatically; the containers start
   `node dist/server.js` directly, nothing more.
3. **core-api** — needs postgres reachable, and needs real Entra, Application
   Insights, and audit-ingest values to pass its boot validator.
4. **media, audit** — media needs azurite; audit needs its own `audit_db`
   migration run first (separate migration, separate role: `audit_migrator`).
5. **ai** — independent of the rest. Optional: without a mounted model file it
   reports the advisory feature as `UNAVAILABLE` and submit is unaffected
   (ADR 0017, ADR 0018). Skip it unless you are testing advisory suggestions.
6. **caddy** — waits for core-api, media, audit, and ai to start (not to pass
   their healthchecks), and only matters if you are testing through the
   `mat-inspect.staging` hostname instead of `localhost`.
7. **pwa, dashboard** — logically depend on core-api to answer API calls, but
   the compose file does not declare that dependency, so they can start
   before core-api is healthy. A few failed requests or an early reload is
   expected on first boot, not a bug.

## Path A: Full stack via Docker

Use this to look at the app running, not to iterate on code.

```bash
cp .env.example .env   # then fill in the real values, see above
docker compose up -d postgres azurite
```

Run migrations and seed data from the host (needs `npm install` at the repo
root first):

```bash
cd services/core-api
npm run db:migrate     # core_db, via CORE_MIGRATOR_DB_URL
npm run db:seed        # 10 equipment + 4 checklist templates into core_db
cd ../audit
npm run db:migrate     # audit_db, via AUDIT_MIGRATOR_DB_URL
cd ../..
```

Bring up the rest:

```bash
docker compose up -d
```

Open http://localhost:3000 for the PWA and http://localhost:3001 for the
dashboard. Any authenticated screen redirects to a real "Sign in with
Microsoft" (MSAL) flow. There is no dev-token bypass: the `/dev/token`
endpoint was removed (DEV-61, ADR 0021), and Entra values must be set for
boot to succeed.

## Path B: Hybrid, for active development

Recommended when working on core-api, the PWA, or the dashboard: infra stays
in Docker, the app you are iterating on runs on the host with `npm run dev`
for hot reload.

```bash
docker compose up -d postgres azurite
```

Migrate and seed as in Path A. Then:

```bash
cd services/core-api
npm run dev
```

If you only need core-api to boot, not deliver to a real audit service, pass
dummy values inline instead of relying on `.env`'s (blank) ones:

```bash
AUDIT_SERVICE_URL=http://127.0.0.1:9 AUDIT_INGEST_TOKEN=dummy npm run dev
```

In another terminal:

```bash
cd apps/pwa
npm run dev   # port 3002, proxies /api/v1/* to core-api on 3000
```

or `apps/dashboard` (port 3001). If you need audit or media running too,
either `docker compose up -d audit media` or run them the same way as
core-api (`npm run dev` in their service folder).

**Testing an authenticated screen:** with real Entra values set, core-api
validates tokens against the real Entra JWKS and the PWA's auth guard bounces
unauthenticated users to `/login`. Someone has to click "Sign in with
Microsoft" and complete the MSAL login by hand; this step cannot be
scripted.

## Local dev ports

| App       | Docker host port    | `npm run dev` port |
| --------- | ------------------- | ------------------ |
| pwa       | 3000                | 3002               |
| dashboard | 3001                | 3001               |
| core-api  | none (behind Caddy) | 3000               |

The PWA uses 3002 on the host because core-api holds 3000 and the dashboard
holds 3001. If the PWA gets a new redirect URI, add it on the Entra app
registration. Which registration, in which tenant, and what else it holds:
[runbooks/gateway-and-device-setup.md](runbooks/gateway-and-device-setup.md).
(ONBOARDING.md used to be cited here and says nothing about Entra.)

## Databases

Postgres runs one server, two databases: `core_db` (equipment, inspections,
users) and `audit_db` (append-only `audit_events`, written only by the
`audit_writer` role: INSERT and SELECT, never UPDATE or DELETE). `psql` needs
`-d core_db` or `-d audit_db` explicitly; there is nothing useful in the
default `postgres` database.

Seeded equipment IDs are random per reseed. Read them out instead of
hardcoding:

```sql
select id, asset_tag, name from equipment;
```

## If something will not boot

Read the stderr line. core-api and audit both fail fast with
`[core-api] boot aborted: ...` or `[audit] boot aborted: ...` and list every
missing or placeholder variable at once (ADR 0015). That message names the
exact env var to fix; there is no separate troubleshooting table to consult.

### `AUDIT_MIGRATOR_DB_URL must be set` or audit migrate fails with a role/permission error

`infra/docker/postgres-init.sh` creates the `audit_migrator` and
`audit_writer` roles, but only the first time the `postgres_data` volume
initializes (Postgres's `docker-entrypoint-initdb.d` convention). If your
`.env` had blank `AUDIT_MIGRATOR_DB_PASSWORD` / `AUDIT_WRITER_DB_PASSWORD`
the first time you ever ran `docker compose up postgres` on this machine,
the role-creation step failed silently (the script uses
`ON_ERROR_STOP=1` in one heredoc, so a bad `CREATE ROLE` also skips the
statements after it) and the roles were never created. Filling in `.env`
correctly afterward does not fix an existing volume: recreating the
container re-reads `.env`, but does not re-run init scripts against a
non-empty volume.

Check whether the roles exist:

```bash
docker exec mat-inspect-postgres-1 sh -c \
  'psql -U "$POSTGRES_USER" -d audit_db -c "select rolname from pg_roles where rolname like '"'"'audit_%'"'"';"'
```

If that returns 0 rows, recreate the postgres container so it picks up the
current `.env` (safe: the volume, and any data on it, is untouched):

```bash
docker compose up -d postgres
```

Then create the roles and grants by hand, letting the container substitute
its own env vars so the passwords are never printed to your terminal (this
is the same SQL `postgres-init.sh` runs on a fresh volume, minus the
`CREATE DATABASE` lines, which only apply to a truly empty volume):

```bash
docker exec mat-inspect-postgres-1 sh -c '
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-SQL
  CREATE ROLE audit_migrator LOGIN PASSWORD '"'"'$AUDIT_MIGRATOR_DB_PASSWORD'"'"';
  CREATE ROLE audit_writer LOGIN PASSWORD '"'"'$AUDIT_WRITER_DB_PASSWORD'"'"';
SQL
'

docker exec mat-inspect-postgres-1 sh -c '
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname audit_db <<-SQL
  ALTER SCHEMA public OWNER TO audit_migrator;
  GRANT CREATE ON DATABASE audit_db TO audit_migrator;
  GRANT CONNECT ON DATABASE audit_db TO audit_writer;
  ALTER DEFAULT PRIVILEGES FOR ROLE audit_migrator IN SCHEMA public
    GRANT SELECT, INSERT ON TABLES TO audit_writer;
  ALTER DEFAULT PRIVILEGES FOR ROLE audit_migrator IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO audit_writer;
SQL
'
```

Then `npm run db:migrate` in `services/audit` should succeed. If you would
rather start clean instead of patching an existing volume, that means
dropping the `postgres_data` volume (`docker compose down -v`), which also
deletes every other table in it (`core_db` included); do not do this without
checking who else is using the volume first.

### `CORE_MIGRATOR_DB_URL must be set` or core-api migrate fails with a role/permission error

Same failure mode as above, for `core_db`'s `core_api_migrator` / `core_api_writer` roles
(DEV-146). Check whether they exist:

```bash
docker exec mat-inspect-postgres-1 sh -c \
  'psql -U "$POSTGRES_USER" -d core_db -c "select rolname from pg_roles where rolname like '"'"'core_api_%'"'"';"'
```

If that returns 0 rows, recreate the roles and grants by hand the same way as the audit roles
above (again, letting the container substitute its own env vars):

```bash
docker exec mat-inspect-postgres-1 sh -c '
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-SQL
  CREATE ROLE core_api_migrator LOGIN PASSWORD '"'"'$CORE_API_MIGRATOR_DB_PASSWORD'"'"';
  CREATE ROLE core_api_writer LOGIN PASSWORD '"'"'$CORE_API_WRITER_DB_PASSWORD'"'"';
SQL
'

docker exec mat-inspect-postgres-1 sh -c '
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname core_db <<-SQL
  ALTER SCHEMA public OWNER TO core_api_migrator;
  GRANT CREATE ON DATABASE core_db TO core_api_migrator;
  GRANT CONNECT ON DATABASE core_db TO core_api_writer;
  ALTER DEFAULT PRIVILEGES FOR ROLE core_api_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE ON TABLES TO core_api_writer;
  ALTER DEFAULT PRIVILEGES FOR ROLE core_api_migrator IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO core_api_writer;
SQL
'
```

Then `npm run db:migrate` in `services/core-api` should succeed.
