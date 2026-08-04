import './instrumentation.js';
import { buildApp } from './app.js';
import { logger } from './lib/logger.js';
import { config } from './lib/config.js';
import { verifyChain } from './lib/chain.js';
import { ensureReportsContainer } from './lib/blob-storage.js';
import { startNightlyVerification } from './lib/nightly-verify.js';

// instrumentation.js has already validated the environment at this point; config() returns
// the cached, validated values.
const PORT = config().port;

// ARCHITECTURE.md 8.4 rule 7: verify the chain on startup; a break freezes new writes until
// manual review. Exiting before app.listen means the container never comes up and Docker
// surfaces it as down, rather than serving a half-trusted chain (mirrors loadConfigOrExit's
// fail-fast pattern, ADR 0015).
const verification = await verifyChain();
if (!verification.ok) {
  logger.fatal(
    {
      brokenAtSeq: verification.brokenAtSeq,
      reason: verification.reason,
      checked: verification.checked,
    },
    'audit chain verification failed; refusing to start',
  );
  process.exit(1);
}
logger.info({ checked: verification.checked }, 'audit chain verified on startup');

// Verify the reports storage backend is reachable and the container exists before serving,
// mirroring media's own boot-time blob check (DEV-38). A misconfigured or unreachable storage
// account fails the container startup rather than the first export request.
try {
  await ensureReportsContainer();
  logger.info({ container: config().reportsBlobContainer }, 'reports blob container ready');
} catch (err) {
  logger.fatal({ err }, 'reports blob storage unavailable; refusing to start');
  process.exit(1);
}

const app = await buildApp();

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
} catch (err) {
  logger.error(err, 'Failed to start server');
  process.exit(1);
}

// Started here, not from buildApp(), so app-only tests don't also start a background job
// (ARCHITECTURE.md 8.4 rule 7, DEV-40 AC2).
startNightlyVerification();
