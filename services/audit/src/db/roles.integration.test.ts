// AC: "audit_writer role has INSERT only; UPDATE/DELETE on audit_events rejected."
// This test bootstraps the same roles + default-privilege grants that infra/docker/postgres-init.sh
// creates in Docker, then verifies the privilege boundary at the Postgres level.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

// Throwaway passwords created inside the ephemeral testcontainer and dropped with it.
// Not real credentials: the container is never reachable outside the test process.
const MIGRATOR_ROLE_PW = 'testonly-ephemeral'; // gitleaks:allow
const WRITER_ROLE_PW = 'testonly-ephemeral'; // gitleaks:allow

describe('audit_events role privileges', () => {
  let container: StartedPostgreSqlContainer;
  let suPool: pg.Pool;
  let writerPool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();

    // Superuser connection: create roles, run migrations.
    suPool = new pg.Pool({ connectionString: container.getConnectionUri() });

    // Bootstrap roles + default privileges, mirroring postgres-init.sh.
    await suPool.query(`
      CREATE ROLE audit_migrator LOGIN PASSWORD '${MIGRATOR_ROLE_PW}';
      CREATE ROLE audit_writer   LOGIN PASSWORD '${WRITER_ROLE_PW}';
    `);
    await suPool.query(`ALTER SCHEMA public OWNER TO audit_migrator`);
    // drizzle's migrate() runs CREATE SCHEMA IF NOT EXISTS even when migrationsSchema is set,
    // which requires db-level CREATE. Mirror the GRANT from infra/docker/postgres-init.sh.
    await suPool.query(`GRANT CREATE ON DATABASE "${container.getDatabase()}" TO audit_migrator`);
    await suPool.query(`
      ALTER DEFAULT PRIVILEGES FOR ROLE audit_migrator IN SCHEMA public
        GRANT SELECT, INSERT ON TABLES TO audit_writer;
      ALTER DEFAULT PRIVILEGES FOR ROLE audit_migrator IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO audit_writer;
    `);

    // Run migrations as the migrator role. Pass the connection string directly to drizzle()
    // to avoid a @types/pg version conflict between drizzle-orm's nested types and the root
    // workspace types (same fix applied in db/migrate.ts).
    const migratorUri = container
      .getConnectionUri()
      .replace(/\/\/[^@]+@/, `//audit_migrator:${MIGRATOR_ROLE_PW}@`);
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const migratorDb = drizzle(migratorUri);
    await migrate(migratorDb, {
      migrationsFolder: path.join(__dirname, '../../db/migrations'),
      migrationsSchema: 'public',
    });
    await migratorDb.$client.end();

    // Writer connection: runtime role under test.
    const writerUri = container
      .getConnectionUri()
      .replace(/\/\/[^@]+@/, `//audit_writer:${WRITER_ROLE_PW}@`);
    writerPool = new pg.Pool({ connectionString: writerUri });
  }, 120_000);

  afterAll(async () => {
    await writerPool?.end();
    await suPool?.end();
    await container?.stop();
  });

  const insertOne = () =>
    writerPool.query(
      `INSERT INTO audit_events
         (id, source_event_id, prev_hash, this_hash, occurred_at, actor_id, action,
          resource_type, resource_id, payload_summary)
       VALUES ($1, $2, $3, $4, now(),
               $5, 'INSPECTION_SUBMITTED', 'INSPECTION', $6, '{}')`,
      [randomUUID(), randomUUID(), '0'.repeat(64), 'a'.repeat(64), randomUUID(), randomUUID()],
    );

  it('audit_writer can INSERT into audit_events', async () => {
    await expect(insertOne()).resolves.toBeDefined();
  });

  it('audit_writer cannot UPDATE audit_events', async () => {
    await insertOne();
    await expect(
      writerPool.query(
        `UPDATE audit_events SET this_hash = '${'0'.repeat(64)}' WHERE seq = (SELECT max(seq) FROM audit_events)`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('audit_writer cannot DELETE from audit_events', async () => {
    await insertOne();
    await expect(
      writerPool.query(`DELETE FROM audit_events WHERE seq = (SELECT max(seq) FROM audit_events)`),
    ).rejects.toThrow(/permission denied/i);
  });

  // report_jobs (DEV-38) deliberately does NOT inherit the audit_events append-only property: it
  // is a mutable job-status table, not an evidentiary record, and its migration adds an explicit
  // table-scoped GRANT UPDATE rather than widening the ALTER DEFAULT PRIVILEGES above (which would
  // have silently loosened audit_events too, and every future table). This asserts that grant
  // actually took effect, the same way the tests above assert audit_events' privileges did.
  const insertJob = () =>
    writerPool.query(
      `INSERT INTO report_jobs (id, requested_by, format, filters, options)
       VALUES ($1, $2, 'PDF', '{}', '{}')`,
      [randomUUID(), randomUUID()],
    );

  it('audit_writer can INSERT and UPDATE report_jobs', async () => {
    await expect(insertJob()).resolves.toBeDefined();
    await expect(
      writerPool.query(
        `UPDATE report_jobs SET status = 'READY' WHERE id = (SELECT id FROM report_jobs ORDER BY created_at DESC LIMIT 1)`,
      ),
    ).resolves.toBeDefined();
  });
});
