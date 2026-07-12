import Fastify, { type FastifyError } from 'fastify';
import multipart from '@fastify/multipart';
import { HttpError } from './lib/http-error.js';
import { logger } from './lib/logger.js';
import { config } from './lib/config.js';
import { setupZodValidation } from './lib/zod-validation.js';
import { registerAuthRouteGuard } from './middleware/auth-route-guard.js';
import { uploadPhotoRoute } from './routes/media/upload.js';

export const buildApp = async (): Promise<ReturnType<typeof Fastify>> => {
  const app = Fastify({ loggerInstance: logger });

  setupZodValidation(app);

  // Binary upload support. limits.fileSize caps a single file at the configured maximum; with
  // the default throwFileSizeLimit, exceeding it makes file.toBuffer() reject with a 413. files:1
  // bounds a request to one photo so a multi-file body cannot buffer unbounded data.
  await app.register(multipart, {
    limits: {
      fileSize: config().maxUploadBytes,
      files: 1,
      fields: 5,
    },
  });

  // Fail-closed: every route registered after this must declare requireRole or be in the public
  // allowlist, or the boot crashes (ADR 0014, mirrors core-api and audit).
  registerAuthRouteGuard(app);

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof HttpError) {
      void reply
        .code(err.status)
        .type('application/problem+json')
        .send({
          type: `https://errors.mat-inspect/problem/${err.code}`,
          title: err.code,
          status: err.status,
          detail: err.detail,
          instance: req.url,
        });
      return;
    }

    if (err.validation) {
      void reply.code(400).type('application/problem+json').send({
        type: 'https://errors.mat-inspect/problem/VALIDATION_ERROR',
        title: 'VALIDATION_ERROR',
        status: 400,
        detail: err.message,
        instance: req.url,
      });
      return;
    }

    // @fastify/multipart raises FST_* errors that already carry a 4xx statusCode: 413 for a file
    // over the size limit, 406 for a non-multipart body. Surface them as problem+json with their
    // own status instead of collapsing them into a 500. This is the "oversized upload rejected"
    // response path.
    const status = (err as FastifyError & { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      void reply
        .code(status)
        .type('application/problem+json')
        .send({
          type: `https://errors.mat-inspect/problem/${err.code ?? 'BAD_REQUEST'}`,
          title: err.code ?? 'BAD_REQUEST',
          status,
          detail: err.message,
          instance: req.url,
        });
      return;
    }

    logger.error({ err, reqId: req.id }, 'Unhandled error');
    void reply.code(500).type('application/problem+json').send({
      type: 'https://errors.mat-inspect/problem/INTERNAL_ERROR',
      title: 'INTERNAL_ERROR',
      status: 500,
      detail: 'An unexpected error occurred',
      instance: req.url,
    });
  });

  app.get('/health', async () => ({ status: 'ok', service: 'media' }));

  await app.register(uploadPhotoRoute, { prefix: '/api/v1/media' });

  return app;
};
