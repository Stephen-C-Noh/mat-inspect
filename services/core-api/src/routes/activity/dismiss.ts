import type { FastifyPluginAsync } from 'fastify';
import { dismissNotificationsSchema } from '@mat-inspect/shared-schemas';
import { db, notificationDismissals } from '../../db/index.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';

// Clears notifications from the calling manager's bell (ADR 0026). Dismissal is per manager and
// server-side, so it survives a reload and a manager's phone and desktop agree, which the earlier
// session-only version could not do.
//
// This writes nothing about the inspection itself. The inspection row stays immutable (ADR 0008);
// all this records is that one person stopped wanting to be told about it.
export const dismissNotificationsRoute: FastifyPluginAsync = async (app) => {
  app.post(
    '/activity/dismiss',
    {
      preHandler: [requireRole('supervisor', 'manager', 'admin')],
      schema: { body: dismissNotificationsSchema },
    },
    async (req, reply) => {
      const body = dismissNotificationsSchema.parse(req.body);

      // Dismissing twice is not an error. The panel can be cleared from two tabs, and a retry
      // after a dropped response must land on the same state as the original request.
      await db
        .insert(notificationDismissals)
        .values(body.inspectionIds.map((inspectionId) => ({ userId: req.user.id, inspectionId })))
        .onConflictDoNothing();

      logger.info(
        { reqId: req.id, userId: req.user.id, count: body.inspectionIds.length },
        'notifications dismissed',
      );

      return reply.code(204).send();
    },
  );
};
