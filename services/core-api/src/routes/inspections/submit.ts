import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { submitInspectionSchema, inspectionSchema } from '@mat-inspect/shared-schemas';
import {
  db,
  equipment,
  checklistTemplates,
  inspections,
  inspectionResponses,
  outbox,
  idempotencyKeys,
} from '../../db/index.js';
import { httpError } from '../../lib/http-error.js';
import { isUniqueViolation } from '../../lib/db-errors.js';
import { requestDigest } from '../../lib/request-digest.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { deriveInspectionResult } from './derive-result.js';
import { serializeInspection } from './serialize.js';
import { notifyFailedInspectionTeams } from '../../lib/notifications/notify-failed-inspection-teams.js';

// Looks up the cached idempotency record for (operatorId, key). Returns the stored response
// when the digest matches, or throws IDEMPOTENCY_MISMATCH when it doesn't (ADR 0009).
const findCachedResponse = async (
  operatorId: string,
  key: string,
  digest: string,
): Promise<{ status: 201; body: unknown } | undefined> => {
  const [existing] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.operatorId, operatorId), eq(idempotencyKeys.key, key)))
    .limit(1);

  if (!existing) return undefined;

  if (existing.requestDigest !== digest) {
    throw httpError(
      409,
      'IDEMPOTENCY_MISMATCH',
      'Idempotency-Key was already used with a different request body',
    );
  }

  // responseStatus is stored generically (ADR 0009), but this route only ever writes 201.
  return { status: existing.responseStatus as 201, body: existing.responseBody };
};

export const submitInspectionRoute: FastifyPluginAsync = async (app) => {
  app.post(
    '/inspections',
    {
      preHandler: [requireRole('operator')],
      schema: { body: submitInspectionSchema, response: { 201: inspectionSchema } },
    },
    async (req, reply) => {
      const body = submitInspectionSchema.parse(req.body);

      const idempotencyKey = req.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
        throw httpError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
      }

      const digest = requestDigest(body);

      // Pre-check so the common retry case returns a clean cached response instead of
      // racing the insert below. This cannot close the race (two concurrent retries can
      // both pass it before either commits); idempotency_keys_operator_key is the real
      // guard, and the unique-violation catch below resolves a genuine race the same way.
      const cached = await findCachedResponse(req.user.id, idempotencyKey, digest);
      if (cached) {
        return reply.code(cached.status).send(cached.body);
      }

      // Load the equipment first: equipment_id is a foreign key, so a well-formed but
      // unknown id would otherwise surface as an unhandled 500 on insert instead of a 404.
      const [equipmentRow] = await db
        .select()
        .from(equipment)
        .where(eq(equipment.id, body.equipmentId))
        .limit(1);

      if (!equipmentRow) {
        throw httpError(404, 'EQUIPMENT_NOT_FOUND', `Equipment ${body.equipmentId} not found`);
      }

      const [template] = await db
        .select()
        .from(checklistTemplates)
        .where(eq(checklistTemplates.id, body.templateId))
        .limit(1);

      if (!template) {
        throw httpError(
          404,
          'CHECKLIST_TEMPLATE_NOT_FOUND',
          `Checklist template ${body.templateId} not found`,
        );
      }

      // The template must belong to this equipment's type, otherwise an operator could grade
      // a forklift against a crane checklist (or any template) to manufacture a result.
      if (template.equipmentType !== equipmentRow.type) {
        throw httpError(
          400,
          'INSPECTION_TEMPLATE_MISMATCH',
          `Template ${body.templateId} is for ${template.equipmentType}, not equipment type ${equipmentRow.type}`,
        );
      }

      // Inspections are graded against the currently active checklist only. A stale or draft
      // version (often one with fewer BLOCKING items) cannot be used to pass equipment.
      if (!template.isActive) {
        throw httpError(
          409,
          'INSPECTION_TEMPLATE_INACTIVE',
          `Template ${body.templateId} is not the active checklist for ${equipmentRow.type}`,
        );
      }

      const result = deriveInspectionResult(template.items, body.responses);

      let responseBody: ReturnType<typeof serializeInspection>;
      try {
        responseBody = await db.transaction(async (tx) => {
          const [inspection] = await tx
            .insert(inspections)
            .values({
              equipmentId: body.equipmentId,
              operatorId: req.user.id,
              templateId: body.templateId,
              templateVersion: template.version,
              result,
            })
            .returning();

          if (body.responses.length > 0) {
            await tx.insert(inspectionResponses).values(
              body.responses.map((response) => ({
                inspectionId: inspection!.id,
                itemKey: response.itemKey,
                value: response.value,
                passed: response.passed,
                notes: response.notes ?? null,
                notesSource: response.notesSource ?? null,
              })),
            );
          }

          // Outbox row only; the poller, hash chain, and content digest are DEV-23.
          await tx.insert(outbox).values({
            eventType: 'INSPECTION_SUBMITTED',
            payload: {
              inspectionId: inspection!.id,
              equipmentId: body.equipmentId,
              operatorId: req.user.id,
              result,
            },
          });

          const serialized = serializeInspection(inspection!);

          await tx.insert(idempotencyKeys).values({
            key: idempotencyKey,
            operatorId: req.user.id,
            requestDigest: digest,
            responseStatus: 201,
            responseBody: serialized,
          });

          return serialized;
        });
      } catch (err) {
        // A concurrent retry with the same key won the race between the pre-check above and
        // this transaction. Its idempotency row is now visible; replay it the same way the
        // pre-check would have.
        if (isUniqueViolation(err)) {
          const winner = await findCachedResponse(req.user.id, idempotencyKey, digest);
          if (winner) {
            return reply.code(winner.status).send(winner.body);
          }
        }
        throw err;
      }

      logger.info(
        {
          reqId: req.id,
          userId: req.user.id,
          equipmentId: body.equipmentId,
          inspectionId: responseBody.id,
          result,
        },
        'inspection submitted',
      );

      // Fire-and-forget Teams fast-nudge to the Supervisors channel on a blocking failure (ADR
      // 0013, DEV-39). notifyFailedInspectionTeams guards on result, so PASS and FAIL_WARNING are
      // no-ops; only FAIL_BLOCKING posts a card. It never rejects and is not awaited (`void`), so
      // a webhook failure cannot affect this 201 response. Placed after the commit and after the
      // idempotency replay returns above, so a retried submit replays the cached 201 without
      // re-posting the card.
      //
      // defectId carries the inspection id as a stand-in: the Defect record (ARCHITECTURE.md 7.2
      // step 2, the Defect Path) is not built yet, so no Defect.id exists. Swap to the real
      // Defect.id once that lands. The DEV-21 email alert (notifyFailedInspection, the minimum
      // guaranteed channel) belongs at this same point.
      void notifyFailedInspectionTeams({
        result,
        assetTag: equipmentRow.assetTag,
        defectId: responseBody.id,
        severity: 'BLOCKING',
      });

      return reply.code(201).send(responseBody);
    },
  );
};
