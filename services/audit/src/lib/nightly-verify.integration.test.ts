import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AppendAuditEventInput } from './chain.js';

const ACTOR_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RESOURCE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const makeInput = (overrides: Partial<AppendAuditEventInput> = {}): AppendAuditEventInput => ({
  sourceEventId: randomUUID(),
  action: 'INSPECTION_SUBMITTED',
  actorId: ACTOR_ID,
  resourceType: 'INSPECTION',
  resourceId: RESOURCE_ID,
  occurredAt: new Date(),
  payloadSummary: { inspectionId: RESOURCE_ID, result: 'PASS' },
  ...overrides,
});

describe('nightly full-chain verification', () => {
  let container: StartedPostgreSqlContainer;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['AUDIT_INGEST_TOKEN'] = 'nightly-test-token';

    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env['DATABASE_URL'] = container.getConnectionUri();

    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { sql } = await import('drizzle-orm');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const migrationDb = drizzle(container.getConnectionUri());
    await migrationDb.execute(sql`CREATE ROLE audit_writer`);
    await migrate(migrationDb, {
      migrationsFolder: path.join(__dirname, '../../db/migrations'),
    });
    await migrationDb.$client.end();

    const { resetConfigForTest } = await import('../lib/config.js');
    resetConfigForTest();
  }, 120_000);

  afterAll(async () => {
    const { db } = await import('../db/index.js');
    await db.$client.end();
    await container.stop();
  });

  it('records an ok: true row for an intact chain', async () => {
    const { appendAuditEvent, resetWritesFrozenForTest, isWritesFrozen } =
      await import('./chain.js');
    resetWritesFrozenForTest();
    await appendAuditEvent(makeInput());
    await appendAuditEvent(makeInput());

    const { runNightlyVerification } = await import('./nightly-verify.js');
    await runNightlyVerification();

    const { db, chainVerifications } = await import('../db/index.js');
    const { desc } = await import('drizzle-orm');
    const [latest] = await db
      .select()
      .from(chainVerifications)
      .orderBy(desc(chainVerifications.id))
      .limit(1);

    expect(latest?.ok).toBe(true);
    expect(latest?.brokenAtSeq).toBeNull();
    expect(isWritesFrozen()).toBeUndefined();
  });

  it('records an ok: false row and freezes writes when the chain is broken', async () => {
    const { appendAuditEvent, resetWritesFrozenForTest } = await import('./chain.js');
    resetWritesFrozenForTest();
    await appendAuditEvent(makeInput());

    const { db } = await import('../db/index.js');
    const { sql } = await import('drizzle-orm');
    // Simulate corruption via a privileged, deliberate trigger bypass (same technique as
    // chain.integration.test.ts) rather than weakening the immutability trigger itself.
    await db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update`);
    await db.execute(
      sql`UPDATE audit_events SET this_hash = ${'0'.repeat(64)} WHERE seq = (SELECT max(seq) FROM audit_events)`,
    );
    await db.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_update`);

    const { runNightlyVerification } = await import('./nightly-verify.js');
    await runNightlyVerification();

    const { chainVerifications } = await import('../db/index.js');
    const { desc } = await import('drizzle-orm');
    const [latest] = await db
      .select()
      .from(chainVerifications)
      .orderBy(desc(chainVerifications.id))
      .limit(1);

    expect(latest?.ok).toBe(false);
    expect(latest?.brokenAtSeq).not.toBeNull();
    expect(latest?.reason).toBeTruthy();

    const { isWritesFrozen, appendAuditEvent: appendAgain } = await import('./chain.js');
    expect(isWritesFrozen()).toBeTruthy();
    await expect(appendAgain(makeInput())).rejects.toThrow(/frozen/i);
  });
});
