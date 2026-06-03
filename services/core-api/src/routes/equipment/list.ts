import type { FastifyPluginAsync } from 'fastify';
import { equipmentSchema } from '@mat-inspect/shared-schemas';
import { logger } from '../../lib/logger.js';

// waiting for adan to merge the db changes before we can import these
// import { db } from '../../db/index.js';
// import { equipment } from '../../db/schema/equipment.js';

export const listEquipmentRoute: FastifyPluginAsync = async (app) => {
  app.get('/equipment', async (req, reply) => {
    const rows = await db.select().from(equipment);

    logger.info({ reqId: req.id, count: rows.length }, 'equipment list fetched');

    return reply.code(200).send(equipmentSchema.array().parse(rows));
  });
};
