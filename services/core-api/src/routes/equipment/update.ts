import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { equipmentSchema, patchEquipmentSchema, uuidSchema } from '@mat-inspect/shared-schemas';
import { db, equipment } from '../../db/index.js';
import { computeReadiness } from '../../lib/equipment-readiness.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { serializeEquipment } from './serialize.js';

const paramsSchema = z.object({ id: uuidSchema });

export const updateEquipmentRoute: FastifyPluginAsync = async (app) => {
  app.patch(
    '/equipment/:id',
    {
      preHandler: [requireRole('admin')],
      schema: {
        params: paramsSchema,
        body: patchEquipmentSchema,
        response: { 200: equipmentSchema },
      },
    },
    async (req, reply) => {
      const { id } = paramsSchema.parse(req.params);
      const body = patchEquipmentSchema.parse(req.body);

      // body holds editable fields only: patchEquipmentSchema is .strict(), so status,
      // current_status_since, asset_tag, and type cannot reach this .set(). Status stays
      // under the state machine, asset_tag stays stable for the QR contract (DEV-24 Threat 1).
      //
      // Drizzle's update().returning() returns an empty array if no row matched the WHERE.
      // We surface that as a 404 rather than a silent no-op.
      const [row] = await db
        .update(equipment)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(equipment.id, id))
        .returning();

      if (!row) {
        throw httpError(404, 'EQUIPMENT_NOT_FOUND', `Equipment ${id} not found`);
      }

      const readiness = await computeReadiness([row]);

      logger.info({ reqId: req.id, userId: req.user.id, equipmentId: id }, 'equipment updated');

      return reply.code(200).send(serializeEquipment(row, readiness.get(row.id)!));
    },
  );
};
