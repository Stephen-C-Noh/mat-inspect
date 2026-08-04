import { performance } from 'node:perf_hooks';
import { db, chainVerifications } from '../db/index.js';
import { verifyChain, freezeWrites } from './chain.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { msUntilNext } from './schedule.js';

// Full-chain verification run, recorded to chain_verifications (ARCHITECTURE.md 8.4 rule 7,
// DEV-40 AC2). Runs inside the live app process using the audit_writer connection (src/db/index.ts)
// — this is not a migration, so it never uses db/migrate.ts's migrator connection. A break here
// does not crash the process (logger.error, not fatal): it freezes future writes instead, so
// existing traffic gets a clear 503 rather than the whole service going down mid-operation.
export const runNightlyVerification = async (): Promise<void> => {
  const startedAt = performance.now();
  const result = await verifyChain();
  const elapsedMs = Math.round(performance.now() - startedAt);

  // Freeze (and log) on a detected break BEFORE recording the run. The freeze is the
  // safety-critical action; gating it on the chain_verifications insert would leave writes open
  // on a chain already known to be broken if that bookkeeping insert throws. A failed insert
  // still propagates to the scheduler's catch and is logged there.
  if (result.ok) {
    logger.info({ checked: result.checked, elapsedMs }, 'nightly chain verification passed');
  } else {
    logger.error(
      {
        checked: result.checked,
        brokenAtSeq: result.brokenAtSeq,
        reason: result.reason,
        elapsedMs,
      },
      'nightly chain verification failed; freezing audit writes pending manual review',
    );
    freezeWrites(result.reason);
  }

  await db.insert(chainVerifications).values({
    ok: result.ok,
    checked: result.checked,
    brokenAtSeq: result.ok ? null : result.brokenAtSeq,
    reason: result.ok ? null : result.reason,
    elapsedMs,
  });
};

export const startNightlyVerification = (): { stop: () => void } => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Recursive setTimeout anchored to the next HH:MM occurrence, not a fixed 24h setInterval:
  // a fixed interval drifts across DST changes and doesn't self-correct after a slow run
  // (mirrors services/core-api/src/outbox/poller.ts's startOutboxPoller pattern).
  const scheduleNext = (): void => {
    if (stopped) return;
    timer = setTimeout(
      () => {
        void runNightlyVerification()
          .catch((err: unknown) => logger.error({ err }, 'nightly chain verification run failed'))
          .finally(scheduleNext);
      },
      msUntilNext(config().chainVerifyTime, config().labTimeZone),
    );
  };

  scheduleNext();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
};
