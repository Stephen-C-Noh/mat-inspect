import './instrumentation.js';
import { buildApp } from './app.js';
import { logger } from './lib/logger.js';
import { config } from './lib/config.js';

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
