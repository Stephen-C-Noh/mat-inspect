import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { UserRole } from '@mat-inspect/shared-types';
import type { ChecklistItem } from '@mat-inspect/shared-schemas';

// Pins the App Role -> permission mapping end-to-end (DEV-25). Authorization is declared
// per route via requireRole (CLAUDE.md Auth); there is no central policy.ts. Each role gets
// a real signed token and hits representative endpoints, asserting allow vs deny.

const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
const localJwks = createLocalJWKSet({ keys: [publicJwk] });

vi.mock('../lib/jwks.js', () => ({
  getJwks: () => localJwks,
  resetJwksForTest: vi.fn(),
}));

// One seeded user per App Role. Operator and Admin own FK-referenced rows (createdBy), so
// every role has a real users row even though only some endpoints touch the table.
const USER_IDS: Record<UserRole, string> = {
  operator: '44444444-4444-4444-4444-444444444444',
  supervisor: '55555555-5555-5555-5555-555555555555',
  manager: '66666666-6666-6666-6666-666666666666',
  admin: '33333333-3333-3333-3333-333333333333',
};

const ALL_ROLES = Object.keys(USER_IDS) as UserRole[];

const makeToken = async (role: UserRole) =>
  new SignJWT({ sub: USER_IDS[role], oid: USER_IDS[role], roles: [role], tid: 'test-tenant' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privateKey);

const forkliftItems: ChecklistItem[] = [
  {
    key: 'forks-condition',
    prompt: 'Forks free of cracks, bends, and excessive wear',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
    regulatoryReference: 'OHS Part 19 s.257',
  },
];

describe('role-to-permission authorization matrix', () => {
  let container: StartedPostgreSqlContainer;
  let app: Awaited<ReturnType<(typeof import('../app.js'))['buildApp']>>;
  const tokens = {} as Record<UserRole, string>;

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
      migrationsFolder: path.join(__dirname, '../../../../db/migrations'),
    });

    await migrationDb.insert(users).values(
      ALL_ROLES.map((role) => ({
        id: USER_IDS[role],
        displayName: `${role} user`,
        email: `${role}@example.com`,
      })),
    );

    // Seed one active FORKLIFT template so GET /checklists/active returns 200 for any
    // role that passes authorization (the test asserts allow, not the 404 empty case).
    const { checklistTemplates } = await import('../db/index.js');
    await migrationDb.insert(checklistTemplates).values({
      equipmentType: 'FORKLIFT',
      version: 1,
      isActive: true,
      items: forkliftItems,
      createdBy: USER_IDS.admin,
      reviewedBy: USER_IDS.operator,
    });
    await migrationPool.end();

    const { buildApp } = await import('../app.js');
    app = await buildApp();

    for (const role of ALL_ROLES) {
      tokens[role] = await makeToken(role);
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    const { db } = await import('../db/index.js');
    await db.$client.end();
    await container?.stop();
  });

  // POST /api/v1/checklists is admin-only (requireRole('admin')).
  it.each(ALL_ROLES)('POST /checklists: %s', async (role) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/checklists',
      headers: { authorization: `Bearer ${tokens[role]}` },
      payload: { equipmentType: 'TRUCK', items: forkliftItems, reviewedBy: USER_IDS.operator },
    });

    if (role === 'admin') {
      expect(res.statusCode).toBe(201);
    } else {
      expect(res.statusCode).toBe(403);
      expect(res.json().title).toBe('FORBIDDEN');
    }
  });

  // GET /api/v1/equipment is operator-only (requireRole('operator')).
  it.each(ALL_ROLES)('GET /equipment: %s', async (role) => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/equipment',
      headers: { authorization: `Bearer ${tokens[role]}` },
    });

    if (role === 'operator') {
      expect(res.statusCode).toBe(200);
    } else {
      expect(res.statusCode).toBe(403);
      expect(res.json().title).toBe('FORBIDDEN');
    }
  });

  // GET /api/v1/checklists/active accepts all four App Roles.
  it.each(ALL_ROLES)('GET /checklists/active allows %s', async (role) => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/checklists/active?type=FORKLIFT',
      headers: { authorization: `Bearer ${tokens[role]}` },
    });

    expect(res.statusCode).toBe(200);
  });
});
