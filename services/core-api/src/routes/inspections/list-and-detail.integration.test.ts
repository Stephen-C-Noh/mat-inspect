import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { ChecklistItem } from '@mat-inspect/shared-schemas';
import { setJwksForTest } from '../../middleware/auth.js';

const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
const localJwks = createLocalJWKSet({ keys: [publicJwk] });
setJwksForTest(localJwks);

const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const OPERATOR_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_OPERATOR_ID = '33333333-3333-3333-3333-333333333333';
const MANAGER_ID = '44444444-4444-4444-4444-444444444444';
const AUDITOR_ID = '55555555-5555-5555-5555-555555555555';

const makeToken = async (role: string, sub: string) =>
  new SignJWT({ sub, oid: sub, roles: [role], tid: 'test-tenant' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privateKey);

// Order matters: the drilldown must read responses back in this order, not id order.
const forkliftItems: ChecklistItem[] = [
  {
    key: 'horn',
    prompt: 'Horn sounds when tested',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
  },
  {
    key: 'forks-condition',
    prompt: 'Forks free of cracks, bends, and excessive wear',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
  },
];

describe('GET /inspections and GET /inspections/:id', () => {
  let container: StartedPostgreSqlContainer;
  let app: Awaited<ReturnType<(typeof import('../../app.js'))['buildApp']>>;
  let operatorToken: string;
  let managerToken: string;
  let auditorToken: string;
  let equipmentId: string;
  let quietEquipmentId: string;
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
      { id: ADMIN_ID, displayName: 'Admin User', email: 'admin-list@example.com' },
      { id: OPERATOR_ID, displayName: 'Jane Operator', email: 'operator-list@example.com' },
      { id: OTHER_OPERATOR_ID, displayName: 'Other Operator', email: 'other-list@example.com' },
      { id: MANAGER_ID, displayName: 'Manager User', email: 'manager-list@example.com' },
      { id: AUDITOR_ID, displayName: 'Ada Auditor', email: 'auditor-list@example.com' },
    ]);

    const [equipmentRow] = await migrationDb
      .insert(equipment)
      .values({ assetTag: 'FORK-LIST-1', name: 'Forklift 1', type: 'FORKLIFT' })
      .returning();
    equipmentId = equipmentRow!.id;

    // Never inspected: exercises the "no last inspection yet" null case on the equipment list.
    const [quietRow] = await migrationDb
      .insert(equipment)
      .values({ assetTag: 'FORK-LIST-2', name: 'Forklift 2', type: 'FORKLIFT' })
      .returning();
    quietEquipmentId = quietRow!.id;

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
    auditorToken = await makeToken('auditor', AUDITOR_ID);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    const { db } = await import('../../db/index.js');
    await db.$client.end();
    await container?.stop();
  });

  const submit = async (
    opts: { operatorToken: string; passed: boolean; equipmentId?: string } = {
      operatorToken,
      passed: true,
    },
  ) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inspections',
      headers: {
        authorization: `Bearer ${opts.operatorToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: {
        equipmentId: opts.equipmentId ?? equipmentId,
        templateId,
        responses: [
          // `passed` fails the WARNING item (horn), not the BLOCKING one (forks-condition): this
          // file tests listing/detail/RBAC, not the defect lifecycle, and a BLOCKING failure would
          // flip equipment.status to OUT_OF_SERVICE (ADR 0006) and make every later `passed: true`
          // submit against the shared `equipmentId` 409 under the DEV-143 lockout gate. The
          // BLOCKING/OUT_OF_SERVICE path is covered by defects.integration.test.ts instead.
          { itemKey: 'horn', value: opts.passed, passed: opts.passed },
          { itemKey: 'forks-condition', value: true, passed: true },
        ],
        attested: true,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  };

  it('rejects an unauthenticated request with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/inspections' });
    expect(res.statusCode).toBe(401);
  });

  it('lists inspections for an equipment, newest first, with the operator display name joined', async () => {
    const first = await submit({ operatorToken, passed: true });
    const second = await submit({ operatorToken, passed: false });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/inspections?equipmentId=${equipmentId}`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; operatorDisplayName: string }>;

    const ids = body.map((row) => row.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
    expect(body[0]!.operatorDisplayName).toBe('Jane Operator');
  });

  it('filters by operatorId', async () => {
    // Relies on the inspections already created for `equipmentId` in the previous test; this
    // filter must exclude them all since none were submitted by OTHER_OPERATOR_ID. Deliberately
    // does not touch quietEquipmentId, which the last test below asserts has never been inspected.
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/inspections?operatorId=${OTHER_OPERATOR_ID}`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns the detail for a single inspection with responses in checklist order', async () => {
    const created = await submit({ operatorToken, passed: false });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/inspections/${created.id}`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.operatorDisplayName).toBe('Jane Operator');
    expect(body.responses.map((r: { itemKey: string }) => r.itemKey)).toEqual([
      'horn',
      'forks-condition',
    ]);
  });

  it('round-trips per-response photo references on submit and detail read', async () => {
    const photoA = randomUUID();
    const photoB = randomUUID();
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
        // Fails the WARNING item (horn), not the BLOCKING one, for the same reason as the shared
        // `submit` helper above: a BLOCKING failure here would flip equipment.status to
        // OUT_OF_SERVICE and 409 every later `passed: true` submit against the shared equipmentId
        // (DEV-143). The photo round-trip being asserted does not depend on failSeverity.
        responses: [
          { itemKey: 'horn', value: false, passed: false, photoIds: [photoA, photoB] },
          { itemKey: 'forks-condition', value: true, passed: true },
        ],
        attested: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/inspections/${created.id}`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(detail.statusCode).toBe(200);
    const byKey = Object.fromEntries(
      detail
        .json()
        .responses.map((r: { itemKey: string; photoIds: string[] }) => [r.itemKey, r.photoIds]),
    );
    // Preserved in submit order on the item that carried them; empty array (not absent) on the
    // item that carried none.
    expect(byKey['horn']).toEqual([photoA, photoB]);
    expect(byKey['forks-condition']).toEqual([]);
  });

  it('rejects a response carrying more than 10 photo references', async () => {
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
        responses: [
          { itemKey: 'horn', value: true, passed: true },
          {
            itemKey: 'forks-condition',
            value: false,
            passed: false,
            photoIds: Array.from({ length: 11 }, () => randomUUID()),
          },
        ],
        attested: true,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for a well-formed but unknown inspection id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/inspections/${randomUUID()}`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().title).toBe('INSPECTION_NOT_FOUND');
  });

  it("GET /equipment reports each machine's last inspection, or null when never inspected", async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/equipment',
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{
      id: string;
      lastInspectionAt: string | null;
      lastInspectionResult: string | null;
      lastInspectionOperatorDisplayName: string | null;
    }>;

    const inspected = body.find((row) => row.id === equipmentId)!;
    expect(inspected.lastInspectionAt).not.toBeNull();
    expect(inspected.lastInspectionOperatorDisplayName).toBe('Jane Operator');

    const untouched = body.find((row) => row.id === quietEquipmentId)!;
    expect(untouched.lastInspectionAt).toBeNull();
    expect(untouched.lastInspectionResult).toBeNull();
    expect(untouched.lastInspectionOperatorDisplayName).toBeNull();
  });

  // Operator self-scoped history (DEV-115). Placed last: these submit an OTHER_OPERATOR_ID
  // inspection to equipmentId, which would otherwise change the "last inspection" operator the
  // GET /equipment test above asserts is Jane Operator.
  it('scopes an operator to their own inspections when no operatorId is given (DEV-115)', async () => {
    const mine = await submit({ operatorToken, passed: true });
    const otherToken = await makeToken('operator', OTHER_OPERATOR_ID);
    await submit({ operatorToken: otherToken, passed: true });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/inspections',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; operatorId: string }>;
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((row) => row.operatorId === OPERATOR_ID)).toBe(true);
    expect(body.some((row) => row.id === mine.id)).toBe(true);
  });

  it('forbids an operator from listing another operator by operatorId (DEV-115)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/inspections?operatorId=${OTHER_OPERATOR_ID}`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets an operator read the detail of their own inspection (DEV-115)', async () => {
    const created = await submit({ operatorToken, passed: false });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/inspections/${created.id}`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().operatorDisplayName).toBe('Jane Operator');
  });

  it("hides another operator's inspection detail from an operator with a 404, not a 403 (DEV-115)", async () => {
    const otherToken = await makeToken('operator', OTHER_OPERATOR_ID);
    const theirs = await submit({ operatorToken: otherToken, passed: true });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/inspections/${theirs.id}`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().title).toBe('INSPECTION_NOT_FOUND');
  });

  // Auditor is a read-only, non-operational role (ADR 0021) that backs the dashboard's /audit
  // page (DEV-113). It must read fleet-wide, the same as supervisor/manager/admin, not be
  // scoped to its own (nonexistent) operatorId like an operator caller would be.
  it('lets an auditor list inspections fleet-wide, unscoped, on GET /inspections (DEV-113)', async () => {
    const mine = await submit({ operatorToken, passed: true });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/inspections',
      headers: { authorization: `Bearer ${auditorToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; operatorId: string }>;
    expect(body.some((row) => row.id === mine.id)).toBe(true);
    expect(body.some((row) => row.operatorId !== AUDITOR_ID)).toBe(true);
  });

  it('lets an auditor read a single inspection detail on GET /inspections/:id (DEV-113)', async () => {
    const created = await submit({ operatorToken, passed: false });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/inspections/${created.id}`,
      headers: { authorization: `Bearer ${auditorToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().operatorDisplayName).toBe('Jane Operator');
  });

  it('lets an auditor list equipment on GET /equipment (DEV-113)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/equipment',
      headers: { authorization: `Bearer ${auditorToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});
