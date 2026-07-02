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

// First supervisor transition (OPEN -> ACKNOWLEDGED): a supervisor confirms they have seen the
// defect. Status-only, so no outbox event (the audit action enum tracks OPENED and RESOLVED
// only, see transitions.ts). Acknowledging does not clear OUT_OF_SERVICE; return-to-service does.
export const acknowledgeDefectRoute: FastifyPluginAsync = async (app) => {
  app.post(
    '/defects/:id/acknowledge',
    {
      preHandler: [requireRole('supervisor', 'manager')],
      schema: { params: paramsSchema, response: { 200: defectSchema } },
    },
    async (req, reply) => {
      const { id } = paramsSchema.parse(req.params);
      const defect = await loadDefect(id);
      assertCanTransition(defect.status, 'ACKNOWLEDGED');

      // WHERE status = the status just read: if another request moved the defect in between,
      // no row matches and the transition is rejected rather than silently overwriting.
      const [row] = await db
        .update(defects)
        .set({ status: 'ACKNOWLEDGED' })
        .where(and(eq(defects.id, id), eq(defects.status, defect.status)))
        .returning();

      if (!row) {
        throw httpError(409, 'DEFECT_INVALID_TRANSITION', 'Defect changed concurrently; retry');
      }

      logger.info({ reqId: req.id, userId: req.user.id, defectId: id }, 'defect acknowledged');

      return reply.code(200).send(serializeDefect(row));
    },
  );
};
