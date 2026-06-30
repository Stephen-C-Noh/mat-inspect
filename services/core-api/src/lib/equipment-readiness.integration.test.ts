import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import type { ChecklistItem } from '@mat-inspect/shared-schemas';

const ADMIN_ID = '88888888-8888-8888-8888-888888888888';

const forkliftItems: ChecklistItem[] = [
  {
    key: 'forks-condition',
    prompt: 'Forks free of cracks, bends, and excessive wear',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'BLOCKING',
  },
];

// One calendar day earlier than "now" in any timezone: a 48h offset cannot land on the same
// lab-local day as now even across a DST transition (which only ever shifts by 1h).
const TWO_DAYS_AGO = new Date(Date.now() - 48 * 60 * 60 * 1000);

describe('computeReadiness (ADR 0006)', () => {
  let container: StartedPostgreSqlContainer;
  let templateId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env['DATABASE_URL'] = container.getConnectionUri();
    process.env['NODE_ENV'] = 'test';

    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { users, checklistTemplates } = await import('@mat-inspect/db');

    const migrationPool = new pg.Pool({ connectionString: container.getConnectionUri() });
    const migrationDb = drizzle(migrationPool);
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    await migrate(migrationDb, {
      migrationsFolder: path.join(__dirname, '../../../../db/migrations'),
    });

    await migrationDb
      .insert(users)
      .values({ id: ADMIN_ID, displayName: 'Admin User', email: 'admin-readiness@example.com' });

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
  }, 120_000);

  afterAll(async () => {
    const { db } = await import('../db/index.js');
    await db.$client.end();
    await container?.stop();
  });

  // Inserts one piece of equipment for an isolated scenario; each test gets its own row so
  // assertions cannot bleed across cases.
  const makeEquipment = async (assetTag: string) => {
    const { db, equipment } = await import('../db/index.js');
    const [row] = await db
      .insert(equipment)
      .values({ assetTag, name: assetTag, type: 'FORKLIFT' })
      .returning();
    return row!;
  };

  const insertPassingInspection = async (equipmentId: string, submittedAt: Date) => {
    const { db, inspections } = await import('../db/index.js');
    await db.insert(inspections).values({
      equipmentId,
      operatorId: ADMIN_ID,
      templateId,
      templateVersion: 1,
      result: 'PASS',
      submittedAt,
    });
  };

  it('yields READY for a passing inspection submitted today', async () => {
    const { computeReadiness } = await import('./equipment-readiness.js');
    const row = await makeEquipment('READY-TODAY');
    await insertPassingInspection(row.id, new Date());

    const result = await computeReadiness([row]);

    expect(result.get(row.id)).toBe('READY');
  });

  it('does not yield READY for a passing inspection from a prior calendar day', async () => {
    const { computeReadiness } = await import('./equipment-readiness.js');
    const row = await makeEquipment('STALE-INSPECTION');
    await insertPassingInspection(row.id, TWO_DAYS_AGO);

    const result = await computeReadiness([row]);

    expect(result.get(row.id)).toBe('AWAITING_INSPECTION');
  });

  it('does not yield READY when the passing inspection predates readiness_baseline_at', async () => {
    const { db, equipment } = await import('../db/index.js');
    const { computeReadiness } = await import('./equipment-readiness.js');
    const row = await makeEquipment('PREDATES-BASELINE');

    // Inspection submitted today, but the watermark (return-to-service) moves later, same day.
    await insertPassingInspection(row.id, new Date(Date.now() - 10 * 60 * 1000));
    const [updated] = await db
      .update(equipment)
      .set({ readinessBaselineAt: new Date(Date.now() - 5 * 60 * 1000) })
      .where(eq(equipment.id, row.id))
      .returning();

    const result = await computeReadiness([updated!]);

    expect(result.get(row.id)).toBe('AWAITING_INSPECTION');
  });

  it('OUT_OF_SERVICE overrides a same-day passing inspection', async () => {
    const { db, equipment } = await import('../db/index.js');
    const { computeReadiness } = await import('./equipment-readiness.js');
    const row = await makeEquipment('OOS-OVERRIDE');
    await insertPassingInspection(row.id, new Date());
    const [updated] = await db
      .update(equipment)
      .set({ status: 'OUT_OF_SERVICE' })
      .where(eq(equipment.id, row.id))
      .returning();

    const result = await computeReadiness([updated!]);

    expect(result.get(row.id)).toBe('OUT_OF_SERVICE');
  });

  it('RETIRED overrides a same-day passing inspection', async () => {
    const { db, equipment } = await import('../db/index.js');
    const { computeReadiness } = await import('./equipment-readiness.js');
    const row = await makeEquipment('RETIRED-OVERRIDE');
    await insertPassingInspection(row.id, new Date());
    const [updated] = await db
      .update(equipment)
      .set({ status: 'RETIRED' })
      .where(eq(equipment.id, row.id))
      .returning();

    const result = await computeReadiness([updated!]);

    expect(result.get(row.id)).toBe('RETIRED');
  });

  it('an open blocking defect blocks READY despite a same-day passing inspection', async () => {
    const { db, defects, inspections } = await import('../db/index.js');
    const { computeReadiness } = await import('./equipment-readiness.js');
    const row = await makeEquipment('BLOCKED-BY-DEFECT');
    await insertPassingInspection(row.id, new Date());
    const [inspection] = await db
      .select()
      .from(inspections)
      .where(eq(inspections.equipmentId, row.id))
      .limit(1);

    await db.insert(defects).values({
      inspectionId: inspection!.id,
      equipmentId: row.id,
      itemKey: 'forks-condition',
      severity: 'BLOCKING',
      description: 'Cracked fork tine',
      status: 'OPEN',
    });

    const result = await computeReadiness([row]);

    expect(result.get(row.id)).toBe('AWAITING_INSPECTION');
  });

  it('a resolved defect does not block READY', async () => {
    const { db, defects, inspections } = await import('../db/index.js');
    const { computeReadiness } = await import('./equipment-readiness.js');
    const row = await makeEquipment('RESOLVED-DEFECT');
    await insertPassingInspection(row.id, new Date());
    const [inspection] = await db
      .select()
      .from(inspections)
      .where(eq(inspections.equipmentId, row.id))
      .limit(1);

    await db.insert(defects).values({
      inspectionId: inspection!.id,
      equipmentId: row.id,
      itemKey: 'forks-condition',
      severity: 'BLOCKING',
      description: 'Cracked fork tine, since repaired',
      status: 'RESOLVED',
    });

    const result = await computeReadiness([row]);

    expect(result.get(row.id)).toBe('READY');
  });

  it('yields AWAITING_INSPECTION when no passing inspection exists', async () => {
    const { computeReadiness } = await import('./equipment-readiness.js');
    const row = await makeEquipment('NEVER-INSPECTED');

    const result = await computeReadiness([row]);

    expect(result.get(row.id)).toBe('AWAITING_INSPECTION');
  });
});
