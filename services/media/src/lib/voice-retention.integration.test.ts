import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { BlobServiceClient } from '@azure/storage-blob';

// End-to-end coverage of the retention job (DEV-41) against a real Azurite container. The unit
// test covers the age boundary; this test covers list, delete, idempotency, dry-run, and the
// absent-container no-op.
//
// Azurite sets a blob's createdOn to "now" and it cannot be backdated, so age is driven from the
// other side: each test injects a future `now` so freshly written clips fall outside the window.
// Each test uses its own container so the assertions on exact counts are isolated.

const AZURITE_ACCOUNT = 'devstoreaccount1';
const AZURITE_KEY =
  'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

const buildConnectionString = (host: string, port: number): string =>
  `DefaultEndpointsProtocol=http;AccountName=${AZURITE_ACCOUNT};AccountKey=${AZURITE_KEY};` +
  `BlobEndpoint=http://${host}:${port}/${AZURITE_ACCOUNT};`;

const DAY_MS = 24 * 60 * 60 * 1000;

describe('purgeExpiredVoiceAudio against Azurite', () => {
  let container: StartedTestContainer;
  let connectionString: string;
  let service: BlobServiceClient;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';

    // --skipApiVersionCheck: the SDK ships a newer REST API version than Azurite 3.33.0 whitelists.
    // The operations used here (create, put blob, list, delete, exists) are all supported; real
    // Azure Blob accepts the version. Same flag is set on the compose Azurite.
    container = await new GenericContainer('mcr.microsoft.com/azure-storage/azurite:3.33.0')
      .withCommand(['azurite-blob', '--blobHost', '0.0.0.0', '--skipApiVersionCheck'])
      .withExposedPorts(10000)
      .withWaitStrategy(Wait.forLogMessage(/Azurite Blob service successfully listens/))
      .withStartupTimeout(120_000)
      .start();

    connectionString = buildConnectionString(container.getHost(), container.getMappedPort(10000));
    process.env['AZURE_STORAGE_CONNECTION_STRING'] = connectionString;

    // purgeExpiredVoiceAudio reads the connection string through config(); reset the cache so it
    // picks up the value set above.
    const { resetConfigForTest } = await import('./config.js');
    resetConfigForTest();

    service = BlobServiceClient.fromConnectionString(connectionString);
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  // A distinct container per test keeps count assertions isolated. Voice-clip blob names are
  // voice_clip_id UUIDs; a short byte body is enough since purge never decodes the audio.
  const seedClips = async (containerName: string, count: number): Promise<string[]> => {
    const c = service.getContainerClient(containerName);
    await c.createIfNotExists();
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = randomUUID();
      await c.getBlockBlobClient(id).uploadData(Buffer.from(`voice-audio-${id}`));
      ids.push(id);
    }
    return ids.sort();
  };

  const listNames = async (containerName: string): Promise<string[]> => {
    const c = service.getContainerClient(containerName);
    const names: string[] = [];
    for await (const b of c.listBlobsFlat()) {
      names.push(b.name);
    }
    return names.sort();
  };

  it('keeps clips that are still inside the retention window', async () => {
    const { purgeExpiredVoiceAudio } = await import('./voice-retention.js');
    const name = `voice-test-${randomUUID()}`;
    const ids = await seedClips(name, 2);

    // now is the real present, so clips written a moment ago are far younger than 90 days.
    const summary = await purgeExpiredVoiceAudio({ container: name, retentionDays: 90 });

    expect(summary.scanned).toBe(2);
    expect(summary.purged).toBe(0);
    expect(summary.failed).toBe(0);
    expect(await listNames(name)).toEqual(ids);
  });

  it('purges clips older than the retention window', async () => {
    const { purgeExpiredVoiceAudio } = await import('./voice-retention.js');
    const name = `voice-test-${randomUUID()}`;
    const ids = await seedClips(name, 3);

    // Push now 200 days into the future: the cutoff (now - 90d) lands ~110 days ahead, so clips
    // created just now are on the far side of it and are purged.
    const future = new Date(Date.now() + 200 * DAY_MS);
    const summary = await purgeExpiredVoiceAudio({
      container: name,
      retentionDays: 90,
      now: future,
    });

    expect(summary.scanned).toBe(3);
    expect(summary.purged).toBe(3);
    expect(summary.failed).toBe(0);
    expect(summary.purgedIds.sort()).toEqual(ids);
    // The audio is gone from Blob Storage.
    expect(await listNames(name)).toEqual([]);
  });

  it('is idempotent: a second run over an already-purged container deletes nothing and does not throw', async () => {
    const { purgeExpiredVoiceAudio } = await import('./voice-retention.js');
    const name = `voice-test-${randomUUID()}`;
    await seedClips(name, 2);

    const future = new Date(Date.now() + 200 * DAY_MS);
    const first = await purgeExpiredVoiceAudio({ container: name, retentionDays: 90, now: future });
    const second = await purgeExpiredVoiceAudio({
      container: name,
      retentionDays: 90,
      now: future,
    });

    expect(first.purged).toBe(2);
    expect(second.scanned).toBe(0);
    expect(second.purged).toBe(0);
    expect(second.failed).toBe(0);
  });

  it('reports but does not delete in dry-run mode', async () => {
    const { purgeExpiredVoiceAudio } = await import('./voice-retention.js');
    const name = `voice-test-${randomUUID()}`;
    const ids = await seedClips(name, 2);

    const future = new Date(Date.now() + 200 * DAY_MS);
    const summary = await purgeExpiredVoiceAudio({
      container: name,
      retentionDays: 90,
      now: future,
      dryRun: true,
    });

    expect(summary.dryRun).toBe(true);
    expect(summary.purged).toBe(2);
    expect(summary.purgedIds.sort()).toEqual(ids);
    // The clips are still there: dry-run reports without touching Blob Storage.
    expect(await listNames(name)).toEqual(ids);
  });

  it('is a clean no-op when the voice container does not exist', async () => {
    const { purgeExpiredVoiceAudio } = await import('./voice-retention.js');
    // A container name that was never created, mirroring a dev-staging box where voice capture is
    // not wired up yet.
    const summary = await purgeExpiredVoiceAudio({ container: `voice-missing-${randomUUID()}` });

    expect(summary.scanned).toBe(0);
    expect(summary.purged).toBe(0);
    expect(summary.failed).toBe(0);
  });
});
