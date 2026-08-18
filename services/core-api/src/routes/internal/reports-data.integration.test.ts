import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const INTERNAL_TOKEN = 'reports-data-test-token';
// users.id has no default: it stores the Entra oid directly (db/schema/users.ts), so an insert
// must always supply one explicitly.
const OPERATOR_ID = randomUUID();
const BRAKE_PHOTO_A = randomUUID();
const BRAKE_PHOTO_B = randomUUID();

describe('POST /internal/reports-data', () => {
  let container: import('@testcontainers/postgresql').StartedPostgreSqlContainer;
  let app: Awaited<ReturnType<(typeof import('../../app.js'))['buildApp']>>;
  let equipmentId: string;
  let operatorId: string;

  beforeAll(async () => {
    delete process.env['ENTRA_TENANT_ID'];
    delete process.env['ENTRA_CLIENT_ID'];
    process.env['CORE_API_INTERNAL_TOKEN'] = INTERNAL_TOKEN;

    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env['DATABASE_URL'] = container.getConnectionUri();

    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { equipment, users, checklistTemplates, inspections, inspectionResponses, defects } =
      await import('@mat-inspect/db');

    const migrationPool = new pg.Pool({ connectionString: container.getConnectionUri() });
    const migrationDb = drizzle(migrationPool);
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    await migrate(migrationDb, {
      migrationsFolder: path.join(__dirname, '../../../../../db/migrations'),
    });

    const [operator] = await migrationDb
      .insert(users)
      .values({ id: OPERATOR_ID, displayName: 'Jane Doe', email: 'jane@example.com' })
      .returning();
    operatorId = operator!.id;

    const [equipmentRow] = await migrationDb
      .insert(equipment)
      .values({
        assetTag: 'MAT-FL-001',
        name: 'Forklift 1',
        type: 'FORKLIFT',
        location: 'MAT Warehouse',
      })
      .returning();
    equipmentId = equipmentRow!.id;

    const [template] = await migrationDb
      .insert(checklistTemplates)
      .values({
        equipmentType: 'FORKLIFT',
        version: 1,
        isActive: true,
        items: [
          {
            key: 'brakes',
            prompt: 'Brakes engage cleanly?',
            type: 'BOOLEAN',
            required: true,
            failSeverity: 'BLOCKING',
          },
        ],
        createdBy: operatorId,
      })
      .returning();

    const [inspection] = await migrationDb
      .insert(inspections)
      .values({
        equipmentId,
        operatorId,
        templateId: template!.id,
        templateVersion: 1,
        result: 'FAIL_BLOCKING',
        submittedAt: new Date('2026-05-19T18:31:42.123Z'),
      })
      .returning();

    await migrationDb.insert(inspectionResponses).values({
      inspectionId: inspection!.id,
      itemKey: 'brakes',
      value: false,
      passed: false,
      notes: 'Grinding noise on engagement',
      notesSource: 'TYPED',
      photoIds: [BRAKE_PHOTO_A, BRAKE_PHOTO_B],
    });

    await migrationDb.insert(defects).values({
      inspectionId: inspection!.id,
      equipmentId,
      itemKey: 'brakes',
      severity: 'BLOCKING',
      description: 'Grinding noise on engagement',
    });

    await migrationPool.end();

    const { buildApp } = await import('../../app.js');
    app = await buildApp();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    const { db } = await import('../../db/index.js');
    await db.$client.end();
    await container?.stop();
  });

  const post = (body: unknown, token?: string) =>
    app.inject({
      method: 'POST',
      url: '/internal/reports-data',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: body,
    });

  it('returns 401 with no token', async () => {
    const res = await post({
      equipmentIds: [equipmentId],
      dateFrom: '2026-01-01T00:00:00Z',
      dateTo: '2026-12-31T23:59:59Z',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with the wrong token', async () => {
    const res = await post(
      {
        equipmentIds: [equipmentId],
        dateFrom: '2026-01-01T00:00:00Z',
        dateTo: '2026-12-31T23:59:59Z',
      },
      'wrong-token',
    );
    expect(res.statusCode).toBe(401);
  });

  it('returns equipment and inspection detail, with the checklist prompt and operator name joined in', async () => {
    const res = await post(
      {
        equipmentIds: [equipmentId],
        dateFrom: '2026-01-01T00:00:00Z',
        dateTo: '2026-12-31T23:59:59Z',
      },
      INTERNAL_TOKEN,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.equipment).toHaveLength(1);
    expect(body.equipment[0].assetTag).toBe('MAT-FL-001');

    expect(body.inspections).toHaveLength(1);
    const inspection = body.inspections[0];
    expect(inspection.operatorDisplayName).toBe('Jane Doe');
    expect(inspection.result).toBe('FAIL_BLOCKING');
    expect(inspection.responses).toEqual([
      {
        itemKey: 'brakes',
        prompt: 'Brakes engage cleanly?',
        value: false,
        passed: false,
        notes: 'Grinding noise on engagement',
        notesSource: 'TYPED',
        photoIds: [BRAKE_PHOTO_A, BRAKE_PHOTO_B],
        defectCategory: null,
      },
    ]);
    expect(inspection.defects).toHaveLength(1);
    expect(inspection.defects[0].severity).toBe('BLOCKING');
  });

  it('returns no inspections outside the requested date range', async () => {
    const res = await post(
      {
        equipmentIds: [equipmentId],
        dateFrom: '2020-01-01T00:00:00Z',
        dateTo: '2020-01-02T00:00:00Z',
      },
      INTERNAL_TOKEN,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().inspections).toEqual([]);
    // Equipment summary is returned regardless of whether it has inspections in range.
    expect(res.json().equipment).toHaveLength(1);
  });
});
