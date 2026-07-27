import type { FastifyPluginAsync } from 'fastify';
import { desc, eq, gt } from 'drizzle-orm';
import { activityFeedSchema, activitySinceQuerySchema } from '@mat-inspect/shared-schemas';
import { db, equipment, inspections, users } from '../../db/index.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { serializeInspectionListItem } from '../inspections/serialize.js';

// The dashboard's change signal (ADR 0026). A manager watching the screen needs new inspections to
// appear on their own, and the FRS gives that a 5 second budget (AC 6.1.3). Polling every dashboard
// query at that rate would re-read the whole fleet, the whole defect list and a machine's whole
// history every few seconds to learn, almost always, that nothing happened. This route answers that
// question alone: one indexed read over submitted_at, an empty array in the common case.
//
// Operators are excluded. This is a fleet-wide feed of every operator's activity, and an operator
// may only see their own inspections (see list.ts and inspection-access).
export const activityFeedRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/activity',
    {
      preHandler: [requireRole('supervisor', 'manager', 'admin')],
      schema: {
        querystring: activitySinceQuerySchema,
        response: { 200: activityFeedSchema },
      },
    },
    async (req, reply) => {
      const query = activitySinceQuerySchema.parse(req.query);

      // Read the clock before the query, not after. A client sends this value back as its next
      // since, so it has to be a moment the query already covers; taking it afterwards would let
      // an inspection committed mid-query fall into the gap and never be reported.
      const serverTime = new Date();

      // No since means a first poll: the client is establishing its cursor, not asking for history.
      // Returning the backlog here would announce every inspection of the day as new.
      const rows = query.since
        ? await db
            .select({
              inspection: inspections,
              operatorDisplayName: users.displayName,
              equipmentAssetTag: equipment.assetTag,
              equipmentName: equipment.name,
            })
            .from(inspections)
            .innerJoin(users, eq(users.id, inspections.operatorId))
            .innerJoin(equipment, eq(equipment.id, inspections.equipmentId))
            .where(gt(inspections.submittedAt, new Date(query.since)))
            .orderBy(desc(inspections.submittedAt))
            .limit(query.limit)
        : [];

      // Logged at debug: this route is polled every couple of seconds per open dashboard, and an
      // info line per poll would bury everything else in the service log.
      logger.debug(
        { reqId: req.id, userId: req.user.id, count: rows.length },
        'activity feed fetched',
      );

      return reply.code(200).send({
        serverTime: serverTime.toISOString(),
        inspections: rows.map((row) => ({
          ...serializeInspectionListItem(row.inspection, row.operatorDisplayName),
          equipmentAssetTag: row.equipmentAssetTag,
          equipmentName: row.equipmentName,
        })),
      });
    },
  );
};
