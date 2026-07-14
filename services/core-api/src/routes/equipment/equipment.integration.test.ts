import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { setJwksForTest } from '../../middleware/auth.js';

const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
const localJwks = createLocalJWKSet({ keys: [publicJwk] });

// Inject the local key set so token verification never reaches the network. The shared
// verifier owns the JWKS fetch (DEV-98); tests hand it keys instead of mocking the module.
setJwksForTest(localJwks);

const ADMIN_ID = '33333333-3333-3333-3333-333333333333';
const OPERATOR_ID = '44444444-4444-4444-4444-444444444444';

const makeToken = async (role: string, sub: string) =>
  new SignJWT({ sub, oid: sub, roles: [role], tid: 'test-tenant' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privateKey);

// Two representative records; the full 10-machine seed runs via db:seed in CI.
const SEED_EQUIPMENT = [
  {
    assetTag: 'MAT-OC-001',
    name: 'Overhead Crane 1',
    type: 'OVERHEAD_CRANE' as const,
    make: 'Konecranes',
    model: 'CXT NEO',
    location: 'MAT Bay A',
  },
  {
    assetTag: 'MAT-FL-001',
    name: 'Forklift 1',
    type: 'FORKLIFT' as const,
    make: 'Toyota',
    model: '8FGCU25',
    location: 'MAT Warehouse',
  },
];

describe('equipment API', () => {
  let container: StartedPostgreSqlContainer;
  let app: Awaited<ReturnType<(typeof import('../../app.js'))['buildApp']>>;
  let adminToken: string;
  let operatorToken: string;
  let seededId: string;

  beforeAll(async () => {
    delete process.env['ENTRA_TENANT_ID'];
    delete process.env['ENTRA_CLIENT_ID'];

    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env['DATABASE_URL'] = container.getConnectionUri();

    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { equipment } = await import('@mat-inspect/db');

    const migrationPool = new pg.Pool({ connectionString: container.getConnectionUri() });
    const migrationDb = drizzle(migrationPool);
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    await migrate(migrationDb, {
      migrationsFolder: path.join(__dirname, '../../../../../db/migrations'),
    });

    const [first] = await migrationDb.insert(equipment).values(SEED_EQUIPMENT).returning();
    seededId = first!.id;
    await migrationPool.end();

    const { buildApp } = await import('../../app.js');
    app = await buildApp();

    adminToken = await makeToken('admin', ADMIN_ID);
    operatorToken = await makeToken('operator', OPERATOR_ID);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    const { db } = await import('../../db/index.js');
    await db.$client.end();
    await container?.stop();
  });

  // --- list ---

  it('GET /equipment returns all seeded records', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/equipment',
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as unknown[];
    expect(body.length).toBe(SEED_EQUIPMENT.length);
  });

  it('GET /equipment rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/equipment' });
    expect(res.statusCode).toBe(401);
  });

  // --- get by id ---

  it('GET /equipment/:id returns the record for a known id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/equipment/${seededId}`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(seededId);
    expect(body.assetTag).toBe('MAT-OC-001');
    expect(body.status).toBe('AWAITING_INSPECTION');
  });

  it('GET /equipment/:id returns 404 for an unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/equipment/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().title).toBe('EQUIPMENT_NOT_FOUND');
  });

  // --- get by asset tag ---

  it('GET /equipment/by-tag/:assetTag resolves a known tag', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/equipment/by-tag/MAT-OC-001',
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.assetTag).toBe('MAT-OC-001');
    expect(body.type).toBe('OVERHEAD_CRANE');
  });

  it('GET /equipment/by-tag/:assetTag returns 404 problem+json for an unknown tag', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/equipment/by-tag/UNKNOWN-TAG',
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.title).toBe('EQUIPMENT_NOT_FOUND');
    expect(res.headers['content-type']).toMatch('application/problem+json');
  });

  // --- create (admin only) ---

  it('POST /equipment rejects a non-admin with 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/equipment',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: { assetTag: 'MAT-OC-005', name: 'Overhead Crane 5', type: 'OVERHEAD_CRANE' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('POST /equipment creates a record and returns 201 with AWAITING_INSPECTION status', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/equipment',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        assetTag: 'MAT-TR-001',
        name: 'Truck 1',
        type: 'TRUCK',
        make: 'Toyota',
        model: 'Dyna',
        location: 'MAT Yard',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.assetTag).toBe('MAT-TR-001');
    // Status must never come back as READY from a create (OHS s.257).
    expect(body.status).toBe('AWAITING_INSPECTION');
  });

  it('POST /equipment returns 409 when the asset tag is already taken', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/equipment',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { assetTag: 'MAT-OC-001', name: 'Duplicate', type: 'OVERHEAD_CRANE' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().title).toBe('EQUIPMENT_ASSET_TAG_CONFLICT');
  });

  // Concurrency: the pre-check select cannot serialize simultaneous creates, so the unique
  // index is the real guard. Firing the same new tag in parallel must yield exactly one 201
  // and the rest 409 (never a 500). This exercises the unique-violation catch in create.ts.
  it('POST /equipment under concurrency returns one 201 and the rest 409, never 500', async () => {
    const payload = { assetTag: 'MAT-PJ-001', name: 'Pallet Jack 1', type: 'ELECTRIC_PALLET_JACK' };

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({
          method: 'POST',
          url: '/api/v1/equipment',
          headers: { authorization: `Bearer ${adminToken}` },
          payload,
        }),
      ),
    );

    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(4);
    expect(codes).not.toContain(500);
  });

  it('POST /equipment rejects a body that fails Zod validation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/equipment',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { assetTag: '', name: 'Bad', type: 'OVERHEAD_CRANE' },
    });

    expect(res.statusCode).toBe(400);
  });

  // Threat model DEV-24, Threat 1: a create must not be able to seed a record as READY.
  // The strict schema rejects the status field outright rather than silently dropping it.
  it('POST /equipment rejects a body that smuggles a status field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/equipment',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { assetTag: 'MAT-FL-009', name: 'Forklift 9', type: 'FORKLIFT', status: 'READY' },
    });

    expect(res.statusCode).toBe(400);

    // Confirm nothing was inserted under that tag.
    const { db, equipment } = await import('../../db/index.js');
    const { eq } = await import('drizzle-orm');
    const rows = await db.select().from(equipment).where(eq(equipment.assetTag, 'MAT-FL-009'));
    expect(rows).toHaveLength(0);
  });

  // --- update (admin only) ---

  it('PATCH /equipment/:id rejects a non-admin with 403', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/equipment/${seededId}`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: { location: 'MAT Bay C' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('PATCH /equipment/:id updates the provided fields and returns the updated record', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/equipment/${seededId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { location: 'MAT Bay C', make: 'Demag' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.location).toBe('MAT Bay C');
    expect(body.make).toBe('Demag');
    // Status must not change via PATCH.
    expect(body.status).toBe('AWAITING_INSPECTION');
  });

  it('PATCH /equipment/:id returns 404 for an unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/equipment/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { location: 'Nowhere' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().title).toBe('EQUIPMENT_NOT_FOUND');
  });

  it('PATCH /equipment/:id rejects an empty body', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/equipment/${seededId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  // Threat model DEV-24, Threat 1: forcing READY through PATCH is the core risk.
  // The strict schema rejects status outright (400); the row's status is unchanged.
  it('PATCH /equipment/:id rejects a body that tries to force status to READY', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/equipment/${seededId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { status: 'READY' },
    });

    expect(res.statusCode).toBe(400);

    // The persisted status must still be AWAITING_INSPECTION (OHS s.257 readiness gate).
    const verify = await app.inject({
      method: 'GET',
      url: `/api/v1/equipment/${seededId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(verify.json().status).toBe('AWAITING_INSPECTION');
  });

  // Even mixed with a legitimate field, an attempt to set status must fail closed and
  // must not partially apply the legitimate field.
  it('PATCH /equipment/:id rejects status even alongside an editable field', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/equipment/${seededId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { location: 'MAT Bay Z', status: 'READY' },
    });

    expect(res.statusCode).toBe(400);

    // The legitimate field must not have applied: status rejection is all-or-nothing.
    const verify = await app.inject({
      method: 'GET',
      url: `/api/v1/equipment/${seededId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(verify.json().location).not.toBe('MAT Bay Z');
    expect(verify.json().status).toBe('AWAITING_INSPECTION');
  });

  // DEV-82: readiness_baseline_at is a server-set watermark (ADR 0006); only
  // return-to-service may move it. patchEquipmentSchema omits the field, so .strict()
  // rejects any body carrying it, the same mechanism that protects status above.
  it('PATCH /equipment/:id rejects a body that tries to set readinessBaselineAt', async () => {
    const { db, equipment } = await import('../../db/index.js');
    const { eq } = await import('drizzle-orm');
    const [before] = await db.select().from(equipment).where(eq(equipment.id, seededId));

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/equipment/${seededId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { readinessBaselineAt: new Date().toISOString() },
    });

    expect(res.statusCode).toBe(400);

    const [after] = await db.select().from(equipment).where(eq(equipment.id, seededId));
    expect(after!.readinessBaselineAt).toEqual(before!.readinessBaselineAt);
  });
});
