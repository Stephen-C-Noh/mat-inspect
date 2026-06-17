import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { ChecklistItem } from '@mat-inspect/shared-schemas';

const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
const localJwks = createLocalJWKSet({ keys: [publicJwk] });

vi.mock('../../lib/jwks.js', () => ({
  getJwks: () => localJwks,
  resetJwksForTest: vi.fn(),
}));

const ADMIN_ID = '33333333-3333-3333-3333-333333333333';
const OPERATOR_ID = '44444444-4444-4444-4444-444444444444';

const makeToken = async (role: string, sub: string) =>
  new SignJWT({ sub, oid: sub, roles: [role], tid: 'test-tenant' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privateKey);

const forkliftItemsV1: ChecklistItem[] = [
  {
    key: 'forks-condition',
    prompt: 'Forks free of cracks, bends, and excessive wear',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
  {
    key: 'horn',
    prompt: 'Horn sounds when tested',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
  },
];

const forkliftItemsV2: ChecklistItem[] = [
  ...forkliftItemsV1,
  {
    key: 'hydraulic-leaks',
    prompt: 'Photograph any visible hydraulic fluid leaks',
    type: 'BOOLEAN_PHOTO_ON_FAIL',
    required: true,
    failSeverity: 'BLOCKING',
  },
];

describe('checklist templates API', () => {
  let container: StartedPostgreSqlContainer;
  let app: Awaited<ReturnType<(typeof import('../../app.js'))['buildApp']>>;
  let adminToken: string;
  let operatorToken: string;
  let v1Id: string;
  let v2Id: string;

  beforeAll(async () => {
    delete process.env['ENTRA_TENANT_ID'];
    delete process.env['ENTRA_CLIENT_ID'];

    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env['DATABASE_URL'] = container.getConnectionUri();

    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { users } = await import('@mat-inspect/db');

    const migrationPool = new pg.Pool({ connectionString: container.getConnectionUri() });
    const migrationDb = drizzle(migrationPool);
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    await migrate(migrationDb, {
      migrationsFolder: path.join(__dirname, '../../../../../db/migrations'),
    });

    await migrationDb.insert(users).values([
      { id: ADMIN_ID, displayName: 'Admin User', email: 'admin@example.com' },
      { id: OPERATOR_ID, displayName: 'Operator User', email: 'operator@example.com' },
    ]);
    await migrationPool.end();

    const { buildApp } = await import('../../app.js');
    app = await buildApp();

    adminToken = await makeToken('admin', ADMIN_ID);
    operatorToken = await makeToken('operator', OPERATOR_ID);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    // Close the db singleton's pool before stopping the container; otherwise the
    // container shutdown sends idle connections a FATAL "terminating connection due to
    // administrator command", which surfaces as an unhandled pg Pool error event.
    const { db } = await import('../../db/index.js');
    await db.$client.end();
    await container?.stop();
  });

  it('rejects POST /checklists from a non-admin with 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/checklists',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: { equipmentType: 'FORKLIFT', items: forkliftItemsV1 },
    });

    expect(res.statusCode).toBe(403);
  });

  // DEV-25 role matrix: POST /checklists is admin-only (requireRole('admin')). Every
  // other App Role must be denied. The 403 lands in requireRole before any DB work, so
  // these users need no row. Admin's allow path is proven by the publish tests below.
  it.each(['operator', 'supervisor', 'manager'])(
    'denies POST /checklists for the %s App Role with 403',
    async (role) => {
      const token = await makeToken(role, `${role}-no-publish-id`);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/checklists',
        headers: { authorization: `Bearer ${token}` },
        payload: { equipmentType: 'FORKLIFT', items: forkliftItemsV1 },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().title).toBe('FORBIDDEN');
    },
  );

  it('rejects POST /checklists with no items', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/checklists',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { equipmentType: 'FORKLIFT', items: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects POST /checklists when reviewedBy is the publishing admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/checklists',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { equipmentType: 'FORKLIFT', items: forkliftItemsV1, reviewedBy: ADMIN_ID },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().title).toBe('CHECKLIST_TEMPLATE_INVALID_REVIEWER');
  });

  it('returns 404 from GET /checklists/active when no template has been published yet', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/checklists/active?type=FORKLIFT',
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('admin publishes the first template version as active', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/checklists',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { equipmentType: 'FORKLIFT', items: forkliftItemsV1 },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.version).toBe(1);
    expect(body.isActive).toBe(true);
    expect(body.createdBy).toBe(ADMIN_ID);
    v1Id = body.id;
  });

  it('GET /checklists/active returns the v1 template', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/checklists/active?type=FORKLIFT',
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(v1Id);
    expect(body.version).toBe(1);
  });

  it('publishing v2 retains v1 and flips it to inactive, leaving exactly one active version', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/checklists',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { equipmentType: 'FORKLIFT', items: forkliftItemsV2, reviewedBy: OPERATOR_ID },
    });

    expect(res.statusCode).toBe(201);
    const v2 = res.json();
    expect(v2.version).toBe(2);
    expect(v2.isActive).toBe(true);
    expect(v2.reviewedBy).toBe(OPERATOR_ID);
    v2Id = v2.id;

    const activeRes = await app.inject({
      method: 'GET',
      url: '/api/v1/checklists/active?type=FORKLIFT',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(activeRes.statusCode).toBe(200);
    expect(activeRes.json().id).toBe(v2Id);

    const { db, checklistTemplates } = await import('../../db/index.js');
    const { eq } = await import('drizzle-orm');
    const rows = await db
      .select()
      .from(checklistTemplates)
      .where(eq(checklistTemplates.equipmentType, 'FORKLIFT'));

    expect(rows).toHaveLength(2);
    const v1Row = rows.find((r) => r.id === v1Id);
    const v2Row = rows.find((r) => r.id === v2Id);
    expect(v1Row?.isActive).toBe(false);
    expect(v2Row?.isActive).toBe(true);
    expect(rows.filter((r) => r.isActive)).toHaveLength(1);
  });
});
