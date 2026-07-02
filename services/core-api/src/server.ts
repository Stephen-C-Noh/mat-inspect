import './instrumentation.js';
import { buildApp } from './app.js';
import { logger } from './lib/logger.js';
import { config } from './lib/config.js';
import { startOutboxPoller } from './outbox/poller.js';

// instrumentation.js has already validated the environment at this point; config() returns
// the cached, validated values.
const PORT = config().port;

const app = await buildApp();

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
} catch (err) {
  logger.error(err, 'Failed to start server');
  process.exit(1);
}

// Started here, not from buildApp(), so route-level tests that build the app directly don't
// also start a background poller against whatever database they happen to be pointed at.
startOutboxPoller();
