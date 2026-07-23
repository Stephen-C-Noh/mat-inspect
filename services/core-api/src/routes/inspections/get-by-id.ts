import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { inspectionDetailSchema, uuidSchema } from '@mat-inspect/shared-schemas';
import { requireRole } from '../../middleware/auth.js';
import { logger } from '../../lib/logger.js';
import { loadInspectionDetail } from './load-inspection.js';
import { serializeInspectionDetail } from './serialize.js';

const paramsSchema = z.object({ id: uuidSchema });

// Backs the fleet drilldown's full-history view (DEV-37): one inspection's responses, in
// checklist order, including photo references and voice-transcript text.
export const getInspectionByIdRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/inspections/:id',
    {
      preHandler: [requireRole('operator', 'supervisor', 'manager', 'admin')],
      schema: { params: paramsSchema, response: { 200: inspectionDetailSchema } },
    },
    async (req, reply) => {
      const { id } = paramsSchema.parse(req.params);
      const { inspection, operatorDisplayName, responses } = await loadInspectionDetail(id);

      logger.info(
        { reqId: req.id, userId: req.user.id, inspectionId: id },
        'inspection fetched by id',
      );

      return reply
        .code(200)
        .send(serializeInspectionDetail(inspection, operatorDisplayName, responses));
    },
  );
};
