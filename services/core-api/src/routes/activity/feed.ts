import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { activityFeedSchema } from '@mat-inspect/shared-schemas';
import { db, equipment, inspections, notificationDismissals, users } from '../../db/index.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { serializeInspectionListItem } from '../inspections/serialize.js';
import { ACTIVITY_RETENTION_MS } from './retention.js';

// The dashboard's change signal (ADR 0026). A manager watching the screen needs new inspections to
// appear on their own, and the FRS gives that a 5 second budget (AC 6.1.3). Polling every dashboard
// query at that rate would re-read the whole fleet, the whole defect list and a machine's whole
// history every few seconds to learn, almost always, that nothing happened. This route answers one
// question instead: which inspections has this manager not yet cleared from their bell.
//
// Deliberately not a cursor. A cursor value, timestamp or sequence, is fixed when the row is
// inserted, but the row becomes visible when its transaction commits, and a submit does a lot of
// work between the two (responses, content hash, outbox, blocking defect, equipment status). An
// inspection stamped at 21:20:00.100 can become visible at 21:20:00.180, after a poll has already
// moved its cursor to 21:20:00.140, and is then never reported to that client again. The
// undismissed set has no such window: a late-committing row is in the next answer like any other.
//
// Operators are excluded. This is a fleet-wide feed of every operator's activity, and an operator
// may only see their own inspections (see list.ts and inspection-access).
export const activityFeedRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/activity',
    {
      preHandler: [requireRole('supervisor', 'manager', 'admin')],
      schema: { response: { 200: activityFeedSchema } },
    },
    async (req, reply) => {
      // Retention bound, not a correctness boundary: it keeps the query and the dismissals table
      // from growing without limit. Derived from the service clock, which is safe here because a
      // few seconds of skew only moves the edge of a window measured in hours.
      const cutoff = new Date(Date.now() - ACTIVITY_RETENTION_MS);

      const rows = await db
        .select({
          inspection: inspections,
          operatorDisplayName: users.displayName,
          equipmentAssetTag: equipment.assetTag,
          equipmentName: equipment.name,
        })
        .from(inspections)
        .innerJoin(users, eq(users.id, inspections.operatorId))
        .innerJoin(equipment, eq(equipment.id, inspections.equipmentId))
        // Left join plus "no dismissal row" rather than NOT IN: one index scan on the composite
        // primary key per candidate row, and no subquery to re-plan as the table grows.
        .leftJoin(
          notificationDismissals,
          and(
            eq(notificationDismissals.inspectionId, inspections.id),
            eq(notificationDismissals.userId, req.user.id),
          ),
        )
        .where(and(gt(inspections.submittedAt, cutoff), isNull(notificationDismissals.userId)))
        .orderBy(desc(inspections.submittedAt));

      // Logged at debug: this route is polled every couple of seconds per open dashboard, and an
      // info line per poll would bury everything else in the service log.
      logger.debug(
        { reqId: req.id, userId: req.user.id, count: rows.length },
        'activity feed fetched',
      );

      return reply.code(200).send({
        inspections: rows.map((row) => ({
          ...serializeInspectionListItem(row.inspection, row.operatorDisplayName),
          equipmentAssetTag: row.equipmentAssetTag,
          equipmentName: row.equipmentName,
        })),
      });
    },
  );
};
