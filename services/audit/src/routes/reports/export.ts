import type { FastifyPluginAsync } from 'fastify';
import { reportExportRequestSchema, reportJobAcceptedSchema } from '@mat-inspect/shared-schemas';
import { db, reportJobs } from '../../db/index.js';
import { requireRole } from '../../middleware/auth.js';
import { generateReport } from '../../lib/generate-report.js';
import { logger } from '../../lib/logger.js';

// Auditor and manager exports, per the ticket description; supervisor and admin included too
// (API_REFERENCE.md's documented icon and the general "who manages compliance" set). operator is
// deliberately excluded - an operator has no reason to pull a compliance export (least privilege,
// same reasoning as ai/transcribe.ts restricting the reverse case to operator only).
const REPORT_ROLES = ['supervisor', 'manager', 'auditor', 'admin'] as const;

// A rough estimate returned to the client for UX only (e.g. "ready in about Ns"); it is not a
// promise and nothing polls against it. Actual completion is signaled by status transitioning to
// READY or FAILED.
const ESTIMATED_SECONDS = 5;

export const exportReportRoute: FastifyPluginAsync = async (app) => {
  app.post(
    '/reports/export',
    {
      preHandler: [requireRole(...REPORT_ROLES)],
      schema: { body: reportExportRequestSchema, response: { 202: reportJobAcceptedSchema } },
    },
    async (req, reply) => {
      const body = reportExportRequestSchema.parse(req.body);

      const [job] = await db
        .insert(reportJobs)
        .values({
          requestedBy: req.user.id,
          format: body.format,
          filters: body.filters,
          options: body.options,
        })
        .returning();

      logger.info(
        { reqId: req.id, userId: req.user.id, jobId: job!.id, format: body.format },
        'report export requested',
      );

      // Fire-and-forget: generateReport owns its own try/catch and writes READY/FAILED itself.
      // This .catch is only a backstop for an error that somehow escapes that (a bug in
      // generateReport itself), so a job is never silently left PROCESSING with no log line.
      void generateReport(job!.id, body, req.user.email).catch((err: unknown) => {
        logger.error({ jobId: job!.id, err }, 'unhandled error starting report generation');
      });

      return reply.code(202).send({
        jobId: job!.id,
        status: 'PROCESSING',
        estimatedSeconds: ESTIMATED_SECONDS,
      });
    },
  );
};
