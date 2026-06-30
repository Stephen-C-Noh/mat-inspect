#!/usr/bin/env bash
set -euo pipefail

# Runs once, on first init of the postgres_data volume (docker-entrypoint-initdb.d semantics).
# A .sh script (not .sql) so it can read the role passwords from the environment instead of
# having them hardcoded in a committed file (CLAUDE.md: no hardcoded credentials, even dev ones).
# AUDIT_MIGRATOR_DB_PASSWORD / AUDIT_WRITER_DB_PASSWORD come from .env, same convention as
# POSTGRES_PASSWORD.
#
# Two roles, least privilege (ARCHITECTURE.md 8.4 rule 8, DEV-23):
#   - audit_migrator: owns audit_db's public schema, runs migrations (DDL only).
#   - audit_writer:   INSERT + SELECT only on audit_events. Never UPDATE or DELETE — that is the
#                     property DEV-23's acceptance criteria test directly. Granted via
#                     ALTER DEFAULT PRIVILEGES so every table audit_migrator creates (today just
#                     audit_events) is covered automatically, with no per-migration grant to
#                     remember.

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-SQL
  CREATE DATABASE core_db;
  CREATE DATABASE audit_db;
  CREATE ROLE audit_migrator LOGIN PASSWORD '$AUDIT_MIGRATOR_DB_PASSWORD';
  CREATE ROLE audit_writer LOGIN PASSWORD '$AUDIT_WRITER_DB_PASSWORD';
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname audit_db <<-SQL
  ALTER SCHEMA public OWNER TO audit_migrator;
  GRANT CONNECT ON DATABASE audit_db TO audit_writer;
  ALTER DEFAULT PRIVILEGES FOR ROLE audit_migrator IN SCHEMA public
    GRANT SELECT, INSERT ON TABLES TO audit_writer;
SQL
