// AC: "audit_writer role has INSERT only; UPDATE/DELETE on audit_events rejected."
// This test bootstraps the same roles + default-privilege grants that infra/docker/postgres-init.sh
// creates in Docker, then verifies the privilege boundary at the Postgres level.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

// Ephemeral credentials for the testcontainers Postgres instance — not real secrets.
const MIGRATOR_ROLE_PW = 'testonly';
const WRITER_ROLE_PW = 'testonly';

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
       VALUES ($1, $2, ${'0'.repeat(64)}, ${'a'.repeat(64)}, now(),
               $3, 'INSPECTION_SUBMITTED', 'INSPECTION', $4, '{}')`,
      [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
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
});
