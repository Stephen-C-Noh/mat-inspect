import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { equipmentWithLastInspectionSchema } from '@mat-inspect/shared-schemas';
import { db, equipment } from '../../db/index.js';
import { computeReadiness } from '../../lib/equipment-readiness.js';
import { loadLastInspections } from '../../lib/last-inspection.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { serializeEquipmentWithLastInspection } from './serialize.js';

export const listEquipmentRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/equipment',
    {
      preHandler: [requireRole('operator', 'supervisor', 'manager', 'admin')],
      schema: { response: { 200: z.array(equipmentWithLastInspectionSchema) } },
    },
    async (req, reply) => {
      // Cursor pagination is Sprint 2 (out of scope for DEV-24). The fleet is fixed at about
      // 10 machines, so the full set is returned in one response for now.
      const rows = await db.select().from(equipment);
      const readiness = await computeReadiness(rows);
      const lastInspections = await loadLastInspections(rows.map((row) => row.id));

      logger.info(
        { reqId: req.id, userId: req.user.id, count: rows.length },
        'equipment list fetched',
      );

      return reply
        .code(200)
        .send(
          rows.map((row) =>
            serializeEquipmentWithLastInspection(
              row,
              readiness.get(row.id)!,
              lastInspections.get(row.id)!,
            ),
          ),
        );
    },
  );
};
