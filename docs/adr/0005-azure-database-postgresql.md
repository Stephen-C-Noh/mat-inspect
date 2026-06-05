# ADR 0005: Azure Database for PostgreSQL for Production

Date: 2026-06-01
Status: Accepted

## Context

The original architecture ran PostgreSQL 16 as a self-hosted Docker container alongside
the application services. This works on the mini-PC and any Linux host.

The project is moving all production infrastructure to Azure. A self-hosted PostgreSQL
container on an Azure VM requires the team (and SAIT IT after handover) to manage
backups, patch the Postgres version, handle failover, and monitor disk usage. Azure
Database for PostgreSQL Flexible Server is a fully managed service that handles all of
this and is available within the Azure tenant SAIT IT already operates.

## Decision

Use Azure Database for PostgreSQL Flexible Server for production.

- **Dev and dev-staging (mini-PC):** Self-hosted PostgreSQL 16 container in Docker
  Compose, unchanged. No Azure account required for local development.
- **Production (Azure VM):** Azure Database for PostgreSQL Flexible Server. The
  `DATABASE_URL` environment variable points at the managed instance. No `postgres`
  container runs in the production Docker Compose stack.

Drizzle ORM connects via the standard PostgreSQL wire protocol. No code changes are
required between environments; only `DATABASE_URL` differs. The same Drizzle schema
files and migrations apply to both the local container and the managed server.

Recommended Flexible Server configuration for production:

- SKU: Burstable B2ms (2 vCores, 8 GB RAM); upgrade to General Purpose if load warrants
- Storage: 32 GB with auto-grow enabled
- High availability: Zone-redundant standby (optional; SAIT IT decision at provisioning)
- Backup: 7-day automated backups with geo-redundancy (aligns with the 7-year record
  retention policy; exports older than 7 days move to archive storage)
- TLS: enforced (`require_secure_transport = ON`)

## Operational Notes

The claim above that only `DATABASE_URL` differs holds for the schema and migrations.
Two production steps still differ from the dev container. Both are connection or
provisioning concerns, not code or schema changes.

- TLS in the connection string. The managed server enforces TLS
  (`require_secure_transport = ON`) and refuses unencrypted connections. The
  application sets no SSL options in code; the `pg` pool reads only the connection
  string. The production `DATABASE_URL` must include `sslmode=require`, for example
  `postgresql://user:pass@host:5432/core_db?sslmode=require`. Without it the driver
  connects without TLS and the server rejects the connection.
- Database creation. The dev container creates `core_db` and `audit_db` through the
  Docker init script (`infra/docker/postgres-init.sql`). Flexible Server has no
  equivalent init hook. Create both databases on the managed instance (Azure CLI or
  portal) before the first migration runs.

## Consequences

Positive: SAIT IT inherits a managed database with automated backups, patching, and
monitoring built in; no Postgres container to run in production; TLS enforced by the
managed service; connection string change only, no code changes; dev-staging on the
mini-PC is unaffected.

Negative: Production requires an Azure Database for PostgreSQL instance to be provisioned
before first deploy; cost is higher than a self-hosted container (Burstable B2ms is
approximately $30 to $50 USD/month); the managed server is not in the Docker Compose
file, so the production compose file differs from dev in that one respect.

## Alternatives Considered

Self-hosted PostgreSQL in Docker on the Azure VM (original architecture): simpler,
no managed service cost. Rejected because SAIT IT inherits the operational burden of
backups, patching, and disk management; inconsistent with the move to Azure-managed
services.

Azure SQL Database: Microsoft SQL engine; requires query changes and Drizzle driver swap.
Rejected; no benefit over Postgres Flexible Server for this workload.
