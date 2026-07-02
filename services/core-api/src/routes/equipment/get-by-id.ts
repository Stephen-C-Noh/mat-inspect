import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { equipmentSchema, uuidSchema } from '@mat-inspect/shared-schemas';
import { db, equipment } from '../../db/index.js';
import { computeReadiness } from '../../lib/equipment-readiness.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { serializeEquipment } from './serialize.js';

const paramsSchema = z.object({ id: uuidSchema });

export const getEquipmentByIdRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/equipment/:id',
    {
      preHandler: [requireRole('operator', 'supervisor', 'manager', 'admin')],
      schema: { params: paramsSchema, response: { 200: equipmentSchema } },
    },
    async (req, reply) => {
      const { id } = paramsSchema.parse(req.params);

      const [row] = await db.select().from(equipment).where(eq(equipment.id, id)).limit(1);

      if (!row) {
        throw httpError(404, 'EQUIPMENT_NOT_FOUND', `Equipment ${id} not found`);
      }

      const readiness = await computeReadiness([row]);

      logger.info(
        { reqId: req.id, userId: req.user.id, equipmentId: id },
        'equipment fetched by id',
      );

      return reply.code(200).send(serializeEquipment(row, readiness.get(row.id)!));
    },
  );
};
