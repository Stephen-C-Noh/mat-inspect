import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { defectSchema, rejectDefectSchema, uuidSchema } from '@mat-inspect/shared-schemas';
import { db, defects } from '../../db/index.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { assertCanTransition } from './transitions.js';
import { loadDefect } from './load-defect.js';
import { serializeDefect } from './serialize.js';

const paramsSchema = z.object({ id: uuidSchema });

// Rejecting dismisses a defect that is not a real fault (for example a misread gauge). The
// table has no separate reject columns, so the reason and the actor are recorded in the
// resolved_* fields. Rejecting does not clear OUT_OF_SERVICE: if the equipment was locked out,
// return-to-service is still the path back (ADR 0006). Only Supervisor/Manager may reject.
export const rejectDefectRoute: FastifyPluginAsync = async (app) => {
  app.post(
    '/defects/:id/reject',
    {
      preHandler: [requireRole('supervisor', 'manager')],
      schema: {
        params: paramsSchema,
        body: rejectDefectSchema,
        response: { 200: defectSchema },
      },
    },
    async (req, reply) => {
      const { id } = paramsSchema.parse(req.params);
      const body = rejectDefectSchema.parse(req.body);
      const defect = await loadDefect(id);
      assertCanTransition(defect.status, 'REJECTED');

      const [row] = await db
        .update(defects)
        .set({
          status: 'REJECTED',
          resolvedAt: new Date(),
          resolvedBy: req.user.id,
          resolutionNotes: body.reason,
        })
        .where(and(eq(defects.id, id), eq(defects.status, defect.status)))
        .returning();

      if (!row) {
        throw httpError(409, 'DEFECT_INVALID_TRANSITION', 'Defect changed concurrently; retry');
      }

      logger.info({ reqId: req.id, userId: req.user.id, defectId: id }, 'defect rejected');

      return reply.code(200).send(serializeDefect(row));
    },
  );
};
