import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { ReportsInternalData } from '@mat-inspect/shared-schemas';

const AZURITE_ACCOUNT = 'devstoreaccount1';
const AZURITE_KEY =
  'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';
const buildStorageConnectionString = (host: string, port: number): string =>
  `DefaultEndpointsProtocol=http;AccountName=${AZURITE_ACCOUNT};AccountKey=${AZURITE_KEY};` +
  `BlobEndpoint=http://${host}:${port}/${AZURITE_ACCOUNT};`;

const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_MANAGER_ID = '33333333-3333-4333-8333-333333333333';
const EQUIPMENT_ID = '44444444-4444-4444-8444-444444444444';
const INSPECTION_ID = '55555555-5555-4555-8555-555555555555';

const CANNED_DATA: ReportsInternalData = {
  equipment: [
    {
      id: EQUIPMENT_ID,
      assetTag: 'MAT-FL-001',
      name: 'Forklift 1',
      type: 'FORKLIFT',
      location: 'MAT Warehouse',
      status: 'READY',
    },
  ],
  inspections: [
    {
      id: INSPECTION_ID,
      equipmentId: EQUIPMENT_ID,
      operatorId: OWNER_ID,
      operatorDisplayName: 'Jane Doe',
      templateId: '66666666-6666-4666-8666-666666666666',
      templateVersion: 1,
      result: 'PASS',
      submittedAt: '2026-05-19T18:31:42.123000Z',
      responses: [
        {
          itemKey: 'brakes',
          prompt: 'Brakes engage cleanly?',
          value: true,
          passed: true,
          notes: null,
          notesSource: null,
          photoIds: [],
        },
      ],
      defects: [],
    },
  ],
};

