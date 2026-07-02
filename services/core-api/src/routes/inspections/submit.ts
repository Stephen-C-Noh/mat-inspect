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
import { computeInspectionContentHash } from '../../lib/content-hash.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { deriveInspectionResult } from './derive-result.js';
import { serializeInspection } from './serialize.js';

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

          // Normalized once and reused for both the insert and the content digest below, so the
          // hash input is byte-identical to what a later reader reconstructs from the persisted
          // rows (DEV-23 / ADR 0008).
          const normalizedResponses = body.responses.map((response) => ({
            itemKey: response.itemKey,
            value: response.value,
            passed: response.passed,
            notes: response.notes ?? null,
            notesSource: response.notesSource ?? null,
          }));

          if (normalizedResponses.length > 0) {
            await tx.insert(inspectionResponses).values(
              normalizedResponses.map((response) => ({
                inspectionId: inspection!.id,
                ...response,
              })),
            );
          }

          // Seals the inspection + its responses + result into the audit chain (ADR 0008). A
          // hash is not PII, so it is safe to carry in the outbox payload and the audit log.
          const contentHash = computeInspectionContentHash({
            inspectionId: inspection!.id,
            equipmentId: body.equipmentId,
            operatorId: req.user.id,
            templateId: body.templateId,
            templateVersion: template.version,
            result,
            submittedAt: inspection!.submittedAt.toISOString(),
            responses: normalizedResponses,
          });

          // Outbox row; the poller (DEV-23) delivers it to the Audit Service, which seals it
          // into the hash chain.
          await tx.insert(outbox).values({
            eventType: 'INSPECTION_SUBMITTED',
            payload: {
              inspectionId: inspection!.id,
              equipmentId: body.equipmentId,
              operatorId: req.user.id,
              result,
              contentHash,
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

      return reply.code(201).send(responseBody);
    },
  );
};
