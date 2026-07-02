import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { equipmentSchema } from '@mat-inspect/shared-schemas';
import { db, equipment } from '../../db/index.js';
import { computeReadiness } from '../../lib/equipment-readiness.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { serializeEquipment } from './serialize.js';

export const listEquipmentRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/equipment',
    {
      preHandler: [requireRole('operator')],
      schema: { response: { 200: z.array(equipmentSchema) } },
    },
    async (req, reply) => {
      // Cursor pagination is Sprint 2 (out of scope for DEV-24). The fleet is fixed at about
      // 10 machines, so the full set is returned in one response for now.
      const rows = await db.select().from(equipment);
      const readiness = await computeReadiness(rows);

      logger.info(
        { reqId: req.id, userId: req.user.id, count: rows.length },
        'equipment list fetched',
      );

      return reply
        .code(200)
        .send(rows.map((row) => serializeEquipment(row, readiness.get(row.id)!)));
    },
  );
};
