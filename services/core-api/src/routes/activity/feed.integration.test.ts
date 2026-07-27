import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { ActivityFeed, ChecklistItem } from '@mat-inspect/shared-schemas';
import { setJwksForTest } from '../../middleware/auth.js';

const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
const localJwks = createLocalJWKSet({ keys: [publicJwk] });
setJwksForTest(localJwks);

const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const OPERATOR_ID = '22222222-2222-2222-2222-222222222222';
const MANAGER_ID = '44444444-4444-4444-4444-444444444444';

const makeToken = async (role: string, sub: string) =>
  new SignJWT({ sub, oid: sub, roles: [role], tid: 'test-tenant' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privateKey);

const forkliftItems: ChecklistItem[] = [
  {
    key: 'horn',
    prompt: 'Horn sounds when tested',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
  },
];

// The dashboard's change signal (ADR 0026). Every open dashboard asks this every couple of
// seconds, so the contract that matters is what it reports and what it deliberately does not.
describe('GET /activity', () => {
  let container: StartedPostgreSqlContainer;
  let app: Awaited<ReturnType<(typeof import('../../app.js'))['buildApp']>>;
  let operatorToken: string;
  let managerToken: string;
  let equipmentId: string;
  let templateId: string;

  beforeAll(async () => {
    delete process.env['ENTRA_TENANT_ID'];
    delete process.env['ENTRA_CLIENT_ID'];

    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env['DATABASE_URL'] = container.getConnectionUri();

    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { users, equipment, checklistTemplates } = await import('@mat-inspect/db');

    const migrationPool = new pg.Pool({ connectionString: container.getConnectionUri() });
    const migrationDb = drizzle(migrationPool);
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    await migrate(migrationDb, {
      migrationsFolder: path.join(__dirname, '../../../../../db/migrations'),
    });

    await migrationDb.insert(users).values([
      { id: ADMIN_ID, displayName: 'Admin User', email: 'admin-activity@example.com' },
      { id: OPERATOR_ID, displayName: 'Jane Operator', email: 'operator-activity@example.com' },
      { id: MANAGER_ID, displayName: 'Manager User', email: 'manager-activity@example.com' },
    ]);

    const [equipmentRow] = await migrationDb
      .insert(equipment)
      .values({ assetTag: 'FORK-ACT-1', name: 'Forklift Activity', type: 'FORKLIFT' })
      .returning();
    equipmentId = equipmentRow!.id;

    const [templateRow] = await migrationDb
      .insert(checklistTemplates)
      .values({
        equipmentType: 'FORKLIFT',
        version: 1,
        isActive: true,
        items: forkliftItems,
        createdBy: ADMIN_ID,
      })
      .returning();
    templateId = templateRow!.id;

    await migrationPool.end();

    const { buildApp } = await import('../../app.js');
    app = await buildApp();

    operatorToken = await makeToken('operator', OPERATOR_ID);
    managerToken = await makeToken('manager', MANAGER_ID);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    const { db } = await import('../../db/index.js');
    await db.$client.end();
    await container?.stop();
  });

  const submit = async (): Promise<{ id: string }> => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inspections',
      headers: {
        authorization: `Bearer ${operatorToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: {
        equipmentId,
        templateId,
        responses: [{ itemKey: 'horn', value: true, passed: true }],
        attested: true,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  };

  const poll = async (token = managerToken) =>
    app.inject({
      method: 'GET',
      url: '/api/v1/activity',
      headers: { authorization: `Bearer ${token}` },
    });

  const dismiss = async (inspectionIds: string[], token = managerToken) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/activity/dismiss',
      headers: { authorization: `Bearer ${token}` },
      payload: { inspectionIds },
    });

  const feedIds = async (token = managerToken): Promise<string[]> =>
    ((await poll(token)).json() as ActivityFeed).inspections.map((row) => row.id);

  it('rejects an unauthenticated request with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/activity' });
    expect(res.statusCode).toBe(401);
  });

  // The feed is fleet-wide: it reports every operator's inspections, which is exactly what an
  // operator may not read (see inspection-access and GET /inspections).
  it('refuses an operator on both the feed and the dismiss route', async () => {
    const submitted = await submit();
    expect((await poll(operatorToken)).statusCode).toBe(403);
    // A real id, not an empty list: body validation runs before the role check in Fastify's
    // lifecycle, so an invalid body would answer 400 and prove nothing about the role gate.
    expect((await dismiss([submitted.id], operatorToken)).statusCode).toBe(403);
  });

  it('reports an undismissed inspection with the machine and operator named', async () => {
    const submitted = await submit();

    const res = await poll();
    expect(res.statusCode).toBe(200);
    const body = res.json() as ActivityFeed;

    const row = body.inspections.find((item) => item.id === submitted.id);
    expect(row).toBeDefined();
    expect(row!.equipmentAssetTag).toBe('FORK-ACT-1');
    expect(row!.equipmentName).toBe('Forklift Activity');
    expect(row!.operatorDisplayName).toBe('Jane Operator');
  });

  // The property that removes the cursor race. The feed repeating an entry is not a bug: it is
  // what lets a late-committing inspection be reported on the next poll rather than lost.
  it('keeps reporting an inspection until it is dismissed', async () => {
    const submitted = await submit();

    expect(await feedIds()).toContain(submitted.id);
    expect(await feedIds()).toContain(submitted.id);

    expect((await dismiss([submitted.id])).statusCode).toBe(204);

    expect(await feedIds()).not.toContain(submitted.id);
  });

  // Dismissal is per manager. One supervisor clearing their bell must not clear anyone else's.
  it('dismisses for the calling manager only', async () => {
    const submitted = await submit();
    const adminToken = await makeToken('admin', ADMIN_ID);

    await dismiss([submitted.id]);

    expect(await feedIds()).not.toContain(submitted.id);
    expect(await feedIds(adminToken)).toContain(submitted.id);
  });

  // The panel can be cleared from two tabs, and a retry after a dropped response has to land on
  // the same state as the original request.
  it('treats a repeated dismissal as a no-op', async () => {
    const submitted = await submit();

    expect((await dismiss([submitted.id])).statusCode).toBe(204);
    expect((await dismiss([submitted.id])).statusCode).toBe(204);
    expect(await feedIds()).not.toContain(submitted.id);
  });

  // The quiet case is the common one: it runs every couple of seconds per open dashboard and has
  // to stay empty, or the dashboard would refetch everything on every poll.
  it('reports nothing once everything in the window is dismissed', async () => {
    await submit();
    const outstanding = await feedIds();
    if (outstanding.length > 0) await dismiss(outstanding);

    expect(await feedIds()).toEqual([]);
  });
});
