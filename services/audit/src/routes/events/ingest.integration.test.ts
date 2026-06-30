import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

const ACTOR_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RESOURCE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const INGEST_TOKEN = 'ingest-route-test-token';

const makeBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  sourceEventId: randomUUID(),
  action: 'INSPECTION_SUBMITTED',
  actorId: ACTOR_ID,
  resourceType: 'INSPECTION',
  resourceId: RESOURCE_ID,
  occurredAt: new Date().toISOString(),
  payloadSummary: { inspectionId: RESOURCE_ID, result: 'PASS', contentHash: 'a'.repeat(64) },
  ...overrides,
});

describe('POST /api/v1/events', () => {
  let container: StartedPostgreSqlContainer;
  let app: Awaited<ReturnType<(typeof import('../../app.js'))['buildApp']>>;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['AUDIT_INGEST_TOKEN'] = INGEST_TOKEN;

    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env['DATABASE_URL'] = container.getConnectionUri();

    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const migrationPool = new pg.Pool({ connectionString: container.getConnectionUri() });
    const migrationDb = drizzle(migrationPool);
    await migrate(migrationDb, {
      migrationsFolder: path.join(__dirname, '../../../../db/migrations'),
    });
    await migrationPool.end();

    const { resetConfigForTest } = await import('../../lib/config.js');
    resetConfigForTest();

    const { buildApp } = await import('../../app.js');
    app = await buildApp();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      payload: makeBody(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when bearer token does not match', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { authorization: 'Bearer wrong-token' },
      payload: makeBody(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 201 and the event id on first delivery', async () => {
    const body = makeBody();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { authorization: `Bearer ${INGEST_TOKEN}` },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(typeof json.id).toBe('string');
    expect(json.deduped).toBe(false);
  });

  it('returns 200 on redelivery of the same sourceEventId (deduped)', async () => {
    const body = makeBody();
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { authorization: `Bearer ${INGEST_TOKEN}` },
      payload: body,
    });
    expect(first.statusCode).toBe(201);
    const firstJson = first.json();

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { authorization: `Bearer ${INGEST_TOKEN}` },
      payload: body,
    });
    expect(second.statusCode).toBe(200);
    const secondJson = second.json();
    expect(secondJson.deduped).toBe(true);
    expect(secondJson.id).toBe(firstJson.id);
  });

  it('returns 400 on a payload with an unknown action', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { authorization: `Bearer ${INGEST_TOKEN}` },
      payload: makeBody({ action: 'UNKNOWN_EVENT_TYPE' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('/health is accessible without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe('audit');
  });
});
