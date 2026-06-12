import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { activeChecklistQuerySchema, checklistTemplateSchema } from '@mat-inspect/shared-schemas';
import { db, checklistTemplates } from '../../db/index.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { serializeChecklistTemplate } from './serialize.js';

export const activeChecklistTemplateRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/checklists/active',
    {
      preHandler: [requireRole('operator', 'supervisor', 'manager', 'admin')],
      schema: {
        querystring: activeChecklistQuerySchema,
        response: { 200: checklistTemplateSchema },
      },
    },
    async (req, reply) => {
      const { type } = activeChecklistQuerySchema.parse(req.query);

      const [row] = await db
        .select()
        .from(checklistTemplates)
        .where(
          and(eq(checklistTemplates.equipmentType, type), eq(checklistTemplates.isActive, true)),
        )
        .limit(1);

      if (!row) {
        throw httpError(
          404,
          'NOT_FOUND',
          `No active checklist template for equipment type ${type}`,
        );
      }

      logger.info(
        { reqId: req.id, userId: req.user.id, equipmentType: type, templateId: row.id },
        'active checklist template fetched',
      );

      return reply.code(200).send(serializeChecklistTemplate(row));
    },
  );
};
