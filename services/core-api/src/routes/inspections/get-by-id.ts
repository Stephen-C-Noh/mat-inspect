import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { inspectionDetailSchema, uuidSchema } from '@mat-inspect/shared-schemas';
import { requireRole } from '../../middleware/auth.js';
import { canReadAllInspections } from '../../lib/inspection-access.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { loadInspectionDetail } from './load-inspection.js';
import { serializeInspectionDetail } from './serialize.js';

const paramsSchema = z.object({ id: uuidSchema });

// One inspection's responses in checklist order, including voice-transcript text and per-response
// photo references. The dashboard drilldown (supervisor/manager/admin) and the read-only audit
// page (auditor, ADR 0021/DEV-113) read any inspection (DEV-37); an operator reads only their own
// (DEV-115). response.notes can hold VOICE_TRANSCRIBED text (biometric-derived PII under FOIP,
// CLAUDE.md), so an operator requesting another operator's inspection is answered 404, not 403:
// existence itself is not disclosed. Same exclusion the report export path applies.
export const getInspectionByIdRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/inspections/:id',
    {
      preHandler: [requireRole('operator', 'supervisor', 'manager', 'admin', 'auditor')],
      schema: { params: paramsSchema, response: { 200: inspectionDetailSchema } },
    },
    async (req, reply) => {
      const { id } = paramsSchema.parse(req.params);
      const { inspection, operatorDisplayName, responses } = await loadInspectionDetail(id);

      // An operator-only caller may read only their own inspection. 404 (not 403) so the response
      // does not reveal that an inspection with this id exists for another operator.
      if (!canReadAllInspections(req.user.roles) && inspection.operatorId !== req.user.id) {
        throw httpError(404, 'INSPECTION_NOT_FOUND', `Inspection ${id} not found`);
      }

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
