import type { FastifyPluginAsync } from 'fastify';
import {
  auditEventIngestSchema,
  auditEventIngestResponseSchema,
} from '@mat-inspect/shared-schemas';
import { appendAuditEvent } from '../../lib/chain.js';
import { requireIngestToken } from '../../middleware/ingest-auth.js';
import { logger } from '../../lib/logger.js';

// Internal-only: the sole caller is core-api's outbox poller (DEV-23 / ADR 0008). 201 on first
// delivery, 200 on a redelivered sourceEventId (deduped) — both are success from the poller's
// point of view; it marks the outbox row processed either way.
export const ingestEventRoute: FastifyPluginAsync = async (app) => {
  app.post(
    '/events',
    {
      preHandler: [requireIngestToken],
      schema: {
        body: auditEventIngestSchema,
        response: { 200: auditEventIngestResponseSchema, 201: auditEventIngestResponseSchema },
      },
    },
    async (req, reply) => {
      const body = auditEventIngestSchema.parse(req.body);

      const { deduped, event } = await appendAuditEvent({
        sourceEventId: body.sourceEventId,
        action: body.action,
        actorId: body.actorId,
        resourceType: body.resourceType,
        resourceId: body.resourceId,
        occurredAt: new Date(body.occurredAt),
        payloadSummary: body.payloadSummary,
      });

      logger.info(
        { reqId: req.id, sourceEventId: body.sourceEventId, action: body.action, deduped },
        deduped ? 'audit event redelivered (deduped)' : 'audit event appended to chain',
      );

      return reply.code(deduped ? 200 : 201).send({ id: event.id, deduped });
    },
  );
};
