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
import { returnToServiceRoute } from './routes/equipment/return-to-service.js';
import { publishChecklistTemplateRoute } from './routes/checklists/publish.js';
import { activeChecklistTemplateRoute } from './routes/checklists/active.js';
import { getChecklistTemplateByIdRoute } from './routes/checklists/get-by-id.js';
import { submitInspectionRoute } from './routes/inspections/submit.js';
import { listDefectsRoute } from './routes/defects/list.js';
import { getDefectByIdRoute } from './routes/defects/get-by-id.js';
import { acknowledgeDefectRoute } from './routes/defects/acknowledge.js';
import { startRepairDefectRoute } from './routes/defects/start-repair.js';
import { resolveDefectRoute } from './routes/defects/resolve.js';
import { rejectDefectRoute } from './routes/defects/reject.js';
import { transcribeRoute } from './routes/ai/transcribe.js';

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

    // Fastify's own client errors already carry the right status and code: a body over the route's
    // bodyLimit is 413, an unparseable content type is 415. Reporting them as 500 would tell the
    // caller the server broke when the request was at fault, and the transcription route's soft
    // failure contract reads the status to decide what to show the operator.
    if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
      logger.warn({ err, reqId: req.id }, 'request rejected');
      void reply
        .code(err.statusCode)
        .type('application/problem+json')
        .send({
          type: `https://errors.mat-inspect/problem/${err.code ?? 'BAD_REQUEST'}`,
          title: err.code ?? 'BAD_REQUEST',
          status: err.statusCode,
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
  // Tag lookup lives at /equipment/by-tag/:assetTag. "by-tag" is a static path segment, so
  // Fastify's radix router prefers it over the /equipment/:id parameter regardless of
  // registration order; there is no collision to guard against. (Ticket DEV-24 originally
  // specified /equipment/:asset_tag; the by-tag path avoids the :id vs :asset_tag same-segment
  // ambiguity. DEV-15 PWA QR scan must resolve against this path.)
  await app.register(getEquipmentByTagRoute, { prefix: '/api/v1' });
  await app.register(getEquipmentByIdRoute, { prefix: '/api/v1' });
  await app.register(createEquipmentRoute, { prefix: '/api/v1' });
  await app.register(updateEquipmentRoute, { prefix: '/api/v1' });
  await app.register(returnToServiceRoute, { prefix: '/api/v1' });
  await app.register(publishChecklistTemplateRoute, { prefix: '/api/v1' });
  await app.register(activeChecklistTemplateRoute, { prefix: '/api/v1' });
  // /checklists/active is a static segment, so Fastify's radix router prefers it over the
  // /checklists/:id parameter regardless of registration order; no collision to guard against.
  await app.register(getChecklistTemplateByIdRoute, { prefix: '/api/v1' });
  await app.register(submitInspectionRoute, { prefix: '/api/v1' });
  // Defect list is registered before the /defects/:id parameter route; Fastify's radix router
  // handles the static-vs-parameter ordering, so registration order is not load-bearing here.
  await app.register(listDefectsRoute, { prefix: '/api/v1' });
  await app.register(getDefectByIdRoute, { prefix: '/api/v1' });
  await app.register(acknowledgeDefectRoute, { prefix: '/api/v1' });
  await app.register(startRepairDefectRoute, { prefix: '/api/v1' });
  await app.register(resolveDefectRoute, { prefix: '/api/v1' });
  await app.register(rejectDefectRoute, { prefix: '/api/v1' });
  // Transcription is proxied, not implemented here: core-api authenticates the operator and passes
  // the clip to the AI Service, which is not reachable from the browser (ADR 0019).
  await app.register(transcribeRoute, { prefix: '/api/v1' });

  if (process.env['NODE_ENV'] !== 'production') {
    const { devTokenRoutes } = await import('./routes/dev-token.js');
    await app.register(devTokenRoutes);
  }

  return app;
};
