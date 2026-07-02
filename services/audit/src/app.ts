import Fastify, { type FastifyError } from 'fastify';
import { HttpError } from './lib/http-error.js';
import { logger } from './lib/logger.js';
import { setupZodValidation } from './lib/zod-validation.js';
import { registerAuthRouteGuard } from './middleware/auth-route-guard.js';
import { ingestEventRoute } from './routes/events/ingest.js';

export const buildApp = async (): Promise<ReturnType<typeof Fastify>> => {
  const app = Fastify({ loggerInstance: logger });

  setupZodValidation(app);

  // Fail-closed: every route registered after this point must declare requireIngestToken or be
  // in the public allowlist, or the boot crashes (ADR 0014, mirrors core-api).
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

    logger.error({ err, reqId: req.id }, 'Unhandled error');
    void reply.code(500).type('application/problem+json').send({
      type: 'https://errors.mat-inspect/problem/INTERNAL_ERROR',
      title: 'INTERNAL_ERROR',
      status: 500,
      detail: 'An unexpected error occurred',
      instance: req.url,
    });
  });

  app.get('/health', async () => ({ status: 'ok', service: 'audit' }));

  await app.register(ingestEventRoute, { prefix: '/api/v1' });

  return app;
};
