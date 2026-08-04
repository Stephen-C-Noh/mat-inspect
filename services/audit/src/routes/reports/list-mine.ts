import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { reportJobSummarySchema } from '@mat-inspect/shared-schemas';
import { db, reportJobs } from '../../db/index.js';
import { requireRole } from '../../middleware/auth.js';
import { REPORT_ROLES } from '../../lib/report-access.js';
import { logger } from '../../lib/logger.js';

// Unpaginated, matching the existing precedent in core-api's defects/list.ts and
// equipment/list.ts: the capstone's export volume is small enough that a filtered set fits one
// response, and cursor pagination is not implemented anywhere in this codebase yet.
export const listMyReportExportsRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/reports/me/exports',
    {
      preHandler: [requireRole(...REPORT_ROLES)],
      schema: { response: { 200: z.array(reportJobSummarySchema) } },
    },
    async (req, reply) => {
      const rows = await db
        .select()
        .from(reportJobs)
        .where(eq(reportJobs.requestedBy, req.user.id))
        .orderBy(desc(reportJobs.createdAt));

      logger.info(
        { reqId: req.id, userId: req.user.id, count: rows.length },
        'report exports listed',
      );

      return reply.code(200).send(
        rows.map((row) => ({
          jobId: row.id,
          format: row.format,
          status: row.status,
          filters: row.filters,
          inspectionCount: row.inspectionCount,
          createdAt: row.createdAt.toISOString(),
          readyAt: row.readyAt?.toISOString() ?? null,
        })),
      );
    },
  );
};
