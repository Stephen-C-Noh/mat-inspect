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

  const poll = async (since?: string, token = managerToken) =>
    app.inject({
      method: 'GET',
      url: since ? `/api/v1/activity?since=${encodeURIComponent(since)}` : '/api/v1/activity',
      headers: { authorization: `Bearer ${token}` },
    });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/activity' });
    expect(res.statusCode).toBe(401);
  });

  // The feed is fleet-wide: it reports every operator's inspections, which is exactly what an
  // operator may not read (see inspection-access and GET /inspections).
  it('refuses an operator', async () => {
    const res = await poll(undefined, operatorToken);
    expect(res.statusCode).toBe(403);
  });

  // A first poll establishes the cursor. Returning the day's backlog here would make a manager's
  // first sight of the dashboard a wall of notifications for inspections they already knew about.
  it('reports nothing and hands back the server clock when no cursor is given', async () => {
    await submit();

    const res = await poll();
    expect(res.statusCode).toBe(200);
    const body = res.json() as ActivityFeed;
    expect(body.inspections).toEqual([]);
    expect(Date.parse(body.serverTime)).not.toBeNaN();
  });

  it('reports an inspection submitted after the cursor, with the machine and operator named', async () => {
    const start = (await poll()).json() as ActivityFeed;

    const submitted = await submit();

    const res = await poll(start.serverTime);
    expect(res.statusCode).toBe(200);
    const body = res.json() as ActivityFeed;

    expect(body.inspections).toHaveLength(1);
    expect(body.inspections[0]!.id).toBe(submitted.id);
    expect(body.inspections[0]!.equipmentAssetTag).toBe('FORK-ACT-1');
    expect(body.inspections[0]!.equipmentName).toBe('Forklift Activity');
    expect(body.inspections[0]!.operatorDisplayName).toBe('Jane Operator');
  });

  // The quiet case is the common one: it runs every couple of seconds per open dashboard and has
  // to stay empty, or the dashboard would refetch everything on every poll.
  it('reports nothing when the cursor is already current', async () => {
    await submit();
    const caughtUp = (await poll()).json() as ActivityFeed;

    const res = await poll(caughtUp.serverTime);
    expect((res.json() as ActivityFeed).inspections).toEqual([]);
  });

  // The cursor advances by consuming each response's serverTime, so the same inspection must not
  // be reported to the same client twice.
  it('does not repeat an inspection once the cursor has moved past it', async () => {
    const start = (await poll()).json() as ActivityFeed;
    await submit();

    const first = (await poll(start.serverTime)).json() as ActivityFeed;
    expect(first.inspections).toHaveLength(1);

    const second = (await poll(first.serverTime)).json() as ActivityFeed;
    expect(second.inspections).toEqual([]);
  });
});
