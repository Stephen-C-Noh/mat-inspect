import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { equipmentSchema } from '@mat-inspect/shared-schemas';
import { db, equipment } from '../../db/index.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { serializeEquipment } from './serialize.js';

// The QR code printed on each machine encodes the asset tag (e.g. "MAT-OC-001").
// This route resolves that tag to the full equipment record so the PWA can start
// an inspection without the operator knowing the UUID.
const paramsSchema = z.object({ assetTag: z.string().min(1) });

export const getEquipmentByTagRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/equipment/by-tag/:assetTag',
    {
      preHandler: [requireRole('operator', 'supervisor', 'manager', 'admin')],
      schema: { params: paramsSchema, response: { 200: equipmentSchema } },
    },
    async (req, reply) => {
      const { assetTag } = paramsSchema.parse(req.params);

      const [row] = await db
        .select()
        .from(equipment)
        .where(eq(equipment.assetTag, assetTag))
        .limit(1);

      if (!row) {
        throw httpError(404, 'EQUIPMENT_NOT_FOUND', `No equipment with asset tag ${assetTag}`);
      }

      logger.info(
        { reqId: req.id, userId: req.user.id, assetTag, equipmentId: row.id },
        'equipment fetched by asset tag',
      );

      return reply.code(200).send(serializeEquipment(row));
    },
  );
};
