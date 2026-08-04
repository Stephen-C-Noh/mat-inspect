import { loadConfigOrExit } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { purgeExpiredVoiceAudio } from '../lib/voice-retention.js';

// One-shot entrypoint for the raw voice-audio retention job (DEV-41). The scheduler
// (infra/retention/voice-retention-scheduler.sh) invokes this once per scheduled run; it purges
// expired clips, logs a summary, and exits. It is not the HTTP server, so it does not import
// instrumentation.js: a short-lived job has no request telemetry to emit, and its Pino output goes
// to the container log.
//
// Config is validated through the same loader the server uses (ADR 0015): a missing or malformed
// AZURE_STORAGE_CONNECTION_STRING fails here with a clear message rather than mid-run. The job uses
// only the storage config; the Entra and Application Insights values the loader also requires are
// supplied by the compose service and left unused here.

// A non-zero exit marks the run as failed so the scheduler logs it and retries next schedule.
const EXIT_FAILURE = 1;

const main = async (): Promise<void> => {
  loadConfigOrExit();

  // RETENTION_DRY_RUN=true reports what would be purged without deleting. Used on a first deploy to
  // confirm the container and window before enabling irreversible deletion.
  const dryRun = process.env['RETENTION_DRY_RUN'] === 'true';

  const summary = await purgeExpiredVoiceAudio({ dryRun });

  logger.info(
    {
      container: summary.container,
      retentionDays: summary.retentionDays,
      cutoff: summary.cutoff,
      scanned: summary.scanned,
      purged: summary.purged,
      failed: summary.failed,
      dryRun: summary.dryRun,
    },
    'voice audio retention job finished',
  );

  // A failed delete is not fatal (the next run retries it), but surface it as a non-zero exit so
  // the scheduler logs the run as failed and the failure is visible in the container log.
  if (summary.failed > 0) {
    process.exit(EXIT_FAILURE);
  }
};

main().catch((err: unknown) => {
  // An unexpected throw (storage unreachable, auth error) aborts the run. Log it and exit non-zero
  // so the scheduler treats it as a failed run and retries on the next schedule.
  logger.fatal({ err }, 'voice audio retention job aborted');
  process.exit(EXIT_FAILURE);
});
