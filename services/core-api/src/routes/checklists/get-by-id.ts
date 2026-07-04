import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { checklistTemplateSchema, uuidSchema } from '@mat-inspect/shared-schemas';
import { db, checklistTemplates } from '../../db/index.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { serializeChecklistTemplate } from './serialize.js';

const paramsSchema = z.object({ id: uuidSchema });

// Fetch a specific template version by id, active or retired. Historical inspections
// store template_id + template_version, so rendering a past inspection needs the exact
// (possibly non-active) template it ran against. Any authenticated role, same as
// /checklists/active.
export const getChecklistTemplateByIdRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/checklists/:id',
    {
      preHandler: [requireRole('operator', 'supervisor', 'manager', 'admin')],
      schema: { params: paramsSchema, response: { 200: checklistTemplateSchema } },
    },
    async (req, reply) => {
      const { id } = paramsSchema.parse(req.params);

      const [row] = await db
        .select()
        .from(checklistTemplates)
        .where(eq(checklistTemplates.id, id))
        .limit(1);

      if (!row) {
        throw httpError(404, 'CHECKLIST_TEMPLATE_NOT_FOUND', `Checklist template ${id} not found`);
      }

      logger.info(
        { reqId: req.id, userId: req.user.id, templateId: row.id, version: row.version },
        'checklist template fetched by id',
      );

      return reply.code(200).send(serializeChecklistTemplate(row));
    },
  );
};
