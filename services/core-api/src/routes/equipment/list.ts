import type { FastifyPluginAsync } from 'fastify';
import { db, equipment } from '../../db/index.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';

export const listEquipmentRoute: FastifyPluginAsync = async (app) => {
  app.get('/equipment', { preHandler: [requireRole('operator')] }, async (req, reply) => {
    const rows = await db.select().from(equipment);

    logger.info(
      { reqId: req.id, userId: req.user.id, count: rows.length },
      'equipment list fetched',
    );

    return reply.code(200).send(rows);
  });
};
