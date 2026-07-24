import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { inspectionListItemSchema, listInspectionsQuerySchema } from '@mat-inspect/shared-schemas';
import { db, inspections, users } from '../../db/index.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { serializeInspectionListItem } from './serialize.js';

// Backs the fleet drilldown history (DEV-37): filtered by equipmentId for a single machine, or
// by operatorId/from/to for the fleet-wide filter bar. limit keeps the page flat as history
// accumulates (NFR: drilldown under 500ms); there is no cursor yet since the capstone's fleet
// and inspection volume do not need one (same reasoning as the equipment list, DEV-24).
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

      const filters: SQL[] = [];
      if (query.equipmentId) filters.push(eq(inspections.equipmentId, query.equipmentId));
      if (query.operatorId) filters.push(eq(inspections.operatorId, query.operatorId));
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
