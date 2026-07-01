// AC: "Integrity test over a large event run (target 10,000 events)."
// Bulk-inserts 10,000 hash-linked rows, then verifies the full chain in one pass.
// Uses direct DB inserts rather than appendAuditEvent to avoid the serial advisory-lock
// overhead of 10k individual transactions — the goal is to stress-test verifyChain's
// correctness and performance at scale, not appendAuditEvent's throughput.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { canonicalJson, sha256Hex, toCanonicalTimestamp } from '@mat-inspect/shared-crypto';

const ACTOR_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const GENESIS_HASH = '0'.repeat(64);
const BATCH_SIZE = 500;
const TOTAL = 10_000;

describe('chain integrity at scale (10,000 events)', () => {
  let container: StartedPostgreSqlContainer;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['AUDIT_INGEST_TOKEN'] = 'load-test-token';

    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env['DATABASE_URL'] = container.getConnectionUri();

    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { sql } = await import('drizzle-orm');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const migrationDb = drizzle(container.getConnectionUri());
    // The migration GRANTs to audit_writer; the role must exist or Postgres throws.
    await migrationDb.execute(sql`CREATE ROLE audit_writer`);
    await migrate(migrationDb, {
      migrationsFolder: path.join(__dirname, '../../db/migrations'),
    });

    const { resetConfigForTest } = await import('../lib/config.js');
    resetConfigForTest();
  }, 120_000);

  afterAll(async () => {
    await container.stop();
  });

  it(`verifyChain returns ok: true for ${TOTAL} chained events`, async () => {
    // Build and bulk-insert the rows, maintaining correct prev_hash -> this_hash linkage.
    const { db, auditEvents } = await import('../db/index.js');

    let prevHash = GENESIS_HASH;
    const rowBuffer: (typeof auditEvents.$inferInsert)[] = [];
    let inserted = 0;

    const flush = async () => {
      if (rowBuffer.length === 0) return;
      await db.insert(auditEvents).values([...rowBuffer]);
      inserted += rowBuffer.length;
      rowBuffer.length = 0;
    };

    for (let i = 0; i < TOTAL; i += 1) {
      const id = randomUUID();
      const occurredAt = new Date();
      const payloadSummary = { idx: String(i) };
      const thisHash = sha256Hex(
        canonicalJson({
          id,
          timestamp: toCanonicalTimestamp(occurredAt),
          actorId: ACTOR_ID,
          action: 'INSPECTION_SUBMITTED',
          resourceType: 'INSPECTION',
          resourceId: randomUUID(),
          payloadSummary,
          prevHash,
        }),
      );
      rowBuffer.push({
        id,
        sourceEventId: randomUUID(),
        prevHash,
        thisHash,
        occurredAt,
        actorId: ACTOR_ID,
        action: 'INSPECTION_SUBMITTED',
        resourceType: 'INSPECTION',
        resourceId: randomUUID(),
        payloadSummary,
      });
      prevHash = thisHash;
      if (rowBuffer.length >= BATCH_SIZE) await flush();
    }
    await flush();
    expect(inserted).toBe(TOTAL);

    // Verify the full chain; capture wall-clock time as a sanity check.
    const { verifyChain } = await import('../lib/chain.js');
    const start = performance.now();
    const result = await verifyChain();
    const elapsedMs = performance.now() - start;

    // Log so the wall-clock time is visible in the test report without failing on a specific
    // threshold — the AC asks for integrity, not a perf benchmark.
    process.stdout.write(`verifyChain(${TOTAL} events): ${elapsedMs.toFixed(0)} ms\n`);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.checked).toBe(TOTAL);
    }
  }, 180_000); // 3-minute timeout for 10k rows including DB spin-up
});
