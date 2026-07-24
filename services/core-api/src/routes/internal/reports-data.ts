import type { FastifyPluginAsync } from 'fastify';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  reportFiltersSchema,
  reportsInternalDataSchema,
  type ReportDefect,
  type ReportEquipmentSummary,
  type ReportInspectionDetail,
  type ReportInspectionResponse,
} from '@mat-inspect/shared-schemas';
import {
  db,
  equipment,
  inspections,
  inspectionResponses,
  defects,
  users,
  checklistTemplates,
} from '../../db/index.js';
import { computeReadiness } from '../../lib/equipment-readiness.js';
import { requireInternalReportsToken } from '../../middleware/internal-auth.js';
import { logger } from '../../lib/logger.js';

// Service-to-service only (DEV-38): the Audit Service's report generator is the sole caller.
// Not registered under /api/v1 and never reachable through the Caddy gateway (its (api) snippet
// only matches /api/v1/*, so /internal/* falls through to whichever app container a browser's
// site block proxies to, not core-api). Guarded by a shared bearer secret, not requireRole,
// because the caller is a machine, not a user (mirrors requireIngestToken on the Audit Service
// for the opposite direction).
export const reportsDataRoute: FastifyPluginAsync = async (app) => {
  app.post(
    '/internal/reports-data',
    {
      preHandler: [requireInternalReportsToken],
      schema: { body: reportFiltersSchema, response: { 200: reportsInternalDataSchema } },
    },
    async (req, reply) => {
      const filters = reportFiltersSchema.parse(req.body);

      const equipmentRows = await db
        .select()
        .from(equipment)
        .where(inArray(equipment.id, filters.equipmentIds));

      const readiness = await computeReadiness(equipmentRows);

      const equipmentSummaries: ReportEquipmentSummary[] = equipmentRows.map((row) => ({
        id: row.id,
        assetTag: row.assetTag,
        name: row.name,
        type: row.type,
        location: row.location,
        status: readiness.get(row.id)!,
      }));

      const inspectionFilters = [
        inArray(inspections.equipmentId, filters.equipmentIds),
        gte(inspections.submittedAt, new Date(filters.dateFrom)),
        lte(inspections.submittedAt, new Date(filters.dateTo)),
      ];
      if (filters.result) inspectionFilters.push(eq(inspections.result, filters.result));

      const inspectionRows = await db
        .select()
        .from(inspections)
        .where(and(...inspectionFilters));

      if (inspectionRows.length === 0) {
        const body = { equipment: equipmentSummaries, inspections: [] };
        return reply.code(200).send(reportsInternalDataSchema.parse(body));
      }

      const inspectionIds = inspectionRows.map((row) => row.id);
      const operatorIds = [...new Set(inspectionRows.map((row) => row.operatorId))];
      const templateIds = [...new Set(inspectionRows.map((row) => row.templateId))];

      const [responseRows, defectRows, operatorRows, templateRows] = await Promise.all([
        db
          .select()
          .from(inspectionResponses)
          .where(inArray(inspectionResponses.inspectionId, inspectionIds)),
        db.select().from(defects).where(inArray(defects.inspectionId, inspectionIds)),
        db.select().from(users).where(inArray(users.id, operatorIds)),
        db.select().from(checklistTemplates).where(inArray(checklistTemplates.id, templateIds)),
      ]);

      const operatorNameById = new Map(operatorRows.map((row) => [row.id, row.displayName]));
      const promptByTemplateAndKey = new Map<string, string>();
      for (const template of templateRows) {
        for (const item of template.items) {
          promptByTemplateAndKey.set(`${template.id}:${item.key}`, item.prompt);
        }
      }

      const inspectionTemplateById = new Map(inspectionRows.map((row) => [row.id, row.templateId]));

      const responsesByInspection = new Map<string, ReportInspectionResponse[]>();
      for (const row of responseRows) {
        const list = responsesByInspection.get(row.inspectionId) ?? [];
        const templateId = inspectionTemplateById.get(row.inspectionId);
        list.push({
          itemKey: row.itemKey,
          value: row.value,
          passed: row.passed,
          notes: row.notes,
          notesSource: row.notesSource,
          // inspection_responses has no photo_ids column yet (DEV-104 adds it and seals it into
          // the content hash); always empty until that lands, so the report generator has
          // nothing to embed today.
          photoIds: [],
          // Falls back to the item key when a template was edited or deleted such that the key
          // no longer resolves; the PDF still shows something identifiable rather than throwing.
          prompt: promptByTemplateAndKey.get(`${templateId}:${row.itemKey}`) ?? row.itemKey,
        });
        responsesByInspection.set(row.inspectionId, list);
      }

      const defectsByInspection = new Map<string, ReportDefect[]>();
      for (const row of defectRows) {
        const list = defectsByInspection.get(row.inspectionId) ?? [];
        list.push({
          id: row.id,
          itemKey: row.itemKey,
          severity: row.severity,
          description: row.description,
          photoIds: row.photoIds,
          status: row.status,
          resolvedAt: row.resolvedAt?.toISOString() ?? null,
          resolutionNotes: row.resolutionNotes,
        });
        defectsByInspection.set(row.inspectionId, list);
      }

      const inspectionDetails: ReportInspectionDetail[] = inspectionRows.map((row) => ({
        id: row.id,
        equipmentId: row.equipmentId,
        operatorId: row.operatorId,
        operatorDisplayName: operatorNameById.get(row.operatorId) ?? row.operatorId,
        templateId: row.templateId,
        templateVersion: row.templateVersion,
        result: row.result,
        submittedAt: row.submittedAt.toISOString(),
        responses: responsesByInspection.get(row.id) ?? [],
        defects: defectsByInspection.get(row.id) ?? [],
      }));

      logger.info(
        {
          reqId: req.id,
          equipmentCount: equipmentSummaries.length,
          inspectionCount: inspectionDetails.length,
        },
        'internal reports-data served',
      );

      return reply.code(200).send(
        reportsInternalDataSchema.parse({
          equipment: equipmentSummaries,
          inspections: inspectionDetails,
        }),
      );
    },
  );
};
