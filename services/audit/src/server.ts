import './instrumentation.js';
import { buildApp } from './app.js';
import { logger } from './lib/logger.js';
import { config } from './lib/config.js';
import { verifyChain } from './lib/chain.js';
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
