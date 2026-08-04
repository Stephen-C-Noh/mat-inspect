import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

// No JWKS setup here. The poller sends no authenticated request, and the shared verifier builds
// its key set on first verification, so nothing in this suite reaches the network for keys.

const INGEST_TOKEN = 'poller-test-token';

describe('outbox poller', () => {
  let container: StartedPostgreSqlContainer;
  let stubServer: http.Server;
  let stubPort: number;
  let stubStatusCode = 201;
  let lastRequestBody: unknown;

  beforeAll(async () => {
    // Stub for the Audit Service (receives POST /api/v1/events from the poller).
    await new Promise<void>((resolve) => {
      stubServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            lastRequestBody = JSON.parse(body);
          } catch {
            lastRequestBody = body;
          }
          res.writeHead(stubStatusCode);
          res.end();
        });
      });
      stubServer.listen(0, '127.0.0.1', () => {
        stubPort = (stubServer.address() as { port: number }).port;
        resolve();
      });
    });

    process.env['NODE_ENV'] = 'test';
    process.env['AUDIT_SERVICE_URL'] = `http://127.0.0.1:${stubPort}`;
    process.env['AUDIT_INGEST_TOKEN'] = INGEST_TOKEN;
    delete process.env['ENTRA_TENANT_ID'];
    delete process.env['ENTRA_CLIENT_ID'];

    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env['DATABASE_URL'] = container.getConnectionUri();

    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const migrationDb = drizzle(container.getConnectionUri());
    await migrate(migrationDb, {
      migrationsFolder: path.join(__dirname, '../../../../db/migrations'),
    });
    await migrationDb.$client.end();

    const { resetConfigForTest } = await import('../lib/config.js');
    resetConfigForTest();
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => stubServer.close(() => resolve()));
    const { db } = await import('../db/index.js');
    await db.$client.end();
    await container.stop();
  });

  const insertOutboxRow = async (
    operatorId = randomUUID(),
    inspectionId = randomUUID(),
    createdAt?: Date,
  ) => {
    const { db, outbox } = await import('../db/index.js');
    const [row] = await db
      .insert(outbox)
      .values({
        eventType: 'INSPECTION_SUBMITTED',
        payload: {
          inspectionId,
          equipmentId: randomUUID(),
          operatorId,
          result: 'PASS',
          contentHash: 'a'.repeat(64),
        },
        ...(createdAt && { createdAt }),
      })
      .returning();
    return row!;
  };

  it('marks the outbox row as processed when the audit stub returns 2xx', async () => {
    stubStatusCode = 201;
    const row = await insertOutboxRow();

    const { runOutboxPollTick } = await import('./poller.js');
    await runOutboxPollTick();

    const { db, outbox } = await import('../db/index.js');
    const { eq } = await import('drizzle-orm');
    const [updated] = await db.select().from(outbox).where(eq(outbox.id, row.id));
    expect(updated?.processedAt).toBeTruthy();
  });

  it('leaves the outbox row unprocessed when the audit stub returns 5xx', async () => {
    stubStatusCode = 503;
    const row = await insertOutboxRow();

    const { runOutboxPollTick } = await import('./poller.js');
    await runOutboxPollTick();

    const { db, outbox } = await import('../db/index.js');
    const { eq } = await import('drizzle-orm');
    const [updated] = await db.select().from(outbox).where(eq(outbox.id, row.id));
    expect(updated?.processedAt).toBeNull();
  });

  it('logs a warn when the oldest unprocessed row exceeds the lag threshold', async () => {
    // try/finally: if an assertion throws mid-test, OUTBOX_LAG_WARN_MS must still be cleared,
    // or it leaks into every later test in this file (all of which use the real, unset default).
    try {
      stubStatusCode = 503; // leave the row unprocessed so lag is observable
      process.env['OUTBOX_LAG_WARN_MS'] = '1000';
      const { resetConfigForTest } = await import('../lib/config.js');
      resetConfigForTest();

      // Backdate createdAt deterministically rather than relying on real-time drift during the
      // test (which could be a few ms either side of any threshold and flake).
      await insertOutboxRow(undefined, undefined, new Date(Date.now() - 60_000));

      const { logger } = await import('../lib/logger.js');
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

      const { runOutboxPollTick } = await import('./poller.js');
      await runOutboxPollTick();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ oldestLagMs: expect.any(Number) }),
        'outbox backlog exceeds lag threshold',
      );

      warnSpy.mockRestore();
    } finally {
      delete process.env['OUTBOX_LAG_WARN_MS'];
      const { resetConfigForTest } = await import('../lib/config.js');
      resetConfigForTest();
    }
  });

  it('sends the correct payload to the audit stub', async () => {
    stubStatusCode = 200;
    const operatorId = randomUUID();
    const inspectionId = randomUUID();
    await insertOutboxRow(operatorId, inspectionId);

    const { runOutboxPollTick } = await import('./poller.js');
    await runOutboxPollTick();

    const body = lastRequestBody as Record<string, unknown>;
    expect(body['action']).toBe('INSPECTION_SUBMITTED');
    expect(body['actorId']).toBe(operatorId);
    expect(body['resourceType']).toBe('INSPECTION');
    expect(body['resourceId']).toBe(inspectionId);
    expect(typeof body['sourceEventId']).toBe('string');
  });

  // DEV-142: return-to-service.ts's payload has approvedBy + equipmentId, no operatorId or
  // inspectionId. buildIngestBody's INSPECTION_SUBMITTED-shaped defaults sent both as undefined,
  // which the Audit Service's ingest schema rejects with 400 (non-optional uuidSchema on both
  // actorId and resourceId), so these rows retried forever and never reached audit_events.
  it('maps EQUIPMENT_STATUS_CHANGED/RETURN_TO_SERVICE to approvedBy + equipmentId', async () => {
    stubStatusCode = 200;
    const { db, outbox } = await import('../db/index.js');
    const approvedBy = randomUUID();
    const equipmentId = randomUUID();
    const [row] = await db
      .insert(outbox)
      .values({
        eventType: 'EQUIPMENT_STATUS_CHANGED',
        payload: {
          equipmentId,
          from: 'OUT_OF_SERVICE',
          to: 'AWAITING_INSPECTION',
          reason: 'RETURN_TO_SERVICE',
          approvedBy,
          defectId: randomUUID(),
        },
      })
      .returning();

    const { runOutboxPollTick } = await import('./poller.js');
    await runOutboxPollTick();

    const body = lastRequestBody as Record<string, unknown>;
    expect(body['action']).toBe('EQUIPMENT_STATUS_CHANGED');
    expect(body['actorId']).toBe(approvedBy);
    expect(body['resourceType']).toBe('EQUIPMENT');
    expect(body['resourceId']).toBe(equipmentId);

    const { eq } = await import('drizzle-orm');
    const [updated] = await db.select().from(outbox).where(eq(outbox.id, row!.id));
    expect(updated?.processedAt).toBeTruthy();
  });

  // DEV-142: defects/resolve.ts's payload uses resolvedBy, not operatorId, for the actor. Same
  // failure mode as RETURN_TO_SERVICE above, confirmed against 3 permanently-stuck rows in the
  // dev-stack DB.
  it('maps DEFECT_RESOLVED to resolvedBy', async () => {
    stubStatusCode = 200;
    const { db, outbox } = await import('../db/index.js');
    const resolvedBy = randomUUID();
    const inspectionId = randomUUID();
    const [row] = await db
      .insert(outbox)
      .values({
        eventType: 'DEFECT_RESOLVED',
        payload: {
          defectId: randomUUID(),
          equipmentId: randomUUID(),
          inspectionId,
          resolvedBy,
        },
      })
      .returning();

    const { runOutboxPollTick } = await import('./poller.js');
    await runOutboxPollTick();

    const body = lastRequestBody as Record<string, unknown>;
    expect(body['action']).toBe('DEFECT_RESOLVED');
    expect(body['actorId']).toBe(resolvedBy);
    expect(body['resourceType']).toBe('INSPECTION');
    expect(body['resourceId']).toBe(inspectionId);

    const { eq } = await import('drizzle-orm');
    const [updated] = await db.select().from(outbox).where(eq(outbox.id, row!.id));
    expect(updated?.processedAt).toBeTruthy();
  });
});
