import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { defectSchema, uuidSchema } from '@mat-inspect/shared-schemas';
import { db, defects } from '../../db/index.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { assertCanTransition } from './transitions.js';
import { loadDefect } from './load-defect.js';
import { serializeDefect } from './serialize.js';

const paramsSchema = z.object({ id: uuidSchema });

// ACKNOWLEDGED -> IN_REPAIR: the defect is assigned and repair work has begun. Status-only
// (no outbox event). The conditional WHERE below mirrors acknowledge.ts: it writes only if the
// row is still in the status this request just read, so a concurrent transition is rejected.
export const startRepairDefectRoute: FastifyPluginAsync = async (app) => {
  app.post(
    '/defects/:id/start-repair',
    {
      preHandler: [requireRole('supervisor', 'manager')],
      schema: { params: paramsSchema, response: { 200: defectSchema } },
    },
    async (req, reply) => {
      const { id } = paramsSchema.parse(req.params);
      const defect = await loadDefect(id);
      assertCanTransition(defect.status, 'IN_REPAIR');

      const [row] = await db
        .update(defects)
        .set({ status: 'IN_REPAIR' })
        .where(and(eq(defects.id, id), eq(defects.status, defect.status)))
        .returning();

      if (!row) {
        throw httpError(409, 'DEFECT_INVALID_TRANSITION', 'Defect changed concurrently; retry');
      }

      logger.info({ reqId: req.id, userId: req.user.id, defectId: id }, 'defect repair started');

      return reply.code(200).send(serializeDefect(row));
    },
  );
};