describe('report export routes (DEV-38)', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let azuriteContainer: StartedTestContainer;
  let app: Awaited<ReturnType<(typeof import('../../app.js'))['buildApp']>>;
  let makeToken: (role: string, sub: string) => Promise<string>;

  const waitForJobToSettle = async (
    jobId: string,
    token: string,
  ): Promise<Record<string, unknown>> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/reports/${jobId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      const body = res.json();
      if (body.status !== 'PROCESSING') return body;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`job ${jobId} never left PROCESSING`);
  };

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['AUDIT_INGEST_TOKEN'] = 'ingest-test-token';
    process.env['CORE_API_INTERNAL_TOKEN'] = 'internal-test-token';

    const { privateKey: rsaPrivateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env['REPORT_SIGNING_PRIVATE_KEY'] = rsaPrivateKey
      .export({ type: 'pkcs1', format: 'pem' })
      .toString();

    pgContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env['DATABASE_URL'] = pgContainer.getConnectionUri();

    azuriteContainer = await new GenericContainer('mcr.microsoft.com/azure-storage/azurite:3.33.0')
      .withCommand(['azurite-blob', '--blobHost', '0.0.0.0', '--skipApiVersionCheck'])
      .withExposedPorts(10000)
      .withWaitStrategy(Wait.forLogMessage(/Azurite Blob service successfully listens/))
      .withStartupTimeout(120_000)
      .start();
    process.env['AZURE_STORAGE_CONNECTION_STRING'] = buildStorageConnectionString(
      azuriteContainer.getHost(),
      azuriteContainer.getMappedPort(10000),
    );

    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { sql } = await import('drizzle-orm');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const migrationDb = drizzle(pgContainer.getConnectionUri());
    await migrationDb.execute(sql`CREATE ROLE audit_writer`);
    await migrate(migrationDb, {
      migrationsFolder: path.join(__dirname, '../../../db/migrations'),
    });
    await migrationDb.$client.end();

    const { resetConfigForTest } = await import('../../lib/config.js');
    const { resetBlobClientsForTest } = await import('../../lib/blob-storage.js');
    const { resetSigningKeyForTest } = await import('../../lib/report-signing.js');
    resetConfigForTest();
    resetBlobClientsForTest();
    resetSigningKeyForTest();

    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
    const localJwks = createLocalJWKSet({ keys: [publicJwk] });
    const { setJwksForTest } = await import('../../middleware/auth.js');
    setJwksForTest(localJwks);

    makeToken = async (role: string, sub: string) =>
      new SignJWT({ sub, oid: sub, roles: [role], tid: 'test-tenant' })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-1' })
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(privateKey);

    const { buildApp } = await import('../../app.js');
    app = await buildApp();
  }, 180_000);

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url).endsWith('/internal/reports-data')) {
          return new Response(JSON.stringify(CANNED_DATA), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`unexpected fetch to ${String(url)}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await app?.close();
    const { db } = await import('../../db/index.js');
    await db.$client.end();
    await pgContainer?.stop();
    await azuriteContainer?.stop();
  });

  it('rejects an unauthenticated export request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/export',
      payload: {
        format: 'PDF',
        filters: {
          equipmentIds: [EQUIPMENT_ID],
          dateFrom: '2026-01-01T00:00:00Z',
          dateTo: '2026-12-31T23:59:59Z',
        },
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an operator - exports are for supervisor/manager/auditor/admin only', async () => {
    const operatorToken = await makeToken('operator', OWNER_ID);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/export',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        format: 'PDF',
        filters: {
          equipmentIds: [EQUIPMENT_ID],
          dateFrom: '2026-01-01T00:00:00Z',
          dateTo: '2026-12-31T23:59:59Z',
        },
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('runs a PDF export end to end: accepts, generates, signs, and becomes downloadable', async () => {
    const auditorToken = await makeToken('auditor', OWNER_ID);

    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/export',
      headers: { authorization: `Bearer ${auditorToken}` },
      payload: {
        format: 'PDF',
        filters: {
          equipmentIds: [EQUIPMENT_ID],
          dateFrom: '2026-01-01T00:00:00Z',
          dateTo: '2026-12-31T23:59:59Z',
        },
      },
    });
    expect(submit.statusCode).toBe(202);
    const { jobId, status } = submit.json();
    expect(status).toBe('PROCESSING');

    const settled = await waitForJobToSettle(jobId, auditorToken);
    expect(settled['status']).toBe('READY');
    expect(settled['downloadUrl']).toBe(`/api/v1/reports/${jobId}/download`);
    expect(settled['sha256']).toHaveLength(64);
    expect(typeof settled['signature']).toBe('string');
    expect(settled['signingKeyFingerprint']).toHaveLength(64);
    expect(settled['inspectionCount']).toBe(1);
    expect(settled['format']).toBe('PDF');
  });

  it('generates a single-inspection PDF in under 3 seconds (NFR)', async () => {
    const auditorToken = await makeToken('auditor', OWNER_ID);

    const startedAt = Date.now();
    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/export',
      headers: { authorization: `Bearer ${auditorToken}` },
      payload: {
        format: 'PDF',
        filters: {
          equipmentIds: [EQUIPMENT_ID],
          dateFrom: '2026-01-01T00:00:00Z',
          dateTo: '2026-12-31T23:59:59Z',
        },
      },
    });
    const { jobId } = submit.json();

    // CANNED_DATA carries exactly one inspection - this is the NFR's "single inspection" case.
    // Measures from submit to READY, not just PDFKit's own render call: that end-to-end wait is
    // what an auditor actually experiences, and it is what the NFR is meant to bound.
    const settled = await waitForJobToSettle(jobId, auditorToken);
    const elapsedMs = Date.now() - startedAt;

    expect(settled['status']).toBe('READY');
    expect(elapsedMs).toBeLessThan(3000);
  });

  it('runs a CSV export end to end', async () => {
    const managerToken = await makeToken('manager', OWNER_ID);

    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/export',
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        format: 'CSV',
        filters: {
          equipmentIds: [EQUIPMENT_ID],
          dateFrom: '2026-01-01T00:00:00Z',
          dateTo: '2026-12-31T23:59:59Z',
        },
      },
    });
    expect(submit.statusCode).toBe(202);
    const { jobId } = submit.json();

    const settled = await waitForJobToSettle(jobId, managerToken);
    expect(settled['status']).toBe('READY');
    expect(settled['format']).toBe('CSV');
  });

  it('lets the owner poll their own job but not a stranger without an override role', async () => {
    const ownerToken = await makeToken('supervisor', OWNER_ID);
    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/export',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        format: 'CSV',
        filters: {
          equipmentIds: [EQUIPMENT_ID],
          dateFrom: '2026-01-01T00:00:00Z',
          dateTo: '2026-12-31T23:59:59Z',
        },
      },
    });
    const { jobId } = submit.json();
    await waitForJobToSettle(jobId, ownerToken);

    // Another supervisor (no override role) may not view someone else's job.
    const otherSupervisorToken = await makeToken(
      'supervisor',
      '77777777-7777-4777-8777-777777777777',
    );
    const denied = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/${jobId}`,
      headers: { authorization: `Bearer ${otherSupervisorToken}` },
    });
    expect(denied.statusCode).toBe(403);

    // A manager (override role) may view anyone's job.
    const managerToken = await makeToken('manager', OTHER_MANAGER_ID);
    const allowed = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/${jobId}`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().status).toBe('READY');
  });

  it("lists only the caller's own exports", async () => {
    const ownerToken = await makeToken('admin', OWNER_ID);
    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/export',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        format: 'CSV',
        filters: {
          equipmentIds: [EQUIPMENT_ID],
          dateFrom: '2026-01-01T00:00:00Z',
          dateTo: '2026-12-31T23:59:59Z',
        },
      },
    });
    const { jobId } = submit.json();
    await waitForJobToSettle(jobId, ownerToken);

    const mine = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/me/exports',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(mine.statusCode).toBe(200);
    const jobs = mine.json();
    expect(jobs.some((job: { jobId: string }) => job.jobId === jobId)).toBe(true);

    const otherToken = await makeToken('admin', '88888888-8888-4888-8888-888888888888');
    const notMine = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/me/exports',
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(notMine.json().some((job: { jobId: string }) => job.jobId === jobId)).toBe(false);
  });

  it('downloads a ready PDF report with the right content type and disposition (DEV-113)', async () => {
    const auditorToken = await makeToken('auditor', OWNER_ID);
    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/export',
      headers: { authorization: `Bearer ${auditorToken}` },
      payload: {
        format: 'PDF',
        filters: {
          equipmentIds: [EQUIPMENT_ID],
          dateFrom: '2026-01-01T00:00:00Z',
          dateTo: '2026-12-31T23:59:59Z',
        },
      },
    });
    const { jobId } = submit.json();
    await waitForJobToSettle(jobId, auditorToken);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/${jobId}/download`,
      headers: { authorization: `Bearer ${auditorToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="mat-inspect-report-${jobId}.pdf"`,
    );
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('rejects an unauthenticated download and a stranger without an override role (DEV-113)', async () => {
    const ownerToken = await makeToken('supervisor', OWNER_ID);
    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/export',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        format: 'CSV',
        filters: {
          equipmentIds: [EQUIPMENT_ID],
          dateFrom: '2026-01-01T00:00:00Z',
          dateTo: '2026-12-31T23:59:59Z',
        },
      },
    });
    const { jobId } = submit.json();
    await waitForJobToSettle(jobId, ownerToken);

    const unauthed = await app.inject({ method: 'GET', url: `/api/v1/reports/${jobId}/download` });
    expect(unauthed.statusCode).toBe(401);

    const otherSupervisorToken = await makeToken(
      'supervisor',
      '77777777-7777-4777-8777-777777777777',
    );
    const denied = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/${jobId}/download`,
      headers: { authorization: `Bearer ${otherSupervisorToken}` },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('returns 404 for a download of an unknown job id (DEV-113)', async () => {
    const auditorToken = await makeToken('auditor', OWNER_ID);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/99999999-9999-4999-8999-999999999999/download',
      headers: { authorization: `Bearer ${auditorToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('marks a job FAILED, with a generic error, when core-api is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    const auditorToken = await makeToken('auditor', OWNER_ID);
    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/export',
      headers: { authorization: `Bearer ${auditorToken}` },
      payload: {
        format: 'PDF',
        filters: {
          equipmentIds: [EQUIPMENT_ID],
          dateFrom: '2026-01-01T00:00:00Z',
          dateTo: '2026-12-31T23:59:59Z',
        },
      },
    });
    const { jobId } = submit.json();

    const settled = await waitForJobToSettle(jobId, auditorToken);
    expect(settled['status']).toBe('FAILED');
    // Generic detail only - the real cause (ECONNREFUSED) is never reflected to the client.
    expect(String(settled['errorDetail'])).not.toContain('ECONNREFUSED');
  });
});
