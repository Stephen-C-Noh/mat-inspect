import type { FastifyPluginAsync } from 'fastify';
import { mediaUploadResponseSchema } from '@mat-inspect/shared-schemas';
import { requireRole } from '../../middleware/auth.js';
import { httpError } from '../../lib/http-error.js';
import { sniffImageType } from '../../lib/image-type.js';
import { storePhoto } from '../../lib/blob-storage.js';
import { logger } from '../../lib/logger.js';

// POST /api/v1/media/upload (DEV-32). Stores a failed-checklist-item photo in Azure Blob Storage
// and returns its reference. The operator PWA calls this before submitting an inspection, then
// puts the returned photoId in the InspectionResponse.photo_ids array (ADR 0023, DEV-104). submit
// stores whatever references it is sent; it does not require a photo on a failed
// BOOLEAN_PHOTO_ON_FAIL item. This service only stores the object and returns the id; it writes
// no core_db row.
//
// Body: multipart/form-data with a single file field. The file's declared Content-Type is not
// trusted; the type is decided by sniffing the bytes.
export const uploadPhotoRoute: FastifyPluginAsync = async (app) => {
  app.post(
    '/upload',
    {
      preHandler: [requireRole('operator')],
      schema: { response: { 201: mediaUploadResponseSchema } },
    },
    async (req, reply) => {
      // req.file() reads the first file part. It rejects with an FST_* error (mapped to its own
      // 4xx by the error handler) when the request is not multipart/form-data. toBuffer() rejects
      // with FST_REQ_FILE_TOO_LARGE (413) when the stream exceeds limits.fileSize (set from
      // config().maxUploadBytes in app.ts). Both are the "oversized upload rejected" path.
      const file = await req.file();
      if (!file) {
        throw httpError(400, 'NO_FILE', 'A multipart file field is required');
      }
      const buffer = await file.toBuffer();

      // Reject non-images by content, not by the client-declared type or filename. A spoofed
      // image/jpeg header on a script or archive is caught here (415).
      const detectedType = sniffImageType(buffer);
      if (!detectedType) {
        throw httpError(
          415,
          'UNSUPPORTED_MEDIA_TYPE',
          'Upload is not a supported image (JPEG, PNG, or WebP)',
        );
      }

      const stored = await storePhoto(buffer, detectedType);

      // Log ids and sizes only: photoId is a random UUID and operatorId is a UUID (both allowed by
      // the logging rules). No filename, no photo bytes, no user names (CLAUDE.md 4 Logging).
      logger.info(
        {
          reqId: req.id,
          operatorId: req.user.id,
          photoId: stored.photoId,
          contentType: stored.contentType,
          size: stored.size,
        },
        'photo uploaded',
      );

      return reply.code(201).send(stored);
    },
  );
};
