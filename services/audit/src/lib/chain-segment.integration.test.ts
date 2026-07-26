import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { computeInspectionContentHash } from '@mat-inspect/shared-crypto';
import type { ReportInspectionDetail } from '@mat-inspect/shared-schemas';

const OPERATOR_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EQUIPMENT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111';

const makeInspectionDetail = (
  overrides: Partial<ReportInspectionDetail> = {},
): ReportInspectionDetail => ({
  id: randomUUID(),
  equipmentId: EQUIPMENT_ID,
  operatorId: OPERATOR_ID,
  operatorDisplayName: 'Jane Doe',
  templateId: TEMPLATE_ID,
  templateVersion: 1,
  result: 'PASS',
  submittedAt: '2026-05-19T18:31:42.123000Z',
  responses: [
    {
      itemKey: 'brakes',
      prompt: 'Brakes engage cleanly?',
      value: true,
      passed: true,
      notes: null,
      notesSource: null,
      photoIds: [],
    },
  ],
  defects: [],
  ...overrides,
});

// Seals an inspection's audit event exactly the way core-api's outbox poller does: content_hash
// computed from the same fields, payloadSummary carrying it under the "contentHash" key
// (services/core-api/src/outbox/poller.ts buildIngestBody). Mirroring that shape, not
// reimplementing it, is what makes this test meaningful.
const sealInspectionEvent = async (inspection: ReportInspectionDetail): Promise<void> => {
  const { appendAuditEvent } = await import('./chain.js');
  const contentHash = computeInspectionContentHash({
    inspectionId: inspection.id,
    equipmentId: inspection.equipmentId,
    operatorId: inspection.operatorId,
    templateId: inspection.templateId,
    templateVersion: inspection.templateVersion,
    result: inspection.result,
    submittedAt: inspection.submittedAt,
    responses: inspection.responses.map((r) => ({
      itemKey: r.itemKey,
      value: r.value,
      passed: r.passed,
      notes: r.notes,
      notesSource: r.notesSource,
      photoIds: r.photoIds,
    })),
  });
  await appendAuditEvent({
    sourceEventId: randomUUID(),
    action: 'INSPECTION_SUBMITTED',
    actorId: inspection.operatorId,
    resourceType: 'INSPECTION',
    resourceId: inspection.id,
    occurredAt: new Date(inspection.submittedAt),
    payloadSummary: {
      inspectionId: inspection.id,
      equipmentId: inspection.equipmentId,
      operatorId: inspection.operatorId,
      result: inspection.result,
      contentHash,
    },
  });
};

