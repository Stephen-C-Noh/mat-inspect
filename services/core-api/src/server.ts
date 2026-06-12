import './instrumentation.js';
import { buildApp } from './app.js';
import { logger } from './lib/logger.js';

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

const app = await buildApp();

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
} catch (err) {
  logger.error(err, 'Failed to start server');
  process.exit(1);
}
