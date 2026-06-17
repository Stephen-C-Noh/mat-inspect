import Fastify, { type FastifyError } from 'fastify';
import { HttpError } from './lib/http-error.js';
import { logger } from './lib/logger.js';
import { setupZodValidation } from './lib/zod-validation.js';
import { registerAuthRouteGuard } from './middleware/auth-route-guard.js';
import { listEquipmentRoute } from './routes/equipment/list.js';
import { getEquipmentByTagRoute } from './routes/equipment/get-by-tag.js';
import { getEquipmentByIdRoute } from './routes/equipment/get-by-id.js';
import { createEquipmentRoute } from './routes/equipment/create.js';
import { updateEquipmentRoute } from './routes/equipment/update.js';
import { publishChecklistTemplateRoute } from './routes/checklists/publish.js';
import { activeChecklistTemplateRoute } from './routes/checklists/active.js';

export const buildApp = async (): Promise<ReturnType<typeof Fastify>> => {
  const app = Fastify({ loggerInstance: logger });

  // Routes validate requests and serialize responses through their Zod schemas (ADR-aligned:
  // shared-schemas is the single source of truth shared with clients). See DEV-27.
  setupZodValidation(app);

  // Fail-closed: every route registered after this point must declare an auth preHandler
  // or be in the public allowlist, or the boot crashes (ADR 0014, DEV-25).
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
  // by-tag is registered before /:id so Fastify's radix router matches the static
  // "by-tag" segment first and does not capture it as a UUID parameter.
  await app.register(getEquipmentByTagRoute, { prefix: '/api/v1' });
  await app.register(getEquipmentByIdRoute, { prefix: '/api/v1' });
  await app.register(createEquipmentRoute, { prefix: '/api/v1' });
  await app.register(updateEquipmentRoute, { prefix: '/api/v1' });
  await app.register(publishChecklistTemplateRoute, { prefix: '/api/v1' });
  await app.register(activeChecklistTemplateRoute, { prefix: '/api/v1' });

  if (process.env['NODE_ENV'] !== 'production') {
    const { devTokenRoutes } = await import('./routes/dev-token.js');
    await app.register(devTokenRoutes);
  }

  return app;
};
