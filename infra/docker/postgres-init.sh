#!/usr/bin/env bash
set -euo pipefail

# Runs once, on first init of the postgres_data volume (docker-entrypoint-initdb.d semantics).
# A .sh script (not .sql) so it can read the role passwords from the environment instead of
# having them hardcoded in a committed file (CLAUDE.md: no hardcoded credentials, even dev ones).
# AUDIT_MIGRATOR_DB_PASSWORD / AUDIT_WRITER_DB_PASSWORD / CORE_API_MIGRATOR_DB_PASSWORD /
# CORE_API_WRITER_DB_PASSWORD come from .env, same convention as POSTGRES_PASSWORD.
#
# Four roles, least privilege (ARCHITECTURE.md 8.4 rule 8, DEV-23, DEV-146):
#   - audit_migrator:     owns audit_db's public schema, runs migrations (DDL only).
#   - audit_writer:       INSERT + SELECT only on audit_events. Never UPDATE or DELETE — that is
#                         the property DEV-23's acceptance criteria test directly. Granted via
#                         ALTER DEFAULT PRIVILEGES so every table audit_migrator creates (today
#                         just audit_events) is covered automatically, with no per-migration grant
#                         to remember.
#   - core_api_migrator:  owns core_db's public schema, runs migrations (DDL only). Mirrors
#                         audit_migrator (DEV-146 AC1): core-api's own runtime connection must not
#                         own the immutability triggers on inspections/inspection_responses/outbox,
#                         or it could ALTER TABLE ... DISABLE TRIGGER them (DEV-146 AC4).
#   - core_api_writer:    SELECT, INSERT, UPDATE only on core_db tables, no DELETE grant (core-api
#                         never deletes a row; see db/schema/*.ts). Unlike audit_writer this role
#                         does need UPDATE (equipment status, defect lifecycle, outbox.processed_at,
#                         etc.), so it is not a copy of audit_writer's grant set, just the same
#                         separate-role pattern.

# Fail fast on a missing password rather than silently create a passwordless-looking login role.
# `set -u` above does not catch this: docker compose maps an unset .env var to an empty string
# (KEY: ${VAR} with no default), so the variable is always "set" from this script's point of view,
# just empty. An empty PASSWORD '' is syntactically valid to Postgres and creates a role no one
# intended, on a database that then looks fully migrated and healthy.
for _role_pw_var in AUDIT_MIGRATOR_DB_PASSWORD AUDIT_WRITER_DB_PASSWORD \
                     CORE_API_MIGRATOR_DB_PASSWORD CORE_API_WRITER_DB_PASSWORD; do
  if [ -z "${!_role_pw_var:-}" ]; then
    echo "postgres-init.sh: $_role_pw_var is empty; set it in .env before starting postgres" >&2
    exit 1
  fi
done

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-SQL
  CREATE DATABASE core_db;
  CREATE DATABASE audit_db;
  CREATE ROLE audit_migrator LOGIN PASSWORD '$AUDIT_MIGRATOR_DB_PASSWORD';
  CREATE ROLE audit_writer LOGIN PASSWORD '$AUDIT_WRITER_DB_PASSWORD';
  CREATE ROLE core_api_migrator LOGIN PASSWORD '$CORE_API_MIGRATOR_DB_PASSWORD';
  CREATE ROLE core_api_writer LOGIN PASSWORD '$CORE_API_WRITER_DB_PASSWORD';
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname audit_db <<-SQL
  ALTER SCHEMA public OWNER TO audit_migrator;
  -- CREATE ON DATABASE lets audit_migrator create schemas (drizzle's migrate() does
  -- CREATE SCHEMA IF NOT EXISTS for its journal table, even when schema already exists).
  GRANT CREATE ON DATABASE audit_db TO audit_migrator;
  GRANT CONNECT ON DATABASE audit_db TO audit_writer;
  ALTER DEFAULT PRIVILEGES FOR ROLE audit_migrator IN SCHEMA public
    GRANT SELECT, INSERT ON TABLES TO audit_writer;
  -- bigserial columns create sequences; audit_writer needs USAGE to call nextval() on INSERT.
  ALTER DEFAULT PRIVILEGES FOR ROLE audit_migrator IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO audit_writer;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname core_db <<-SQL
  ALTER SCHEMA public OWNER TO core_api_migrator;
  GRANT CREATE ON DATABASE core_db TO core_api_migrator;
  GRANT CONNECT ON DATABASE core_db TO core_api_writer;
  ALTER DEFAULT PRIVILEGES FOR ROLE core_api_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE ON TABLES TO core_api_writer;
  ALTER DEFAULT PRIVILEGES FOR ROLE core_api_migrator IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO core_api_writer;
SQL
