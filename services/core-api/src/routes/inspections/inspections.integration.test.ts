import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { eq, sql } from 'drizzle-orm';
import type { ChecklistItem } from '@mat-inspect/shared-schemas';
import { setJwksForTest } from '../../middleware/auth.js';

const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
const localJwks = createLocalJWKSet({ keys: [publicJwk] });

// Inject the local key set so token verification never reaches the network. The shared
// verifier owns the JWKS fetch (DEV-98); tests hand it keys instead of mocking the module.
setJwksForTest(localJwks);

const ADMIN_ID = '55555555-5555-5555-5555-555555555555';
const OPERATOR_ID = '66666666-6666-6666-6666-666666666666';
const MANAGER_ID = '77777777-7777-7777-7777-777777777777';

const makeToken = async (role: string, sub: string) =>
  new SignJWT({ sub, oid: sub, roles: [role], tid: 'test-tenant' })
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
  },
  {
    key: 'horn',
    prompt: 'Horn sounds when tested',
    type: 'BOOLEAN',
    required: true,
    failSeverity: 'WARNING',
  },
];

describe('inspections API', () => {
  let container: StartedPostgreSqlContainer;
  let app: Awaited<ReturnType<(typeof import('../../app.js'))['buildApp']>>;
  let operatorToken: string;
  let managerToken: string;
  let equipmentId: string;
  let templateId: string;
  let inactiveTemplateId: string;
  let truckTemplateId: string;
  let oosEquipmentId: string;
  let retiredEquipmentId: string;
  let blockingEquipmentId: string;
  let blockingEquipmentId2: string;

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
      { id: ADMIN_ID, displayName: 'Admin User', email: 'admin-insp@example.com' },
      { id: OPERATOR_ID, displayName: 'Operator User', email: 'operator-insp@example.com' },
      { id: MANAGER_ID, displayName: 'Manager User', email: 'manager-insp@example.com' },
    ]);

    const [equipmentRow] = await migrationDb
      .insert(equipment)
      .values({ assetTag: 'FORK-INSP-1', name: 'Forklift 1', type: 'FORKLIFT' })
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

    // A superseded forklift template (not active) to assert submits are graded against the
    // active checklist only.
    const [inactiveTemplateRow] = await migrationDb
      .insert(checklistTemplates)
      .values({
        equipmentType: 'FORKLIFT',
        version: 2,
        isActive: false,
        items: forkliftItems,
        createdBy: ADMIN_ID,
      })
      .returning();
    inactiveTemplateId = inactiveTemplateRow!.id;

    // A template for a different equipment type, to assert the template must match the
    // equipment under inspection.
    const [truckTemplateRow] = await migrationDb
      .insert(checklistTemplates)
      .values({
        equipmentType: 'TRUCK',
        version: 1,
        isActive: true,
        items: forkliftItems,
        createdBy: ADMIN_ID,
      })
      .returning();
    truckTemplateId = truckTemplateRow!.id;

    // Locked-out equipment (DEV-143), to assert a new inspection cannot be submitted against it
    // until return-to-service, regardless of what the submitted responses would derive to.
    const [oosEquipmentRow] = await migrationDb
      .insert(equipment)
      .values({
        assetTag: 'FORK-INSP-OOS',
        name: 'Forklift OOS',
        type: 'FORKLIFT',
        status: 'OUT_OF_SERVICE',
      })
      .returning();
    oosEquipmentId = oosEquipmentRow!.id;

    // Retired equipment (DEV-143): terminal, no repair-and-return-to-service cycle applies, so
    // every submit against it is rejected regardless of result.
    const [retiredEquipmentRow] = await migrationDb
      .insert(equipment)
      .values({
        assetTag: 'FORK-INSP-RETIRED',
        name: 'Forklift Retired',
        type: 'FORKLIFT',
        status: 'RETIRED',
      })
      .returning();
    retiredEquipmentId = retiredEquipmentRow!.id;

    // A separate equipment row for the FAIL_BLOCKING tests: submitting a BLOCKING failure sets
    // equipment.status to OUT_OF_SERVICE (ADR 0006), and every other test in this file reuses the
    // shared `equipmentId` expecting it to still accept a submit (DEV-143 changed that from a
    // no-op status write to a hard 409 gate). Isolating the blocking-failure tests here keeps the
    // shared fixture in its original AWAITING_INSPECTION state for the rest of the suite.
    const [blockingEquipmentRow] = await migrationDb
      .insert(equipment)
      .values({ assetTag: 'FORK-INSP-BLOCKING', name: 'Forklift Blocking', type: 'FORKLIFT' })
      .returning();
    blockingEquipmentId = blockingEquipmentRow!.id;

    // A second one: the FAIL_BLOCKING test above already sets blockingEquipmentId to
    // OUT_OF_SERVICE, so the operatorId/result-derivation test below needs its own equipment to
    // reach the derivation logic instead of being stopped by the DEV-143 gate first.
    const [blockingEquipmentRow2] = await migrationDb
      .insert(equipment)
      .values({ assetTag: 'FORK-INSP-BLOCKING-2', name: 'Forklift Blocking 2', type: 'FORKLIFT' })
      .returning();
    blockingEquipmentId2 = blockingEquipmentRow2!.id;

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

  const submit = (
    payload: Record<string, unknown>,
    opts: { token?: string; idempotencyKey?: string | null } = {},
  ) => {
    const headers: Record<string, string> = {
      authorization: `Bearer ${opts.token ?? operatorToken}`,
    };
    if (opts.idempotencyKey !== null) {
      headers['idempotency-key'] = opts.idempotencyKey ?? randomUUID();
    }
    return app.inject({ method: 'POST', url: '/api/v1/inspections', headers, payload });
  };

  it('rejects a non-operator with 403', async () => {
    const res = await submit(
      { equipmentId, templateId, responses: [], attested: true },
      { token: managerToken },
    );
    expect(res.statusCode).toBe(403);
  });

  it('rejects a submit with no Idempotency-Key header', async () => {
    const res = await submit(
      { equipmentId, templateId, responses: [], attested: true },
      { idempotencyKey: null },
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().title).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('rejects a submit where attested is not literal true', async () => {
    const res = await submit({ equipmentId, templateId, responses: [], attested: false });
    expect(res.statusCode).toBe(400);
  });

  it('derives PASS when every response passes', async () => {
    const res = await submit({
      equipmentId,
      templateId,
      responses: [
        { itemKey: 'forks-condition', value: true, passed: true },
        { itemKey: 'horn', value: true, passed: true },
      ],
      attested: true,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().result).toBe('PASS');
  });

  it('provisions an unknown operator on first submit instead of 500ing on the users FK (DEV-124)', async () => {
    const newOperatorId = randomUUID();
    const token = await makeToken('operator', newOperatorId);

    const res = await submit(
      {
        equipmentId,
        templateId,
        responses: [
          { itemKey: 'forks-condition', value: true, passed: true },
          { itemKey: 'horn', value: true, passed: true },
        ],
        attested: true,
      },
      { token },
    );

    expect(res.statusCode).toBe(201);
    expect(res.json().operatorId).toBe(newOperatorId);

    const { db, users } = await import('../../db/index.js');
    const rows = await db.select().from(users).where(eq(users.id, newOperatorId));
    expect(rows).toHaveLength(1);
  });

  it('provisioning is idempotent: repeated submits by the same new operator keep one users row (DEV-124)', async () => {
    // The upsert is onConflictDoNothing, so a second submit by the same operator succeeds and does
    // not create a duplicate row (nor error on the users.id primary key), whether or not the
    // in-process cache short-circuits the write.
    const newOperatorId = randomUUID();
    const token = await makeToken('operator', newOperatorId);
    const passResponses = [
      { itemKey: 'forks-condition', value: true, passed: true },
      { itemKey: 'horn', value: true, passed: true },
    ];

    const first = await submit(
      { equipmentId, templateId, responses: passResponses, attested: true },
      { token },
    );
    const second = await submit(
      { equipmentId, templateId, responses: passResponses, attested: true },
      { token },
    );

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const { db, users } = await import('../../db/index.js');
    const rows = await db.select().from(users).where(eq(users.id, newOperatorId));
    expect(rows).toHaveLength(1);
  });

  it('derives FAIL_WARNING when only a WARNING item fails', async () => {
    const res = await submit({
      equipmentId,
      templateId,
      responses: [
        { itemKey: 'forks-condition', value: true, passed: true },
        { itemKey: 'horn', value: false, passed: false },
      ],
      attested: true,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().result).toBe('FAIL_WARNING');
  });

  it('derives FAIL_BLOCKING when a BLOCKING item fails, overriding a passing WARNING item', async () => {
    const res = await submit({
      equipmentId: blockingEquipmentId,
      templateId,
      responses: [
        { itemKey: 'forks-condition', value: false, passed: false },
        { itemKey: 'horn', value: true, passed: true },
      ],
      attested: true,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().result).toBe('FAIL_BLOCKING');
  });

  it('ignores a client-supplied operatorId and result, deriving both server-side', async () => {
    const res = await submit({
      equipmentId: blockingEquipmentId2,
      templateId,
      operatorId: MANAGER_ID,
      result: 'PASS',
      responses: [
        { itemKey: 'forks-condition', value: false, passed: false },
        { itemKey: 'horn', value: true, passed: true },
      ],
      attested: true,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.operatorId).toBe(OPERATOR_ID);
    expect(body.result).toBe('FAIL_BLOCKING');
  });

  it('commits the inspection, its responses, and an outbox row together', async () => {
    const res = await submit({
      equipmentId,
      templateId,
      responses: [
        { itemKey: 'forks-condition', value: true, passed: true },
        { itemKey: 'horn', value: true, passed: true },
      ],
      attested: true,
    });
    expect(res.statusCode).toBe(201);
    const inspectionId = res.json().id;

    const { db, inspections, inspectionResponses, outbox } = await import('../../db/index.js');
    const [inspRow] = await db.select().from(inspections).where(eq(inspections.id, inspectionId));
    const responseRows = await db
      .select()
      .from(inspectionResponses)
      .where(eq(inspectionResponses.inspectionId, inspectionId));
    expect(responseRows).toHaveLength(2);

    const outboxRows = await db
      .select()
      .from(outbox)
      .where(eq(outbox.eventType, 'INSPECTION_SUBMITTED'));
    const matching = outboxRows.filter(
      (row) => (row.payload as { inspectionId?: string }).inspectionId === inspectionId,
    );
    expect(matching).toHaveLength(1);

    // ADR 0008: outbox payload must carry a content_hash sealing inspection + responses + result.
    const payload = matching[0]!.payload as Record<string, unknown>;
    expect(typeof payload['contentHash']).toBe('string');
    expect(payload['contentHash'] as string).toHaveLength(64); // sha256 hex

    // Recompute from the actually-persisted rows to prove a later verifier can reproduce the
    // same hash from core_db — the whole mechanism for detecting a post-hoc edit (ADR 0008).
    const { computeInspectionContentHash } = await import('@mat-inspect/shared-crypto');
    const recomputed = computeInspectionContentHash({
      inspectionId: inspRow!.id,
      equipmentId: inspRow!.equipmentId,
      operatorId: inspRow!.operatorId,
      templateId: inspRow!.templateId,
      templateVersion: inspRow!.templateVersion,
      result: inspRow!.result,
      submittedAt: inspRow!.submittedAt.toISOString(),
      responses: responseRows.map((r) => ({
        itemKey: r.itemKey,
        value: r.value,
        passed: r.passed,
        notes: r.notes ?? null,
        notesSource: r.notesSource ?? null,
        photoIds: r.photoIds,
        defectCategory: r.defectCategory ?? null,
      })),
    });
    expect(recomputed).toBe(payload['contentHash']);
  });

  it('rejects UPDATE and DELETE on inspections via trigger', async () => {
    const res = await submit({
      equipmentId,
      templateId,
      responses: [
        { itemKey: 'forks-condition', value: true, passed: true },
        { itemKey: 'horn', value: true, passed: true },
      ],
      attested: true,
    });
    const inspectionId = res.json().id;

    const { db } = await import('../../db/index.js');
    await expect(
      db.execute(sql`UPDATE inspections SET result = 'PASS' WHERE id = ${inspectionId}`),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`DELETE FROM inspections WHERE id = ${inspectionId}`),
    ).rejects.toThrow();
  });

  it('rejects UPDATE and DELETE on inspection_responses via trigger', async () => {
    const res = await submit({
      equipmentId,
      templateId,
      responses: [
        { itemKey: 'forks-condition', value: true, passed: true },
        { itemKey: 'horn', value: true, passed: true },
      ],
      attested: true,
    });
    const inspectionId = res.json().id;

    const { db, inspectionResponses } = await import('../../db/index.js');
    const [responseRow] = await db
      .select()
      .from(inspectionResponses)
      .where(eq(inspectionResponses.inspectionId, inspectionId))
      .limit(1);

    await expect(
      db.execute(sql`UPDATE inspection_responses SET passed = false WHERE id = ${responseRow!.id}`),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`DELETE FROM inspection_responses WHERE id = ${responseRow!.id}`),
    ).rejects.toThrow();
  });

  it('replays the original 201 for a duplicate Idempotency-Key with the same body, creating no second inspection', async () => {
    const key = randomUUID();
    const payload = {
      equipmentId,
      templateId,
      responses: [
        { itemKey: 'forks-condition', value: true, passed: true },
        { itemKey: 'horn', value: true, passed: true },
      ],
      attested: true,
    };

    const first = await submit(payload, { idempotencyKey: key });
    expect(first.statusCode).toBe(201);
    const firstId = first.json().id;

    const second = await submit(payload, { idempotencyKey: key });
    expect(second.statusCode).toBe(201);
    expect(second.json().id).toBe(firstId);

    const { db, inspections } = await import('../../db/index.js');
    const rows = await db.select().from(inspections).where(eq(inspections.id, firstId));
    expect(rows).toHaveLength(1);
  });

  it('rejects a duplicate Idempotency-Key reused with a different body as 409 IDEMPOTENCY_MISMATCH', async () => {
    const key = randomUUID();
    const first = await submit(
      {
        equipmentId,
        templateId,
        responses: [
          { itemKey: 'forks-condition', value: true, passed: true },
          { itemKey: 'horn', value: true, passed: true },
        ],
        attested: true,
      },
      { idempotencyKey: key },
    );
    expect(first.statusCode).toBe(201);

    const second = await submit(
      {
        equipmentId,
        templateId,
        responses: [
          { itemKey: 'forks-condition', value: true, passed: true },
          { itemKey: 'horn', value: false, passed: false },
        ],
        attested: true,
      },
      { idempotencyKey: key },
    );
    expect(second.statusCode).toBe(409);
    expect(second.json().title).toBe('IDEMPOTENCY_MISMATCH');
  });

  it('rejects a submit that omits a required checklist item with 400', async () => {
    const res = await submit({
      equipmentId,
      templateId,
      responses: [{ itemKey: 'forks-condition', value: true, passed: true }],
      attested: true,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().title).toBe('INSPECTION_MISSING_REQUIRED_ITEM');
  });

  it('does not derive PASS from an empty responses array when items are required', async () => {
    const res = await submit({ equipmentId, templateId, responses: [], attested: true });
    expect(res.statusCode).toBe(400);
    expect(res.json().title).toBe('INSPECTION_MISSING_REQUIRED_ITEM');
  });

  it('returns 404 for a well-formed but unknown equipmentId', async () => {
    const res = await submit({
      equipmentId: randomUUID(),
      templateId,
      responses: [
        { itemKey: 'forks-condition', value: true, passed: true },
        { itemKey: 'horn', value: true, passed: true },
      ],
      attested: true,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().title).toBe('EQUIPMENT_NOT_FOUND');
  });

  it('rejects a template whose equipment type does not match the equipment with 400', async () => {
    const res = await submit({
      equipmentId,
      templateId: truckTemplateId,
      responses: [
        { itemKey: 'forks-condition', value: true, passed: true },
        { itemKey: 'horn', value: true, passed: true },
      ],
      attested: true,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().title).toBe('INSPECTION_TEMPLATE_MISMATCH');
  });

  it('rejects a submit against an inactive template with 409', async () => {
    const res = await submit({
      equipmentId,
      templateId: inactiveTemplateId,
      responses: [
        { itemKey: 'forks-condition', value: true, passed: true },
        { itemKey: 'horn', value: true, passed: true },
      ],
      attested: true,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().title).toBe('INSPECTION_TEMPLATE_INACTIVE');
  });

  it('rejects a fully-passing submit against OUT_OF_SERVICE equipment with 409 (DEV-143)', async () => {
    const res = await submit({
      equipmentId: oosEquipmentId,
      templateId,
      responses: [
        { itemKey: 'forks-condition', value: true, passed: true },
        { itemKey: 'horn', value: true, passed: true },
      ],
      attested: true,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().title).toBe('EQUIPMENT_OUT_OF_SERVICE');
  });

  it('rejects a FAIL_WARNING-only submit against OUT_OF_SERVICE equipment with 409 (DEV-143)', async () => {
    const res = await submit({
      equipmentId: oosEquipmentId,
      templateId,
      responses: [
        { itemKey: 'forks-condition', value: true, passed: true },
        { itemKey: 'horn', value: false, passed: false },
      ],
      attested: true,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().title).toBe('EQUIPMENT_OUT_OF_SERVICE');
  });

  it('accepts a FAIL_BLOCKING submit against OUT_OF_SERVICE equipment, opening another defect in the same lockout cycle (DEV-143)', async () => {
    const res = await submit({
      equipmentId: oosEquipmentId,
      templateId,
      responses: [
        { itemKey: 'forks-condition', value: false, passed: false },
        { itemKey: 'horn', value: true, passed: true },
      ],
      attested: true,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().result).toBe('FAIL_BLOCKING');
  });

  it('rejects any submit against RETIRED equipment with 409, regardless of result (DEV-143)', async () => {
    const res = await submit({
      equipmentId: retiredEquipmentId,
      templateId,
      responses: [
        { itemKey: 'forks-condition', value: true, passed: true },
        { itemKey: 'horn', value: true, passed: true },
      ],
      attested: true,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().title).toBe('EQUIPMENT_RETIRED');
  });
});
