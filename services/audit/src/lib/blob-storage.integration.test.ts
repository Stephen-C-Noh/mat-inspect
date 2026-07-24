import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { BlobServiceClient } from '@azure/storage-blob';

// Same well-known Azurite account/key media's own blob-storage.integration.test.ts uses; not a
// secret (ADR 0004).
const AZURITE_ACCOUNT = 'devstoreaccount1';
const AZURITE_KEY =
  'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

const buildConnectionString = (host: string, port: number): string =>
  `DefaultEndpointsProtocol=http;AccountName=${AZURITE_ACCOUNT};AccountKey=${AZURITE_KEY};` +
  `BlobEndpoint=http://${host}:${port}/${AZURITE_ACCOUNT};`;

describe('audit blob-storage against Azurite (DEV-38)', () => {
  let container: StartedTestContainer;
  let connectionString: string;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['DATABASE_URL'] = 'postgres://test:test@localhost:5432/test';

    container = await new GenericContainer('mcr.microsoft.com/azure-storage/azurite:3.33.0')
      .withCommand(['azurite-blob', '--blobHost', '0.0.0.0', '--skipApiVersionCheck'])
      .withExposedPorts(10000)
      .withWaitStrategy(Wait.forLogMessage(/Azurite Blob service successfully listens/))
      .withStartupTimeout(120_000)
      .start();

    connectionString = buildConnectionString(container.getHost(), container.getMappedPort(10000));
    process.env['AZURE_STORAGE_CONNECTION_STRING'] = connectionString;

    const { resetConfigForTest } = await import('./config.js');
    const { resetBlobClientsForTest } = await import('./blob-storage.js');
    resetConfigForTest();
    resetBlobClientsForTest();
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  it('uploads a report file and returns a blob reference', async () => {
    const { storeReportFile } = await import('./blob-storage.js');
    const pdfLikeBytes = Buffer.from('%PDF-1.4 fake report bytes');

    const stored = await storeReportFile(pdfLikeBytes, 'application/pdf');

    expect(stored.blobName).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored.container).toBe('mat-inspect-reports');

    const service = BlobServiceClient.fromConnectionString(connectionString);
    const blob = service.getContainerClient(stored.container).getBlockBlobClient(stored.blobName);
    const downloaded = await blob.downloadToBuffer();
    expect(Buffer.compare(downloaded, pdfLikeBytes)).toBe(0);
  });

  it('generates a SAS download URL that resolves the uploaded file', async () => {
    const { storeReportFile, generateReportDownloadUrl } = await import('./blob-storage.js');
    const csvBytes = Buffer.from('equipmentAssetTag,result\r\nMAT-FL-001,PASS\r\n');
    const stored = await storeReportFile(csvBytes, 'text/csv');

    const { url, expiresAt } = await generateReportDownloadUrl(stored.blobName);

    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const res = await fetch(url);
    expect(res.status).toBe(200);
    const downloaded = Buffer.from(await res.arrayBuffer());
    expect(Buffer.compare(downloaded, csvBytes)).toBe(0);
  });

  it('fetches a photo from the media container by id', async () => {
    const { fetchPhoto } = await import('./blob-storage.js');
    const photoId = '12345678-1234-4123-8123-123456789012';
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

    // Simulate a photo Media already uploaded, independent of any audit code.
    const service = BlobServiceClient.fromConnectionString(connectionString);
    const mediaContainer = service.getContainerClient('mat-inspect-media');
    await mediaContainer.createIfNotExists();
    await mediaContainer.getBlockBlobClient(photoId).uploadData(jpegBytes);

    const fetched = await fetchPhoto(photoId);
    expect(fetched && Buffer.compare(fetched, jpegBytes)).toBe(0);
  });

  it('returns undefined for a photo that does not exist, rather than throwing', async () => {
    const { fetchPhoto } = await import('./blob-storage.js');
    const fetched = await fetchPhoto('00000000-0000-4000-8000-000000000000');
    expect(fetched).toBeUndefined();
  });
});
