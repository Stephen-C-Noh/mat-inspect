import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { ChecklistItem } from '@mat-inspect/shared-schemas';
import { setJwksForTest } from '../../middleware/auth.js';

// Mock only the external SMTP boundary (CLAUDE.md: mock external services only). vi.hoisted runs
// before the hoisted vi.mock factory so the spy can be referenced inside it. Asserting on
// sendMail is how this test observes "the notifier was invoked" without mocking internal modules.
const { createTransportMock, sendMailMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn();
  const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));
  return { createTransportMock, sendMailMock };
});
vi.mock('nodemailer', () => ({ default: { createTransport: createTransportMock } }));

const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
const localJwks = createLocalJWKSet({ keys: [publicJwk] });

// Inject the local key set so token verification never reaches the network. The shared
// verifier owns the JWKS fetch (DEV-98); tests hand it keys instead of mocking the module.
setJwksForTest(localJwks);

const ADMIN_ID = '55555555-5555-5555-5555-555555555555';
const OPERATOR_ID = '66666666-6666-6666-6666-666666666666';
const SUPERVISOR_EMAILS = ['sup1@sait.ca', 'sup2@sait.ca'];

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

describe('failed-inspection email wiring (DEV-81)', () => {
  let container: StartedPostgreSqlContainer;
  let app: Awaited<ReturnType<(typeof import('../../app.js'))['buildApp']>>;
  let operatorToken: string;
  let equipmentId: string;
  let blockingEquipmentId: string;
  let templateId: string;

  beforeAll(async () => {
    delete process.env['ENTRA_TENANT_ID'];
    delete process.env['ENTRA_CLIENT_ID'];
    // Configure the email channel: an SMTP relay (nodemailer is mocked, so no real connection) and
    // a supervisor recipient list. Set before buildApp so config() reads them on first call.
    process.env['SMTP_HOST'] = 'smtp.example.test';
    process.env['SMTP_USER'] = 'mat-inspect';
    process.env['SMTP_PASS'] = 'test-password';
    process.env['SUPERVISOR_ALERT_EMAILS'] = SUPERVISOR_EMAILS.join(', ');
    sendMailMock.mockResolvedValue({ messageId: 'test' });

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
      { id: ADMIN_ID, displayName: 'Admin User', email: 'admin-email@example.com' },
      { id: OPERATOR_ID, displayName: 'Operator User', email: 'operator-email@example.com' },
    ]);

    const [equipmentRow] = await migrationDb
      .insert(equipment)
      .values({ assetTag: 'FORK-EMAIL-1', name: 'Forklift 1', type: 'FORKLIFT' })
      .returning();
    equipmentId = equipmentRow!.id;

    // A separate equipment row for the FAIL_BLOCKING test: submitting a BLOCKING failure sets
    // equipment.status to OUT_OF_SERVICE (ADR 0006), and the PASS/FAIL_WARNING tests below reuse
    // the shared `equipmentId` expecting it to still accept a submit (DEV-143 rejects a PASS or
    // FAIL_WARNING-only submit against OUT_OF_SERVICE equipment with 409).
    const [blockingEquipmentRow] = await migrationDb
      .insert(equipment)
      .values({ assetTag: 'FORK-EMAIL-BLOCKING', name: 'Forklift Blocking', type: 'FORKLIFT' })
      .returning();
    blockingEquipmentId = blockingEquipmentRow!.id;

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
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    const { db } = await import('../../db/index.js');
    await db.$client.end();
    await container?.stop();
    delete process.env['SMTP_HOST'];
    delete process.env['SMTP_USER'];
    delete process.env['SMTP_PASS'];
    delete process.env['SUPERVISOR_ALERT_EMAILS'];
  });

  const submit = (responses: Array<Record<string, unknown>>, targetEquipmentId = equipmentId) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/inspections',
      headers: {
        authorization: `Bearer ${operatorToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: { equipmentId: targetEquipmentId, templateId, responses, attested: true },
    });

  const passingResponses = [
    { itemKey: 'forks-condition', value: true, passed: true },
    { itemKey: 'horn', value: true, passed: true },
  ];

  it('sends the supervisor email on FAIL_BLOCKING with recipients, asset tag, operator, and defect', async () => {
    sendMailMock.mockClear();
    const res = await submit(
      [
        { itemKey: 'forks-condition', value: false, passed: false },
        { itemKey: 'horn', value: true, passed: true },
      ],
      blockingEquipmentId,
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().result).toBe('FAIL_BLOCKING');

    // The notifier runs fire-and-forget after the 201, so wait for the mocked send to land.
    await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalledTimes(1));
    const message = sendMailMock.mock.calls[0]![0] as {
      to: string[];
      subject: string;
      text: string;
    };
    expect(message.to).toEqual(SUPERVISOR_EMAILS);
    expect(message.subject).toContain('FORK-EMAIL-BLOCKING');
    expect(message.subject).not.toContain('Operator User'); // no PII in the subject (FRS AC-8.1.3)
    expect(message.text).toContain('Operator User'); // display name resolved from the users table
    expect(message.text).toContain('Forks free of cracks, bends, and excessive wear');
  });

  it('does not send an email on PASS', async () => {
    sendMailMock.mockClear();
    const res = await submit(passingResponses);
    expect(res.statusCode).toBe(201);
    expect(res.json().result).toBe('PASS');
    // The dispatch is gated on the result, so nothing is scheduled. Give any stray async a tick.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('does not send an email on FAIL_WARNING', async () => {
    sendMailMock.mockClear();
    const res = await submit([
      { itemKey: 'forks-condition', value: true, passed: true },
      { itemKey: 'horn', value: false, passed: false },
    ]);
    expect(res.statusCode).toBe(201);
    expect(res.json().result).toBe('FAIL_WARNING');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