describe('chain-segment (DEV-38 export-time verification)', () => {
  let container: StartedPostgreSqlContainer;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['AUDIT_INGEST_TOKEN'] = 'test-token';

    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env['DATABASE_URL'] = container.getConnectionUri();

    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { sql } = await import('drizzle-orm');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const migrationDb = drizzle(container.getConnectionUri());
    await migrationDb.execute(sql`CREATE ROLE audit_writer`);
    await migrate(migrationDb, { migrationsFolder: path.join(__dirname, '../../db/migrations') });
    await migrationDb.$client.end();

    const { resetConfigForTest } = await import('./config.js');
    resetConfigForTest();
  }, 120_000);

  afterAll(async () => {
    const { db } = await import('../db/index.js');
    await db.$client.end();
    await container.stop();
  });

  it('flags an inspection with no matching audit event, without throwing', async () => {
    const { buildChainSegmentForInspections } = await import('./chain-segment.js');
    const inspection = makeInspectionDetail();

    const result = await buildChainSegmentForInspections([inspection]);

    expect(result.digestChecks).toEqual([
      { inspectionId: inspection.id, auditEventFound: false, digestMatches: null },
    ]);
    expect(result.chainOk).toBe(true);
    expect(result.segment).toEqual([]);
  });

  it('reports a match when core_db data still hashes to the sealed digest', async () => {
    const { buildChainSegmentForInspections } = await import('./chain-segment.js');
    const inspection = makeInspectionDetail();
    await sealInspectionEvent(inspection);

    const result = await buildChainSegmentForInspections([inspection]);

    expect(result.digestChecks).toEqual([
      { inspectionId: inspection.id, auditEventFound: true, digestMatches: true },
    ]);
    expect(result.chainOk).toBe(true);
    expect(result.segment.length).toBeGreaterThan(0);
  });

  it('detects tampering: a response changed after the event was sealed no longer matches', async () => {
    const { buildChainSegmentForInspections } = await import('./chain-segment.js');
    const inspection = makeInspectionDetail();
    await sealInspectionEvent(inspection);

    // Simulates core_db data diverging from what was sealed (a bypass of the immutability
    // triggers, or a bug) - the digest recomputed from "current" data must not match.
    const tampered: ReportInspectionDetail = {
      ...inspection,
      responses: [{ ...inspection.responses[0]!, passed: false }],
    };

    const result = await buildChainSegmentForInspections([tampered]);

    expect(result.digestChecks).toEqual([
      { inspectionId: inspection.id, auditEventFound: true, digestMatches: false },
    ]);
    // The chain's own structural integrity is unaffected by a core_db-side tamper; only the
    // digest comparison catches it.
    expect(result.chainOk).toBe(true);
  });

  it('detects tampering: a photo reference changed after sealing no longer matches', async () => {
    const { buildChainSegmentForInspections } = await import('./chain-segment.js');
    const photoA = randomUUID();
    const photoB = randomUUID();
    const inspection = makeInspectionDetail({
      responses: [
        {
          itemKey: 'brakes',
          prompt: 'Brakes engage cleanly?',
          value: false,
          passed: false,
          notes: null,
          notesSource: null,
          photoIds: [photoA, photoB],
        },
      ],
    });
    await sealInspectionEvent(inspection);

    // A swapped photo reference is answer content under ADR 0023, so it must break the digest the
    // same way a changed pass/fail does.
    const tampered: ReportInspectionDetail = {
      ...inspection,
      responses: [{ ...inspection.responses[0]!, photoIds: [photoA] }],
    };

    const result = await buildChainSegmentForInspections([tampered]);

    expect(result.digestChecks).toEqual([
      { inspectionId: inspection.id, auditEventFound: true, digestMatches: false },
    ]);
    expect(result.chainOk).toBe(true);
  });

  it('surfaces a broken chain rather than reporting false confidence', async () => {
    const { buildChainSegmentForInspections } = await import('./chain-segment.js');
    const { db, auditEvents } = await import('../db/index.js');
    const { desc } = await import('drizzle-orm');
    const inspection = makeInspectionDetail();
    await sealInspectionEvent(inspection);

    // The DEV-40 immutability trigger blocks UPDATE/DELETE/TRUNCATE on audit_events, so a chain
    // can no longer be broken in place. The residual break is a direct INSERT that bypasses
    // appendAuditEvent's hashing: prev_hash links to the tail correctly, but this_hash is not the
    // recomputed value, so verifyChainSegment must catch it at this seq, not report false
    // confidence. resource_id points at this inspection so the export path walks up to this event.
    const [tail] = await db
      .select({ thisHash: auditEvents.thisHash })
      .from(auditEvents)
      .orderBy(desc(auditEvents.seq))
      .limit(1);
    await db.insert(auditEvents).values({
      sourceEventId: randomUUID(),
      prevHash: tail!.thisHash,
      thisHash: '0'.repeat(64),
      occurredAt: new Date(),
      actorId: OPERATOR_ID,
      action: 'INSPECTION_SUBMITTED',
      resourceType: 'INSPECTION',
      resourceId: inspection.id,
      payloadSummary: {},
    });

    const result = await buildChainSegmentForInspections([inspection]);

    expect(result.chainOk).toBe(false);
    expect(result.chainBrokenAtSeq).not.toBeNull();
  });
});
