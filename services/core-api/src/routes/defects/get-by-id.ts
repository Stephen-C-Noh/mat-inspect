import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { defectSchema, uuidSchema } from '@mat-inspect/shared-schemas';
import { requireRole } from '../../middleware/auth.js';
import { logger } from '../../lib/logger.js';
import { loadDefect } from './load-defect.js';
import { serializeDefect } from './serialize.js';

const paramsSchema = z.object({ id: uuidSchema });

export const getDefectByIdRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/defects/:id',
    {
      preHandler: [requireRole('operator', 'supervisor', 'manager', 'admin')],
      schema: { params: paramsSchema, response: { 200: defectSchema } },
    },
    async (req, reply) => {
      const { id } = paramsSchema.parse(req.params);
      const row = await loadDefect(id);

      logger.info({ reqId: req.id, userId: req.user.id, defectId: id }, 'defect fetched by id');

      return reply.code(200).send(serializeDefect(row));
    },
  );
};
