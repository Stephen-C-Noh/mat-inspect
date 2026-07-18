import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { inArray } from 'drizzle-orm';
import { checklistTemplateDiffSchema, uuidSchema } from '@mat-inspect/shared-schemas';
import { db, checklistTemplates } from '../../db/index.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { diffChecklistItems } from './diff-items.js';
import { serializeChecklistTemplate } from './serialize.js';

const paramsSchema = z.object({ id: uuidSchema, otherId: uuidSchema });

// Item-level diff between two template versions, keyed by item.key (not array position), so
// reordering items between versions does not read as a spurious add/remove/change (DEV-63).
export const diffChecklistTemplatesRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/checklists/:id/diff/:otherId',
    {
      preHandler: [requireRole('admin')],
      schema: { params: paramsSchema, response: { 200: checklistTemplateDiffSchema } },
    },
    async (req, reply) => {
      const { id, otherId } = paramsSchema.parse(req.params);

      const rows = await db
        .select()
        .from(checklistTemplates)
        .where(inArray(checklistTemplates.id, [id, otherId]));

      const fromRow = rows.find((row) => row.id === id);
      const toRow = rows.find((row) => row.id === otherId);

      if (!fromRow) {
        throw httpError(404, 'CHECKLIST_TEMPLATE_NOT_FOUND', `Checklist template ${id} not found`);
      }
      if (!toRow) {
        throw httpError(
          404,
          'CHECKLIST_TEMPLATE_NOT_FOUND',
          `Checklist template ${otherId} not found`,
        );
      }

      const { added, removed, changed } = diffChecklistItems(fromRow.items, toRow.items);

      logger.info(
        { reqId: req.id, userId: req.user.id, fromId: id, toId: otherId },
        'checklist template diff computed',
      );

      return reply.code(200).send({
        from: serializeChecklistTemplate(fromRow),
        to: serializeChecklistTemplate(toRow),
        added,
        removed,
        changed,
      });
    },
  );
};
