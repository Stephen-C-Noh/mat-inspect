import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { createEquipmentSchema, equipmentSchema } from '@mat-inspect/shared-schemas';
import { db, equipment } from '../../db/index.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { serializeEquipment } from './serialize.js';

export const createEquipmentRoute: FastifyPluginAsync = async (app) => {
  app.post(
    '/equipment',
    {
      preHandler: [requireRole('admin')],
      schema: { body: createEquipmentSchema, response: { 201: equipmentSchema } },
    },
    async (req, reply) => {
      const body = createEquipmentSchema.parse(req.body);

      // Pre-check the asset tag so a collision returns a clean 409 problem+json instead of
      // the 500 a raw unique-constraint violation would surface. The unique index on
      // asset_tag is the real guard; this check only produces a friendlier error.
      const [existing] = await db
        .select({ id: equipment.id })
        .from(equipment)
        .where(eq(equipment.assetTag, body.assetTag))
        .limit(1);

      if (existing) {
        throw httpError(
          409,
          'EQUIPMENT_ASSET_TAG_CONFLICT',
          `Asset tag ${body.assetTag} is already in use`,
        );
      }

      // status is not accepted from the client; DB default is AWAITING_INSPECTION (OHS s.257:
      // a passing inspection is required before equipment can become READY).
      const [row] = await db
        .insert(equipment)
        .values({
          assetTag: body.assetTag,
          name: body.name,
          type: body.type,
          make: body.make ?? null,
          model: body.model ?? null,
          serialNumber: body.serialNumber ?? null,
          location: body.location ?? null,
          manufacturerSpecsUrl: body.manufacturerSpecsUrl ?? null,
        })
        .returning();

      // insert().returning() always yields the inserted row, so the non-null assertion is safe.
      logger.info(
        { reqId: req.id, userId: req.user.id, equipmentId: row!.id, assetTag: body.assetTag },
        'equipment created',
      );

      return reply.code(201).send(serializeEquipment(row!));
    },
  );
};
