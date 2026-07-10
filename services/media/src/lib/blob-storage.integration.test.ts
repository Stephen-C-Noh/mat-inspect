import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { BlobServiceClient } from '@azure/storage-blob';

// The Azurite well-known development account. This key is published by Microsoft for the emulator
// and is not a secret (ADR 0004). testcontainers gives it a random host port per run.
const AZURITE_ACCOUNT = 'devstoreaccount1';
const AZURITE_KEY =
  'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

const buildConnectionString = (host: string, port: number): string =>
  `DefaultEndpointsProtocol=http;AccountName=${AZURITE_ACCOUNT};AccountKey=${AZURITE_KEY};` +
  `BlobEndpoint=http://${host}:${port}/${AZURITE_ACCOUNT};`;

// A tiny but structurally valid JPEG (SOI marker + JFIF header). storePhoto does not decode the
// image, so a short valid-magic buffer is enough to exercise the storage path.
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
]);

describe('storePhoto against Azurite', () => {
  let container: StartedTestContainer;
  let connectionString: string;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';

    // --skipApiVersionCheck: @azure/storage-blob ships a newer REST API version than Azurite
    // 3.33.0 whitelists, so the check would reject every request. The blob operations used here
    // (PutBlob, container create, download, get properties) are all supported; real Azure Blob
    // accepts the version. Same flag is set on the compose Azurite for the same reason.
    container = await new GenericContainer('mcr.microsoft.com/azure-storage/azurite:3.33.0')
      .withCommand(['azurite-blob', '--blobHost', '0.0.0.0', '--skipApiVersionCheck'])
      .withExposedPorts(10000)
      .withWaitStrategy(Wait.forLogMessage(/Azurite Blob service successfully listens/))
      .start();

    connectionString = buildConnectionString(container.getHost(), container.getMappedPort(10000));
    process.env['AZURE_STORAGE_CONNECTION_STRING'] = connectionString;

    const { resetConfigForTest } = await import('./config.js');
    const { resetBlobClientForTest } = await import('./blob-storage.js');
    resetConfigForTest();
    resetBlobClientForTest();
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  it('uploads a photo and returns a reference that resolves the stored blob', async () => {
    const { storePhoto } = await import('./blob-storage.js');
    const stored = await storePhoto(JPEG, 'image/jpeg');

    expect(stored.photoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored.blobName).toBe(stored.photoId); // the id alone locates the blob
    expect(stored.container).toBe('mat-inspect-media');
    expect(stored.contentType).toBe('image/jpeg');
    expect(stored.size).toBe(JPEG.length);

    // Read the blob back through an independent client to prove it was actually written and that
    // the content, content type, and integrity metadata round-trip.
    const service = BlobServiceClient.fromConnectionString(connectionString);
    const blob = service.getContainerClient(stored.container).getBlockBlobClient(stored.blobName);

    const downloaded = await blob.downloadToBuffer();
    expect(Buffer.compare(downloaded, JPEG)).toBe(0);

    const props = await blob.getProperties();
    expect(props.contentType).toBe('image/jpeg');
    expect(props.metadata?.['contenthash']).toBe(stored.sha256);
  });

  it('gives each upload a distinct id even for identical content', async () => {
    const { storePhoto } = await import('./blob-storage.js');
    const first = await storePhoto(JPEG, 'image/jpeg');
    const second = await storePhoto(JPEG, 'image/jpeg');

    expect(first.photoId).not.toBe(second.photoId);
    // Identical bytes hash the same; only the id (and thus blob name) differs.
    expect(first.sha256).toBe(second.sha256);
  });
});
