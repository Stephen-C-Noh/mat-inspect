import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { inspectionListItemSchema, listInspectionsQuerySchema } from '@mat-inspect/shared-schemas';
import { db, inspections, users } from '../../db/index.js';
import { logger } from '../../lib/logger.js';
import { httpError } from '../../lib/http-error.js';
import { requireRole } from '../../middleware/auth.js';
import { canReadAllInspections } from '../../lib/inspection-access.js';
import { serializeInspectionListItem } from './serialize.js';

// Backs two audiences off one route. The dashboard (supervisor/manager/admin) reads any operator's
// inspections, filtered by equipmentId for a single machine or by operatorId/from/to for the
// fleet-wide filter bar (DEV-37). The operator PWA reads the operator's own history (DEV-115): an
// operator-only caller is force-scoped to their own operatorId here, because this list can
// otherwise enumerate any operator's inspections and the detail it links to exposes
// voice-transcript PII (FOIP). limit keeps the page flat as history accumulates (NFR: under 500ms);
// there is no cursor yet since the capstone's inspection volume does not need one (DEV-24).
export const listInspectionsRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/inspections',
    {
      preHandler: [requireRole('operator', 'supervisor', 'manager', 'admin')],
      schema: {
        querystring: listInspectionsQuerySchema,
        response: { 200: z.array(inspectionListItemSchema) },
      },
    },
    async (req, reply) => {
      const query = listInspectionsQuerySchema.parse(req.query);

      // Operator-only callers see their own inspections. A request for someone else's operatorId is
      // refused rather than silently rewritten, so the client is not misled about whose data it got.
      let operatorId = query.operatorId;
      if (!canReadAllInspections(req.user.roles)) {
        if (operatorId && operatorId !== req.user.id) {
          throw httpError(403, 'FORBIDDEN', 'Operators may only list their own inspections');
        }
        operatorId = req.user.id;
      }

      const filters: SQL[] = [];
      if (query.equipmentId) filters.push(eq(inspections.equipmentId, query.equipmentId));
      if (operatorId) filters.push(eq(inspections.operatorId, operatorId));
      if (query.from) filters.push(gte(inspections.submittedAt, new Date(query.from)));
      if (query.to) filters.push(lte(inspections.submittedAt, new Date(query.to)));

      const rows = await db
        .select({ inspection: inspections, operatorDisplayName: users.displayName })
        .from(inspections)
        .innerJoin(users, eq(users.id, inspections.operatorId))
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(inspections.submittedAt))
        .limit(query.limit);

      logger.info(
        { reqId: req.id, userId: req.user.id, count: rows.length },
        'inspections list fetched',
      );

      return reply
        .code(200)
        .send(
          rows.map((row) => serializeInspectionListItem(row.inspection, row.operatorDisplayName)),
        );
    },
  );
};
