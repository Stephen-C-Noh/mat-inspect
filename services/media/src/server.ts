import './instrumentation.js';
import { buildApp } from './app.js';
import { logger } from './lib/logger.js';
import { config } from './lib/config.js';
import { ensureContainer } from './lib/blob-storage.js';

// instrumentation.js has already validated the environment at this point; config() returns the
// cached, validated values.
const PORT = config().port;

// Verify the storage backend is reachable and the container exists before serving. A
// misconfigured or unreachable storage account then fails the container startup, which Docker
// surfaces as down, rather than passing health checks and failing every upload (mirrors audit's
// startup chain-verification gate).
try {
  await ensureContainer();
  logger.info({ container: config().blobContainer }, 'blob container ready');
} catch (err) {
  logger.fatal({ err }, 'blob storage unavailable; refusing to start');
  process.exit(1);
}

const app = await buildApp();

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
} catch (err) {
  logger.error(err, 'Failed to start server');
  process.exit(1);
}
