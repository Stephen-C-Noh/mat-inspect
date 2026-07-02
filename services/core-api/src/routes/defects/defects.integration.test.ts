import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { eq } from 'drizzle-orm';
import type { ChecklistItem } from '@mat-inspect/shared-schemas';

const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
const localJwks = createLocalJWKSet({ keys: [publicJwk] });

vi.mock('../../lib/jwks.js', () => ({
  getJwks: () => localJwks,
  resetJwksForTest: vi.fn(),
}));

const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const OPERATOR_ID = '22222222-2222-2222-2222-222222222222';
const SUPERVISOR_ID = '33333333-3333-3333-3333-333333333333';
const MANAGER_ID = '44444444-4444-4444-4444-444444444444';

const makeToken = async (role: string, sub: string) =>
  new SignJWT({ sub, oid: sub, roles: [role], tid: 'test-tenant' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privateKey);

// Two BLOCKING items so aggregation into a single defect can be asserted, one WARNING item so
// a WARNING-only failure can be shown not to open a defect. All required, so every submit must
// answer all three (deriveInspectionResult rejects missing required items).
const forkliftItems: ChecklistItem[] = [
  {
    key: 'forks-condition',
    prompt: 'Forks free of cracks, bends, and excessive wear',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
  },
  {
    key: 'mast-chains',
    prompt: 'Mast chains intact and lubricated',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
  },
  {
    key: 'horn',
    prompt: 'Horn sounds when tested',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
  },
];

const ALL_PASS = [
  { itemKey: 'forks-condition', value: true, passed: true },
  { itemKey: 'mast-chains', value: true, passed: true },
  { itemKey: 'horn', value: true, passed: true },
];

describe('defect lifecycle API (DEV-20, ADR 0006)', () => {
  let container: StartedPostgreSqlContainer;
  let app: Awaited<ReturnType<(typeof import('../../app.js'))['buildApp']>>;
  let operatorToken: string;
  let supervisorToken: string;
  let managerToken: string;
  let templateId: string;

  beforeAll(async () => {
    delete process.env['ENTRA_TENANT_ID'];
    delete process.env['ENTRA_CLIENT_ID'];

    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env['DATABASE_URL'] = container.getConnectionUri();

    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { users, checklistTemplates } = await import('@mat-inspect/db');

    const migrationPool = new pg.Pool({ connectionString: container.getConnectionUri() });
    const migrationDb = drizzle(migrationPool);
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    await migrate(migrationDb, {
      migrationsFolder: path.join(__dirname, '../../../../../db/migrations'),
    });

    await migrationDb.insert(users).values([
      { id: ADMIN_ID, displayName: 'Admin User', email: 'admin-defect@example.com' },
      { id: OPERATOR_ID, displayName: 'Operator User', email: 'operator-defect@example.com' },
      { id: SUPERVISOR_ID, displayName: 'Supervisor User', email: 'supervisor-defect@example.com' },
      { id: MANAGER_ID, displayName: 'Manager User', email: 'manager-defect@example.com' },
    ]);

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
    supervisorToken = await makeToken('supervisor', SUPERVISOR_ID);
    managerToken = await makeToken('manager', MANAGER_ID);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    const { db } = await import('../../db/index.js');
    await db.$client.end();
    await container?.stop();
  });

  // Fresh equipment per scenario so status mutations cannot bleed across tests.
  const makeEquipment = async (assetTag: string) => {
    const { db, equipment } = await import('../../db/index.js');
    const [row] = await db
      .insert(equipment)
      .values({ assetTag, name: assetTag, type: 'FORKLIFT' })
      .returning();
    return row!;
  };

  const submit = (
    equipmentId: string,
    responses: Array<Record<string, unknown>>,
    token = operatorToken,
  ) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/inspections',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() },
      payload: { equipmentId, templateId, responses, attested: true },
    });

  const post = (url: string, token: string, payload?: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload });

  const getStatus = async (equipmentId: string, token = operatorToken) => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/equipment/${equipmentId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    return res.json().status as string;
  };

  const openBlockingDefect = async (equipmentId: string) => {
    const res = await submit(equipmentId, [
      { itemKey: 'forks-condition', value: false, passed: false, notes: 'Cracked tine' },
      { itemKey: 'mast-chains', value: true, passed: true },
      { itemKey: 'horn', value: true, passed: true },
    ]);
    expect(res.statusCode).toBe(201);
    expect(res.json().result).toBe('FAIL_BLOCKING');
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/defects?equipmentId=${equipmentId}`,
      headers: { authorization: `Bearer ${supervisorToken}` },
    });
    return list.json()[0];
  };

  it('auto-creates exactly one OPEN defect and sets equipment OUT_OF_SERVICE on a blocking failure', async () => {
    const equipment = await makeEquipment('FORK-DEF-1');

    const defect = await openBlockingDefect(equipment.id);
    expect(defect.status).toBe('OPEN');
    expect(defect.equipmentId).toBe(equipment.id);
    expect(defect.severity).toBe('BLOCKING');

    const { db, defects } = await import('../../db/index.js');
    const rows = await db.select().from(defects).where(eq(defects.equipmentId, equipment.id));
    expect(rows).toHaveLength(1);

    expect(await getStatus(equipment.id)).toBe('OUT_OF_SERVICE');
  });

  it('aggregates several blocking failures into a single defect', async () => {
    const equipment = await makeEquipment('FORK-DEF-AGG');
    const res = await submit(equipment.id, [
      { itemKey: 'forks-condition', value: false, passed: false, notes: 'Cracked' },
      { itemKey: 'mast-chains', value: false, passed: false },
      { itemKey: 'horn', value: true, passed: true },
    ]);
    expect(res.statusCode).toBe(201);

    const { db, defects } = await import('../../db/index.js');
    const rows = await db.select().from(defects).where(eq(defects.equipmentId, equipment.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.itemKey).toBe('forks-condition');
    expect(rows[0]!.description).toContain('Cracked');
    expect(rows[0]!.description).toContain('Mast chains');
  });

  it('emits DEFECT_OPENED and EQUIPMENT_STATUS_CHANGED to the outbox on a blocking failure', async () => {
    const equipment = await makeEquipment('FORK-DEF-EVT');
    const defect = await openBlockingDefect(equipment.id);

    const { db, outbox } = await import('../../db/index.js');
    const rows = await db.select().from(outbox);
    const opened = rows.filter(
      (r) =>
        r.eventType === 'DEFECT_OPENED' &&
        (r.payload as { defectId?: string }).defectId === defect.id,
    );
    const statusChanged = rows.filter(
      (r) =>
        r.eventType === 'EQUIPMENT_STATUS_CHANGED' &&
        (r.payload as { equipmentId?: string; to?: string }).equipmentId === equipment.id &&
        (r.payload as { to?: string }).to === 'OUT_OF_SERVICE',
    );
    expect(opened).toHaveLength(1);
    expect(statusChanged).toHaveLength(1);
  });

  it('does not open a defect or change status for a passing inspection', async () => {
    const equipment = await makeEquipment('FORK-DEF-PASS');
    const res = await submit(equipment.id, ALL_PASS);
    expect(res.statusCode).toBe(201);
    expect(res.json().result).toBe('PASS');

    const { db, defects } = await import('../../db/index.js');
    const rows = await db.select().from(defects).where(eq(defects.equipmentId, equipment.id));
    expect(rows).toHaveLength(0);
    expect(await getStatus(equipment.id)).toBe('READY');
  });

  it('does not open a defect for a WARNING-only failure', async () => {
    const equipment = await makeEquipment('FORK-DEF-WARN');
    const res = await submit(equipment.id, [
      { itemKey: 'forks-condition', value: true, passed: true },
      { itemKey: 'mast-chains', value: true, passed: true },
      { itemKey: 'horn', value: false, passed: false },
    ]);
    expect(res.statusCode).toBe(201);
    expect(res.json().result).toBe('FAIL_WARNING');

    const { db, defects } = await import('../../db/index.js');
    const rows = await db.select().from(defects).where(eq(defects.equipmentId, equipment.id));
    expect(rows).toHaveLength(0);
  });

  it('walks the happy path OPEN -> ACKNOWLEDGED -> IN_REPAIR -> RESOLVED and emits DEFECT_RESOLVED', async () => {
    const equipment = await makeEquipment('FORK-DEF-FLOW');
    const defect = await openBlockingDefect(equipment.id);

    const ack = await post(`/api/v1/defects/${defect.id}/acknowledge`, supervisorToken);
    expect(ack.statusCode).toBe(200);
    expect(ack.json().status).toBe('ACKNOWLEDGED');

    const repair = await post(`/api/v1/defects/${defect.id}/start-repair`, supervisorToken);
    expect(repair.statusCode).toBe(200);
    expect(repair.json().status).toBe('IN_REPAIR');

    const resolve = await post(`/api/v1/defects/${defect.id}/resolve`, managerToken, {
      resolutionNotes: 'Replaced fork tine',
    });
    expect(resolve.statusCode).toBe(200);
    expect(resolve.json().status).toBe('RESOLVED');
    expect(resolve.json().resolvedBy).toBe(MANAGER_ID);

    const { db, outbox } = await import('../../db/index.js');
    const rows = await db.select().from(outbox);
    const resolved = rows.filter(
      (r) =>
        r.eventType === 'DEFECT_RESOLVED' &&
        (r.payload as { defectId?: string }).defectId === defect.id,
    );
    expect(resolved).toHaveLength(1);
  });

  it('rejects an operator resolving a defect with 403', async () => {
    const equipment = await makeEquipment('FORK-DEF-ROLE');
    const defect = await openBlockingDefect(equipment.id);
    await post(`/api/v1/defects/${defect.id}/acknowledge`, supervisorToken);
    await post(`/api/v1/defects/${defect.id}/start-repair`, supervisorToken);

    const res = await post(`/api/v1/defects/${defect.id}/resolve`, operatorToken, {
      resolutionNotes: 'sneaky',
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an out-of-order transition with 409', async () => {
    const equipment = await makeEquipment('FORK-DEF-SKIP');
    const defect = await openBlockingDefect(equipment.id);

    const res = await post(`/api/v1/defects/${defect.id}/resolve`, supervisorToken, {
      resolutionNotes: 'too soon',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().title).toBe('DEFECT_INVALID_TRANSITION');
  });

  it('return-to-service is blocked while a blocking defect is still open', async () => {
    const equipment = await makeEquipment('FORK-RTS-OPEN');
    await openBlockingDefect(equipment.id);

    const res = await post(`/api/v1/equipment/${equipment.id}/return-to-service`, supervisorToken);
    expect(res.statusCode).toBe(409);
    expect(res.json().title).toBe('DEFECT_STILL_OPEN');
  });

  it('return-to-service is blocked when no defect is resolved (only rejected)', async () => {
    const equipment = await makeEquipment('FORK-RTS-REJECT');
    const defect = await openBlockingDefect(equipment.id);
    const reject = await post(`/api/v1/defects/${defect.id}/reject`, supervisorToken, {
      reason: 'Misread, tine is fine',
    });
    expect(reject.statusCode).toBe(200);

    const res = await post(`/api/v1/equipment/${equipment.id}/return-to-service`, supervisorToken);
    expect(res.statusCode).toBe(409);
    expect(res.json().title).toBe('NO_RESOLVED_DEFECT');
  });

  it('rejects an operator approving return-to-service with 403', async () => {
    const equipment = await makeEquipment('FORK-RTS-ROLE');
    const res = await post(`/api/v1/equipment/${equipment.id}/return-to-service`, operatorToken);
    expect(res.statusCode).toBe(403);
  });

  it('rejects return-to-service on equipment that is not OUT_OF_SERVICE with 409', async () => {
    const equipment = await makeEquipment('FORK-RTS-NOTOOS');
    const res = await post(`/api/v1/equipment/${equipment.id}/return-to-service`, supervisorToken);
    expect(res.statusCode).toBe(409);
    expect(res.json().title).toBe('EQUIPMENT_NOT_OUT_OF_SERVICE');
  });

  it('a same-day pre-repair pass does not restore READY after RTS; a fresh pass does', async () => {
    const equipment = await makeEquipment('FORK-RTS-WATERMARK');

    // A passing inspection earlier the same day, before anything goes wrong.
    expect((await submit(equipment.id, ALL_PASS)).statusCode).toBe(201);
    expect(await getStatus(equipment.id)).toBe('READY');

    // Blocking failure locks it out.
    const defect = await openBlockingDefect(equipment.id);
    expect(await getStatus(equipment.id)).toBe('OUT_OF_SERVICE');

    // Repair and resolve.
    await post(`/api/v1/defects/${defect.id}/acknowledge`, supervisorToken);
    await post(`/api/v1/defects/${defect.id}/start-repair`, supervisorToken);
    expect(
      (
        await post(`/api/v1/defects/${defect.id}/resolve`, supervisorToken, {
          resolutionNotes: 'Replaced tine',
        })
      ).statusCode,
    ).toBe(200);

    // Return-to-service: watermark advances, OUT_OF_SERVICE cleared.
    const rts = await post(`/api/v1/equipment/${equipment.id}/return-to-service`, supervisorToken);
    expect(rts.statusCode).toBe(200);
    expect(rts.json().status).toBe('AWAITING_INSPECTION');

    // The RTS approval was stamped on the resolved defect, and the watermark moved.
    const { db, equipment: equipmentTable, defects } = await import('../../db/index.js');
    const [equipmentRow] = await db
      .select()
      .from(equipmentTable)
      .where(eq(equipmentTable.id, equipment.id));
    expect(equipmentRow!.readinessBaselineAt.getTime()).toBeGreaterThan(
      equipment.readinessBaselineAt.getTime(),
    );
    const [defectRow] = await db.select().from(defects).where(eq(defects.id, defect.id));
    expect(defectRow!.returnToServiceApprovedBy).toBe(SUPERVISOR_ID);

    // The earlier same-day pass predates the watermark: still not READY.
    expect(await getStatus(equipment.id)).toBe('AWAITING_INSPECTION');

    // A fresh pass, submitted after RTS, restores READY.
    expect((await submit(equipment.id, ALL_PASS)).statusCode).toBe(201);
    expect(await getStatus(equipment.id)).toBe('READY');

    // Sanity: exactly one EQUIPMENT_STATUS_CHANGED to AWAITING_INSPECTION for the RTS.
    const { outbox } = await import('../../db/index.js');
    const rows = await db.select().from(outbox);
    const rtsEvents = rows.filter(
      (r) =>
        r.eventType === 'EQUIPMENT_STATUS_CHANGED' &&
        (r.payload as { equipmentId?: string; reason?: string }).equipmentId === equipment.id &&
        (r.payload as { reason?: string }).reason === 'RETURN_TO_SERVICE',
    );
    expect(rtsEvents).toHaveLength(1);
  });

  it('returns 404 for a transition on an unknown defect id', async () => {
    const res = await post(`/api/v1/defects/${randomUUID()}/acknowledge`, supervisorToken);
    expect(res.statusCode).toBe(404);
    expect(res.json().title).toBe('DEFECT_NOT_FOUND');
  });
});
