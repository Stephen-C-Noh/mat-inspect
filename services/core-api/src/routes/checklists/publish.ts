import type { FastifyPluginAsync } from 'fastify';
import { and, eq, max } from 'drizzle-orm';
import {
  checklistTemplateSchema,
  publishChecklistTemplateSchema,
} from '@mat-inspect/shared-schemas';
import { db, checklistTemplates } from '../../db/index.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { serializeChecklistTemplate } from './serialize.js';

export const publishChecklistTemplateRoute: FastifyPluginAsync = async (app) => {
  app.post(
    '/checklists',
    {
      preHandler: [requireRole('admin')],
      schema: { body: publishChecklistTemplateSchema, response: { 201: checklistTemplateSchema } },
    },
    async (req, reply) => {
      const body = publishChecklistTemplateSchema.parse(req.body);

      // Self-review would make the reviewedBy field a no-op attestation.
      if (body.reviewedBy === req.user.id) {
        throw httpError(
          400,
          'CHECKLIST_TEMPLATE_INVALID_REVIEWER',
          'reviewedBy must not be the publishing admin',
        );
      }

      // New version becomes active; the previous active row for this equipment type flips
      // to inactive in the same transaction so exactly one row per type is ever active.
      // Old versions are retained (Inspection rows reference template_id + template_version).
      const row = await db.transaction(async (tx) => {
        // Lock existing rows for this equipment type first. A concurrent publish for
        // the same type blocks here until this transaction commits, so the two
        // transactions can't both compute the same maxVersion and both insert an
        // isActive row (DEV-13 review).
        await tx
          .select({ id: checklistTemplates.id })
          .from(checklistTemplates)
          .where(eq(checklistTemplates.equipmentType, body.equipmentType))
          .for('update');

        const [maxVersionRow] = await tx
          .select({ maxVersion: max(checklistTemplates.version) })
          .from(checklistTemplates)
          .where(eq(checklistTemplates.equipmentType, body.equipmentType));
        const maxVersion = maxVersionRow?.maxVersion ?? 0;

        await tx
          .update(checklistTemplates)
          .set({ isActive: false })
          .where(
            and(
              eq(checklistTemplates.equipmentType, body.equipmentType),
              eq(checklistTemplates.isActive, true),
            ),
          );

        const [inserted] = await tx
          .insert(checklistTemplates)
          .values({
            equipmentType: body.equipmentType,
            version: maxVersion + 1,
            isActive: true,
            items: body.items,
            createdBy: req.user.id,
            reviewedBy: body.reviewedBy ?? null,
          })
          .returning();

        return inserted!;
      });

      logger.info(
        {
          reqId: req.id,
          userId: req.user.id,
          equipmentType: body.equipmentType,
          templateId: row.id,
          version: row.version,
        },
        'checklist template published',
      );

      return reply.code(201).send(serializeChecklistTemplate(row));
    },
  );
};
