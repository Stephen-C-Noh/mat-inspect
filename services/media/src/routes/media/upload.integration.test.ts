import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { BlobServiceClient } from '@azure/storage-blob';
import { setJwksForTest } from '../../middleware/auth.js';

// End-to-end coverage of POST /api/v1/media/upload against a real Azurite container. Exercises the
// four DEV-32 acceptance criteria: authenticated upload stores the photo and returns a reference;
// non-image and oversized uploads are rejected; the returned reference resolves the stored blob.

// --- Auth setup: mint tokens with a local keypair and hand them to the shared verifier, so the
// JWKS fetch (an external HTTP call, the only boundary these tests replace) never happens and
// verifyToken itself runs for real. The verifier's own suite lives in @mat-inspect/shared-auth-server.
const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
const localJwks = createLocalJWKSet({ keys: [publicJwk] });

// Inject the local key set so token verification never reaches the network. The shared
// verifier owns the JWKS fetch (DEV-98); tests hand it keys instead of mocking the module.
setJwksForTest(localJwks);

const makeToken = async (claims: Record<string, unknown> = {}): Promise<string> =>
  new SignJWT({ sub: 'op-1', oid: 'op-1', roles: ['operator'], tid: 'test-tenant', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privateKey);

// --- Azurite setup.
const AZURITE_ACCOUNT = 'devstoreaccount1';
const AZURITE_KEY =
  'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

// --- Multipart body builder. light-my-request (app.inject) has no form-data helper, so the body
// is assembled by hand: a single file part with a fixed boundary. Kept as a Buffer because the
// payload is binary.
const BOUNDARY = '----matinspecttestboundary';
const buildMultipart = (
  data: Buffer,
  opts: { filename?: string; contentType?: string; fieldName?: string } = {},
): { body: Buffer; headers: Record<string, string> } => {
  const fieldName = opts.fieldName ?? 'file';
  const filename = opts.filename ?? 'photo.bin';
  const contentType = opts.contentType ?? 'application/octet-stream';
  const head = Buffer.from(
    `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);
  return {
    body: Buffer.concat([head, data, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  };
};

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
// Size cap kept tiny (see MEDIA_MAX_UPLOAD_BYTES below) so an oversized case needs no big buffer.
const MAX_BYTES = 1024;

describe('POST /api/v1/media/upload', () => {
  let container: StartedTestContainer;
  let connectionString: string;
  let app: Awaited<ReturnType<(typeof import('../../app.js'))['buildApp']>>;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['MEDIA_MAX_UPLOAD_BYTES'] = String(MAX_BYTES);
    // ENTRA_* stay unset so verifyToken skips issuer/audience checks and validates against the
    // stubbed local JWKS.
    delete process.env['ENTRA_TENANT_ID'];
    delete process.env['ENTRA_CLIENT_ID'];

    // --skipApiVersionCheck: see the note in blob-storage.integration.test.ts. The SDK's REST API
    // version is newer than Azurite 3.33.0 whitelists; the flag lets the emulator accept it.
    container = await new GenericContainer('mcr.microsoft.com/azure-storage/azurite:3.33.0')
      .withCommand(['azurite-blob', '--blobHost', '0.0.0.0', '--skipApiVersionCheck'])
      .withExposedPorts(10000)
      .withWaitStrategy(Wait.forLogMessage(/Azurite Blob service successfully listens/))
      // Raise the startup budget above the 60s default so a slow Azurite boot under full-suite
      // container contention does not flake (see blob-storage.integration.test.ts).
      .withStartupTimeout(120_000)
      .start();

    connectionString =
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

  it('rejects an unauthenticated upload (401)', async () => {
    const { body, headers } = buildMultipart(JPEG, { contentType: 'image/jpeg' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/media/upload',
      headers,
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a caller without the operator role (403)', async () => {
    const token = await makeToken({ roles: ['manager'] });
    const { body, headers } = buildMultipart(JPEG, { contentType: 'image/jpeg' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/media/upload',
      headers: { ...headers, authorization: `Bearer ${token}` },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it('stores an authenticated JPEG upload and returns a reference that resolves the blob', async () => {
    const token = await makeToken();
    // Declare the wrong Content-Type on purpose: the bytes are JPEG. The stored type must be the
    // sniffed image/jpeg, proving the declared header is not trusted.
    const { body, headers } = buildMultipart(JPEG, {
      filename: 'evidence.png',
      contentType: 'image/png',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/media/upload',
      headers: { ...headers, authorization: `Bearer ${token}` },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    const ref = res.json();
    expect(ref.photoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ref.blobName).toBe(ref.photoId);
    expect(ref.container).toBe('mat-inspect-media');
    expect(ref.contentType).toBe('image/jpeg'); // sniffed, not the declared image/png
    expect(ref.size).toBe(JPEG.length);
    expect(ref.sha256).toHaveLength(64);

    // The returned reference is what an InspectionResponse.photo_ids entry points at (DEV-18); it
    // must resolve to a real stored object.
    const service = BlobServiceClient.fromConnectionString(connectionString);
    const blob = service.getContainerClient(ref.container).getBlockBlobClient(ref.blobName);
    expect(await blob.exists()).toBe(true);
    expect(Buffer.compare(await blob.downloadToBuffer(), JPEG)).toBe(0);
  });

  it('accepts a PNG upload', async () => {
    const token = await makeToken();
    const { body, headers } = buildMultipart(PNG, {
      filename: 'evidence.png',
      contentType: 'image/png',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/media/upload',
      headers: { ...headers, authorization: `Bearer ${token}` },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().contentType).toBe('image/png');
  });

  it('rejects a non-image upload with 415', async () => {
    const token = await makeToken();
    const notAnImage = Buffer.from('this is plain text pretending to be a photo');
    const { body, headers } = buildMultipart(notAnImage, {
      filename: 'photo.jpg',
      contentType: 'image/jpeg', // spoofed; the bytes are text
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/media/upload',
      headers: { ...headers, authorization: `Bearer ${token}` },
      payload: body,
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().title).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects an oversized upload with 413', async () => {
    const token = await makeToken();
    // Valid JPEG magic but larger than MAX_BYTES: rejection is by size, not content.
    const big = Buffer.concat([JPEG, Buffer.alloc(MAX_BYTES * 2, 0x00)]);
    const { body, headers } = buildMultipart(big, {
      filename: 'huge.jpg',
      contentType: 'image/jpeg',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/media/upload',
      headers: { ...headers, authorization: `Bearer ${token}` },
      payload: body,
    });
    expect(res.statusCode).toBe(413);
  });

  it('returns 400 when the multipart body carries no file field', async () => {
    const token = await makeToken();
    // A field-only body (no filename) so req.file() finds no file part.
    const fieldOnly = Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="note"\r\n\r\nhello\r\n--${BOUNDARY}--\r\n`,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/media/upload',
      headers: {
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
        authorization: `Bearer ${token}`,
      },
      payload: fieldOnly,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().title).toBe('NO_FILE');
  });

  it('serves /health without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe('media');
  });
});
