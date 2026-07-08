import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { defectSchema, resolveDefectSchema, uuidSchema } from '@mat-inspect/shared-schemas';
import { db, defects, outbox } from '../../db/index.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { assertCanTransition } from './transitions.js';
import { loadDefect } from './load-defect.js';
import { serializeDefect } from './serialize.js';

const paramsSchema = z.object({ id: uuidSchema });

// Resolving records that the defect was corrected. It does NOT return the equipment to
// service: OUT_OF_SERVICE stays sticky until a separate return-to-service approval bumps the
// readiness watermark (ADR 0006). Only Supervisor/Manager may resolve.
export const resolveDefectRoute: FastifyPluginAsync = async (app) => {
  app.post(
    '/defects/:id/resolve',
    {
      preHandler: [requireRole('supervisor', 'manager')],
      schema: {
        params: paramsSchema,
        body: resolveDefectSchema,
        response: { 200: defectSchema },
      },
    },
    async (req, reply) => {
      const { id } = paramsSchema.parse(req.params);
      const body = resolveDefectSchema.parse(req.body);
      const defect = await loadDefect(id);
      assertCanTransition(defect.status, 'RESOLVED');

      const row = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(defects)
          .set({
            status: 'RESOLVED',
            resolvedAt: new Date(),
            resolvedBy: req.user.id,
            resolutionNotes: body.resolutionNotes,
          })
          .where(and(eq(defects.id, id), eq(defects.status, defect.status)))
          .returning();

        if (!updated) {
          throw httpError(409, 'DEFECT_INVALID_TRANSITION', 'Defect changed concurrently; retry');
        }

        // Outbox row only; the poller, hash chain, and content digest are DEV-23.
        await tx.insert(outbox).values({
          eventType: 'DEFECT_RESOLVED',
          payload: {
            defectId: updated.id,
            equipmentId: updated.equipmentId,
            inspectionId: updated.inspectionId,
            resolvedBy: req.user.id,
          },
        });

        return updated;
      });

      logger.info({ reqId: req.id, userId: req.user.id, defectId: id }, 'defect resolved');

      return reply.code(200).send(serializeDefect(row));
    },
  );
};
