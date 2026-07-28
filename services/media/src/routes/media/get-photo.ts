import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { uuidSchema } from '@mat-inspect/shared-schemas';
import { requireRole } from '../../middleware/auth.js';
import { httpError } from '../../lib/http-error.js';
import { getPhoto } from '../../lib/blob-storage.js';
import { logger } from '../../lib/logger.js';

// GET /api/v1/media/photos/:photoId (DEV-131). Serves the evidence photo's bytes directly, so the
// PWA's fail confirmation screen (and the dashboard's fleet drilldown) can render a thumbnail from
// the photoId a response carries, instead of a blob: URL that does not survive a reload (ADR 0023).
// Every checklist role may view a photo it can already see the id of; core-api and audit never see
// the bytes, only the reference (ADR 0023, ADR 0020).
const paramsSchema = z.object({ photoId: uuidSchema });

export const getPhotoRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/photos/:photoId',
    {
      preHandler: [requireRole('operator', 'supervisor', 'manager', 'admin')],
      schema: { params: paramsSchema },
    },
    async (req, reply) => {
      const { photoId } = paramsSchema.parse(req.params);

      const photo = await getPhoto(photoId);
      if (!photo) {
        throw httpError(404, 'PHOTO_NOT_FOUND', `No photo stored for id ${photoId}`);
      }

      logger.info({ reqId: req.id, userId: req.user.id, photoId }, 'photo fetched');

      return reply.code(200).type(photo.contentType).send(photo.data);
    },
  );
};
