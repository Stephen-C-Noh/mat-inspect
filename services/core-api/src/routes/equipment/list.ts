import type { FastifyPluginAsync } from 'fastify';
import { db, equipment } from '../../db/index.js';
import { logger } from '../../lib/logger.js';

export const listEquipmentRoute: FastifyPluginAsync = async (app) => {
  app.get('/equipment', async (req, reply) => {
    const rows = await db.select().from(equipment);

    logger.info({ reqId: req.id, count: rows.length }, 'equipment list fetched');

    return reply.code(200).send(rows);
  });
};
