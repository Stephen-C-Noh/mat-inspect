import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { config } from './config.js';
import { logger } from './logger.js';

// Retention job for raw voice audio (DEV-41). Enforces the shorter half of the retention policy:
// raw voice clips are biometric PII under FOIP and are kept 90 days, while the transcript text and
// the inspection record are kept the full 7 years (ARCHITECTURE.md 8.4, ADR 0004).
//
// The job touches Blob Storage only. It never opens a database connection, so it cannot delete an
// inspection, response, or audit row: those live in Postgres and are immutable anyway (CLAUDE.md
// 2). Purging a clip removes the audio object; the transcript already lives in the
// InspectionResponse row and is left untouched.

const DAY_MS = 24 * 60 * 60 * 1000;

// Options let a test drive the age boundary deterministically (inject `now`) and let an operator
// preview a run without deleting anything (`dryRun`). Every field defaults from the validated
// config, so the scheduled job calls this with no arguments.
export type PurgeOptions = {
  now?: Date;
  retentionDays?: number;
  container?: string;
  dryRun?: boolean;
};

// Outcome of one run. Every id in purgedIds is a blob name, which equals the voice_clip_id UUID:
// safe to log, not PII (CLAUDE.md 4 Logging). No transcript, audio, or operator name is recorded.
export type PurgeSummary = {
  container: string;
  cutoff: string; // ISO 8601; a clip created before this instant is purged
  retentionDays: number;
  scanned: number;
  purged: number;
  purgedIds: string[];
  failed: number;
  dryRun: boolean;
};

// cutoff = now - retentionDays. A clip created before the cutoff is past its window.
export const computeCutoff = (now: Date, retentionDays: number): Date =>
  new Date(now.getTime() - retentionDays * DAY_MS);

// A clip is expired when its creation time is strictly before the cutoff. "older than 90 days"
// means created more than 90 days ago; a clip created exactly at the cutoff is kept. A missing
// creation time is treated as not-expired: the job never deletes a blob whose age it cannot
// establish (fail safe toward retention).
export const isExpired = (createdOn: Date | undefined, cutoff: Date): boolean =>
  createdOn !== undefined && createdOn.getTime() < cutoff.getTime();

// A fresh client per run. The retention job is a short-lived process (one scheduled invocation),
// so there is nothing to cache across calls the way the upload path caches its container client.
const voiceContainerClient = (containerName: string): ContainerClient => {
  const service = BlobServiceClient.fromConnectionString(config().azureStorageConnectionString);
  return service.getContainerClient(containerName);
};

// Deletes raw voice clips older than the retention window from the voice container and returns a
// summary. Idempotent: a clip already gone (a prior run, or a concurrent run) is a no-op, so
// re-running the job never fails and never double-counts a deletion.
export const purgeExpiredVoiceAudio = async (opts: PurgeOptions = {}): Promise<PurgeSummary> => {
  const now = opts.now ?? new Date();
  const retentionDays = opts.retentionDays ?? config().voiceRetentionDays;
  const containerName = opts.container ?? config().voiceBlobContainer;
  const dryRun = opts.dryRun ?? false;
  const cutoff = computeCutoff(now, retentionDays);

  const container = voiceContainerClient(containerName);

  const summary: PurgeSummary = {
    container: containerName,
    cutoff: cutoff.toISOString(),
    retentionDays,
    scanned: 0,
    purged: 0,
    purgedIds: [],
    failed: 0,
    dryRun,
  };

  // The voice container does not exist until the first voice upload (DEV-34). Treat that as
  // "nothing to purge" rather than an error, so the scheduled job is a clean no-op on a
  // dev-staging box where voice capture is not wired up yet.
  if (!(await container.exists())) {
    logger.info({ container: containerName }, 'voice container absent; nothing to purge');
    return summary;
  }

  for await (const blob of container.listBlobsFlat()) {
    summary.scanned += 1;
    // createdOn is server-set and immutable, so it cannot be influenced by whatever wrote the clip;
    // prefer it over any client-supplied metadata for the age decision. Azurite and real Azure Blob
    // both return it on the list item, so no per-blob getProperties call is needed.
    const createdOn = blob.properties.createdOn;
    if (!isExpired(createdOn, cutoff)) {
      continue;
    }

    // Dry run reports what it would delete without touching Blob Storage. Used on a first deploy to
    // confirm the window and container before enabling real deletion (irreversible).
    if (dryRun) {
      summary.purged += 1;
      summary.purgedIds.push(blob.name);
      logger.info({ container: containerName, voiceClipId: blob.name }, 'voice clip would purge');
      continue;
    }

    try {
      // deleteIfExists is idempotent: a second run that finds the clip already deleted returns
      // succeeded=false and does not throw. deleteSnapshots=include covers any snapshot, though the
      // upload path creates none.
      await container.getBlobClient(blob.name).deleteIfExists({ deleteSnapshots: 'include' });
      summary.purged += 1;
      summary.purgedIds.push(blob.name);
      // Log the id of every purged clip: ids only, no PII (acceptance criterion, CLAUDE.md 4).
      logger.info({ container: containerName, voiceClipId: blob.name }, 'voice clip purged');
    } catch (err) {
      // One clip failing to delete must not abort the run: the rest still purge and the next
      // scheduled run retries this one. Count and log it (id only) so the failure is visible.
      summary.failed += 1;
      logger.warn(
        { container: containerName, voiceClipId: blob.name, err },
        'voice clip purge failed',
      );
    }
  }

  logger.info(
    {
      container: containerName,
      retentionDays,
      cutoff: summary.cutoff,
      scanned: summary.scanned,
      purged: summary.purged,
      failed: summary.failed,
      dryRun,
    },
    'voice audio retention run complete',
  );

  return summary;
};
