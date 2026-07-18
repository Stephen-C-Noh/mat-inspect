import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { checklistTemplateSchema } from '@mat-inspect/shared-schemas';
import { db, checklistTemplates } from '../../db/index.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { serializeChecklistTemplate } from './serialize.js';

// Backs the admin template-management grid: every version across every equipment type,
// including retired ones, so an admin can see the full publish history (DEV-63).
export const listChecklistTemplatesRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/checklists',
    {
      preHandler: [requireRole('admin')],
      schema: { response: { 200: z.array(checklistTemplateSchema) } },
    },
    async (req, reply) => {
      const rows = await db.select().from(checklistTemplates);

      logger.info(
        { reqId: req.id, userId: req.user.id, count: rows.length },
        'checklist template list fetched',
      );

      return reply.code(200).send(rows.map(serializeChecklistTemplate));
    },
  );
};
