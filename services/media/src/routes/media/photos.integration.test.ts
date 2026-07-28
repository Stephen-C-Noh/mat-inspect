import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { setJwksForTest } from '../../middleware/auth.js';

// End-to-end coverage of GET /api/v1/media/photos/:photoId against a real Azurite container
// (DEV-131). The route is the retrieval half ADR 0023 deferred: PWA fetches evidence photos
// Media-direct, by id, per ADR 0020's publishing rule (Media validates its own Entra tokens).

const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
const localJwks = createLocalJWKSet({ keys: [publicJwk] });

setJwksForTest(localJwks);

const makeToken = async (claims: Record<string, unknown> = {}): Promise<string> =>
  new SignJWT({ sub: 'op-1', oid: 'op-1', roles: ['operator'], tid: 'test-tenant', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privateKey);

const AZURITE_ACCOUNT = 'devstoreaccount1';
const AZURITE_KEY =
  'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

const BOUNDARY = '----matinspecttestboundary';
const buildMultipart = (
  data: Buffer,
  opts: { filename?: string; contentType?: string } = {},
): { body: Buffer; headers: Record<string, string> } => {
  const filename = opts.filename ?? 'photo.bin';
  const contentType = opts.contentType ?? 'application/octet-stream';
  const head = Buffer.from(
    `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);
  return {
    body: Buffer.concat([head, data, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  };
};

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const UNKNOWN_PHOTO_ID = '99999999-9999-4999-8999-999999999999';

describe('GET /api/v1/media/photos/:photoId', () => {
  let container: StartedTestContainer;
  let app: Awaited<ReturnType<(typeof import('../../app.js'))['buildApp']>>;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    delete process.env['ENTRA_TENANT_ID'];
    delete process.env['ENTRA_CLIENT_ID'];

    container = await new GenericContainer('mcr.microsoft.com/azure-storage/azurite:3.33.0')
      .withCommand(['azurite-blob', '--blobHost', '0.0.0.0', '--skipApiVersionCheck'])
      .withExposedPorts(10000)
      .withWaitStrategy(Wait.forLogMessage(/Azurite Blob service successfully listens/))
      .withStartupTimeout(120_000)
      .start();

    const connectionString =
      `DefaultEndpointsProtocol=http;AccountName=${AZURITE_ACCOUNT};AccountKey=${AZURITE_KEY};` +
      `BlobEndpoint=http://${container.getHost()}:${container.getMappedPort(10000)}/${AZURITE_ACCOUNT};`;
    process.env['AZURE_STORAGE_CONNECTION_STRING'] = connectionString;

    const { resetConfigForTest } = await import('../../lib/config.js');
    const { resetBlobClientForTest } = await import('../../lib/blob-storage.js');
    resetConfigForTest();
    resetBlobClientForTest();

    const { buildApp } = await import('../../app.js');
    app = await buildApp();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  it('rejects an unauthenticated request (401)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/media/photos/${UNKNOWN_PHOTO_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for a photo id with no stored blob', async () => {
    const token = await makeToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/media/photos/${UNKNOWN_PHOTO_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('serves the bytes and content type of a previously uploaded photo', async () => {
    const token = await makeToken();
    const { body, headers } = buildMultipart(JPEG, {
      filename: 'evidence.jpg',
      contentType: 'image/jpeg',
    });
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/media/upload',
      headers: { ...headers, authorization: `Bearer ${token}` },
      payload: body,
    });
    expect(uploadRes.statusCode).toBe(201);
    const { photoId } = uploadRes.json();

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/media/photos/${photoId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(getRes.rawPayload, JPEG)).toBe(0);
  });
});
