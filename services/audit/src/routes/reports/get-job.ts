import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { reportJobResponseSchema, uuidSchema } from '@mat-inspect/shared-schemas';
import type { UserRole } from '@mat-inspect/shared-types';
import { db, reportJobs } from '../../db/index.js';
import { requireRole } from '../../middleware/auth.js';
import { httpError } from '../../lib/http-error.js';
import { generateReportDownloadUrl } from '../../lib/blob-storage.js';
import { logger } from '../../lib/logger.js';

const REPORT_ROLES = ['supervisor', 'manager', 'auditor', 'admin'] as const;
// Roles that may view any job, not only their own - a manager/auditor/admin auditing what
// exports have been run needs to see other people's jobs; supervisor does not get this override
// (it can start an export but not inspect anyone else's).
const VIEW_ANY_JOB_ROLES: readonly UserRole[] = ['manager', 'auditor', 'admin'];

const paramsSchema = z.object({ jobId: uuidSchema });

// Same estimate export.ts returns; a job re-polled while still PROCESSING gets the same number
// back rather than a recomputed ETA this codebase has no data to support.
const ESTIMATED_SECONDS = 5;

export const getReportJobRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/reports/:jobId',
    {
      preHandler: [requireRole(...REPORT_ROLES)],
      schema: { params: paramsSchema, response: { 200: reportJobResponseSchema } },
    },
    async (req, reply) => {
      const { jobId } = paramsSchema.parse(req.params);

      const [job] = await db.select().from(reportJobs).where(eq(reportJobs.id, jobId)).limit(1);
      if (!job) {
        throw httpError(404, 'REPORT_JOB_NOT_FOUND', `Report job ${jobId} not found`);
      }

      const isOwner = job.requestedBy === req.user.id;
      const canViewAny = req.user.roles.some((role) => VIEW_ANY_JOB_ROLES.includes(role));
      if (!isOwner && !canViewAny) {
        throw httpError(403, 'FORBIDDEN', 'You may only view your own export jobs');
      }

      if (job.status === 'PROCESSING') {
        return reply
          .code(200)
          .send({ jobId: job.id, status: 'PROCESSING', estimatedSeconds: ESTIMATED_SECONDS });
      }

      if (job.status === 'FAILED') {
        return reply.code(200).send({
          jobId: job.id,
          status: 'FAILED',
          errorDetail: job.errorDetail ?? 'Report generation failed',
        });
      }

      // READY: these fields are all written together in the same update (generate-report.ts), so
      // any one being null here means the row is corrupt, not a normal state to render around.
      if (
        !job.blobName ||
        !job.sha256 ||
        !job.signature ||
        !job.signingKeyFingerprint ||
        job.fileBytes === null ||
        job.inspectionCount === null
      ) {
        logger.error({ jobId }, 'report job marked READY but missing required fields');
        throw httpError(500, 'INTERNAL_ERROR', 'Report job is in an inconsistent state');
      }

      const { url, expiresAt } = await generateReportDownloadUrl(job.blobName);

      logger.info({ reqId: req.id, userId: req.user.id, jobId }, 'report job polled');

      return reply.code(200).send({
        jobId: job.id,
        status: 'READY',
        downloadUrl: url,
        expiresAt: expiresAt.toISOString(),
        format: job.format,
        inspectionCount: job.inspectionCount,
        fileBytes: job.fileBytes,
        sha256: job.sha256,
        signature: job.signature,
        signingKeyFingerprint: job.signingKeyFingerprint,
      });
    },
  );
};
