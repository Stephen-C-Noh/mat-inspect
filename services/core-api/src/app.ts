import Fastify, { type FastifyError } from 'fastify';
import { HttpError } from './lib/http-error.js';
import { logger } from './lib/logger.js';
import { listEquipmentRoute } from './routes/equipment/list.js';

export const buildApp = async (): Promise<ReturnType<typeof Fastify>> => {
  const app = Fastify({ loggerInstance: logger });

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

    // Fastify validation errors (schema mismatch)
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

  app.get('/health', async () => ({ status: 'ok', service: 'core-api' }));

  await app.register(listEquipmentRoute, { prefix: '/api/v1' });

  if (process.env['NODE_ENV'] !== 'production') {
    const { devTokenRoutes } = await import('./routes/dev-token.js');
    await app.register(devTokenRoutes);
  }

  return app;
};
