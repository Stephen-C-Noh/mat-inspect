import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { uuidSchema } from '@mat-inspect/shared-schemas';
import { db, reportJobs } from '../../db/index.js';
import { requireRole } from '../../middleware/auth.js';
import { httpError } from '../../lib/http-error.js';
import { fetchReportFile } from '../../lib/blob-storage.js';
import { REPORT_ROLES, canViewAnyReportJob } from '../../lib/report-access.js';
import { logger } from '../../lib/logger.js';

const paramsSchema = z.object({ jobId: uuidSchema });

const CONTENT_TYPES = { PDF: 'application/pdf', CSV: 'text/csv' } as const;

// Serves a finished report's bytes directly (DEV-113 follow-up), same shape and same ownership
// rule as GET /reports/:jobId, and the same pattern media's get-photo.ts already uses for
// evidence photos (ADR 0020/0023): the caller authenticates once against this service instead of
// following a separately-signed link. Replaces an Azure Blob SAS URL, which pointed at Azurite's
// Docker-internal hostname in dev and was unreachable from a browser outside the compose network;
// a same-origin route works identically in dev (Caddy), the Azure demo (Front Door - both already
// wildcard-route /api/v1/reports/*), and any future deployment.
export const downloadReportRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/reports/:jobId/download',
    { preHandler: [requireRole(...REPORT_ROLES)] },
    async (req, reply) => {
      const { jobId } = paramsSchema.parse(req.params);

      const [job] = await db.select().from(reportJobs).where(eq(reportJobs.id, jobId)).limit(1);
      if (!job) {
        throw httpError(404, 'REPORT_JOB_NOT_FOUND', `Report job ${jobId} not found`);
      }

      const isOwner = job.requestedBy === req.user.id;
      if (!isOwner && !canViewAnyReportJob(req.user.roles)) {
        throw httpError(403, 'FORBIDDEN', 'You may only download your own export jobs');
      }

      if (job.status !== 'READY' || !job.blobName) {
        throw httpError(404, 'REPORT_NOT_READY', `Report job ${jobId} is not ready for download`);
      }

      const file = await fetchReportFile(job.blobName);
      if (!file) {
        // A READY job always has a blob; this means the store was tampered with or the two got
        // out of sync, not a normal "not found yet".
        logger.error({ jobId, blobName: job.blobName }, 'report job READY but blob missing');
        throw httpError(500, 'INTERNAL_ERROR', 'Report file is missing');
      }

      logger.info({ reqId: req.id, userId: req.user.id, jobId }, 'report downloaded');

      const extension = job.format === 'PDF' ? 'pdf' : 'csv';
      return reply
        .code(200)
        .header('cache-control', 'private, no-store')
        .header(
          'content-disposition',
          `attachment; filename="mat-inspect-report-${jobId}.${extension}"`,
        )
        .type(CONTENT_TYPES[job.format])
        .send(file);
    },
  );
};
