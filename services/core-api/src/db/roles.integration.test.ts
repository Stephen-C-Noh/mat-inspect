// DEV-146 AC1 / AC4: "A scoped core_api role... no blanket owner privileges" and "the
// inspections_no_update/inspection_responses_no_update and the new outbox trigger cannot be
// disabled by the role core-api's own service connection uses." This test bootstraps the same
// roles + default-privilege grants that infra/docker/postgres-init.sh creates in Docker, then
// verifies the privilege boundary at the Postgres level, mirroring
// services/audit/src/db/roles.integration.test.ts.
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

describe('core_db role privileges', () => {
  let container: StartedPostgreSqlContainer;
  let suPool: pg.Pool;
  let writerPool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();

    // Superuser connection: create roles, run migrations.
    suPool = new pg.Pool({ connectionString: container.getConnectionUri() });

    // Bootstrap roles + default privileges, mirroring infra/docker/postgres-init.sh.
    await suPool.query(`
      CREATE ROLE core_api_migrator LOGIN PASSWORD '${MIGRATOR_ROLE_PW}';
      CREATE ROLE core_api_writer   LOGIN PASSWORD '${WRITER_ROLE_PW}';
    `);
    await suPool.query(`ALTER SCHEMA public OWNER TO core_api_migrator`);
    await suPool.query(
      `GRANT CREATE ON DATABASE "${container.getDatabase()}" TO core_api_migrator`,
    );
    await suPool.query(`
      ALTER DEFAULT PRIVILEGES FOR ROLE core_api_migrator IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE ON TABLES TO core_api_writer;
      ALTER DEFAULT PRIVILEGES FOR ROLE core_api_migrator IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO core_api_writer;
    `);

    // Run migrations as the migrator role. Pass the connection string directly to drizzle() to
    // avoid a @types/pg version conflict between drizzle-orm's nested types and the root
    // workspace types (same fix applied in db/migrate.ts).
    const migratorUri = container
      .getConnectionUri()
      .replace(/\/\/[^@]+@/, `//core_api_migrator:${MIGRATOR_ROLE_PW}@`);
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const migratorDb = drizzle(migratorUri);
    await migrate(migratorDb, {
      migrationsFolder: path.join(__dirname, '../../../../db/migrations'),
    });
    await migratorDb.$client.end();

    // Writer connection: runtime role under test (the role core-api's own DATABASE_URL uses).
    const writerUri = container
      .getConnectionUri()
      .replace(/\/\/[^@]+@/, `//core_api_writer:${WRITER_ROLE_PW}@`);
    writerPool = new pg.Pool({ connectionString: writerUri });
  }, 120_000);

  afterAll(async () => {
    await writerPool?.end();
    await suPool?.end();
    await container?.stop();
  });

  const insertEquipment = () =>
    writerPool.query(
      `INSERT INTO equipment (id, asset_tag, name, type)
       VALUES ($1, $2, 'Test Crane', 'OVERHEAD_CRANE') RETURNING id`,
      [randomUUID(), `TAG-${randomUUID()}`],
    );

  it('core_api_writer can INSERT and SELECT equipment', async () => {
    const res = await insertEquipment();
    expect(res.rows).toHaveLength(1);
    const select = await writerPool.query(`SELECT * FROM equipment WHERE id = $1`, [
      res.rows[0].id,
    ]);
    expect(select.rows).toHaveLength(1);
  });

  it('core_api_writer can UPDATE equipment', async () => {
    const res = await insertEquipment();
    await expect(
      writerPool.query(`UPDATE equipment SET status = 'READY' WHERE id = $1`, [res.rows[0].id]),
    ).resolves.toBeDefined();
  });

  it('core_api_writer cannot DELETE from equipment', async () => {
    const res = await insertEquipment();
    await expect(
      writerPool.query(`DELETE FROM equipment WHERE id = $1`, [res.rows[0].id]),
    ).rejects.toThrow(/permission denied/i);
  });

  describe('trigger ownership (DEV-146 AC4)', () => {
    // core_api_writer must not be able to disable the immutability triggers using the same
    // connection core-api's normal operation uses; only the owning role (core_api_migrator) or a
    // superuser can. This is what makes the trigger defense-in-depth real instead of decorative.
    it('cannot disable the inspections immutability trigger', async () => {
      await expect(
        writerPool.query(`ALTER TABLE inspections DISABLE TRIGGER inspections_no_update`),
      ).rejects.toThrow(/must be owner/i);
    });

    it('cannot disable the inspection_responses immutability trigger', async () => {
      await expect(
        writerPool.query(
          `ALTER TABLE inspection_responses DISABLE TRIGGER inspection_responses_no_update`,
        ),
      ).rejects.toThrow(/must be owner/i);
    });

    it('cannot disable the outbox immutability trigger', async () => {
      await expect(
        writerPool.query(`ALTER TABLE outbox DISABLE TRIGGER outbox_no_mutate`),
      ).rejects.toThrow(/must be owner/i);
    });
  });

  describe('outbox immutability trigger (DEV-146 AC2, migration 0011)', () => {
    const insertOutboxRow = () =>
      writerPool.query(
        `INSERT INTO outbox (id, event_type, payload) VALUES ($1, 'INSPECTION_SUBMITTED', '{"a":1}') RETURNING id`,
        [randomUUID()],
      );

    it('core_api_writer can INSERT into outbox', async () => {
      await expect(insertOutboxRow()).resolves.toBeDefined();
    });

    it('allows updating processed_at', async () => {
      const res = await insertOutboxRow();
      await expect(
        writerPool.query(`UPDATE outbox SET processed_at = now() WHERE id = $1`, [res.rows[0].id]),
      ).resolves.toBeDefined();
    });

    it('rejects a payload change even though the role has UPDATE', async () => {
      const res = await insertOutboxRow();
      await expect(
        writerPool.query(`UPDATE outbox SET payload = '{"a":2}' WHERE id = $1`, [res.rows[0].id]),
      ).rejects.toThrow(/immutable/i);
    });

    it('rejects an event_type change even though the role has UPDATE', async () => {
      const res = await insertOutboxRow();
      await expect(
        writerPool.query(`UPDATE outbox SET event_type = 'DEFECT_RESOLVED' WHERE id = $1`, [
          res.rows[0].id,
        ]),
      ).rejects.toThrow(/immutable/i);
    });

    // created_at is what the recovery runbook's outbox reset query filters on (section 5); if it
    // were forgeable, core_api_writer's table-wide UPDATE grant would let a compromised process
    // dodge that reset window even though it cannot touch payload directly.
    it('rejects a created_at change even though the role has UPDATE', async () => {
      const res = await insertOutboxRow();
      await expect(
        writerPool.query(`UPDATE outbox SET created_at = now() - interval '1 day' WHERE id = $1`, [
          res.rows[0].id,
        ]),
      ).rejects.toThrow(/immutable/i);
    });

    it('core_api_writer cannot DELETE from outbox (role grant)', async () => {
      const res = await insertOutboxRow();
      await expect(
        writerPool.query(`DELETE FROM outbox WHERE id = $1`, [res.rows[0].id]),
      ).rejects.toThrow(/permission denied/i);
    });

    // Run as suPool, not writerPool: the role GRANT already blocks writerPool (tested above).
    // This proves the trigger itself fires, independent of role privileges.
    it('rejects DELETE even for a superuser connection', async () => {
      const res = await insertOutboxRow();
      await expect(
        suPool.query(`DELETE FROM outbox WHERE id = $1`, [res.rows[0].id]),
      ).rejects.toThrow(/immutable/i);
    });

    it('rejects TRUNCATE even for a superuser connection', async () => {
      await insertOutboxRow();
      await expect(suPool.query(`TRUNCATE outbox`)).rejects.toThrow(/immutable/i);
    });
  });
});
