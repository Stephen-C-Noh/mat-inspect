import type { FastifyPluginAsync } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { submitInspectionSchema, inspectionSchema } from '@mat-inspect/shared-schemas';
import {
  db,
  equipment,
  checklistTemplates,
  inspections,
  inspectionResponses,
  outbox,
  idempotencyKeys,
  defects,
  users,
} from '../../db/index.js';
import { config } from '../../lib/config.js';
import { httpError } from '../../lib/http-error.js';
import { isUniqueViolation } from '../../lib/db-errors.js';
import { requestDigest } from '../../lib/request-digest.js';
import { computeInspectionContentHash } from '@mat-inspect/shared-crypto';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { deriveInspectionResult } from './derive-result.js';
import { buildBlockingDefect, collectBlockingDefectDescriptions } from './blocking-defects.js';
import { serializeInspection } from './serialize.js';
import { notifyFailedInspectionTeams } from '../../lib/notifications/notify-failed-inspection-teams.js';
import { notifyFailedInspection } from '../../lib/notifications/notify-failed-inspection.js';

// Resolves the operator display name and the configured supervisor recipients, then hands off to
// the fire-and-forget email notifier (DEV-21, wired in DEV-81). This runs off the request path: it
// is called with `void` and never rejects, so neither the operator lookup nor an SMTP failure can
// turn into a 5xx. The operator name comes from the users shadow table (inspections.operator_id is
// a FK to it, so the row always exists); it falls back to the token email if the row is somehow
// missing. Recipients come from SUPERVISOR_ALERT_EMAILS (ADR 0013 recipient-resolution note); when
// empty the notifier logs and skips.
const dispatchFailedInspectionEmail = async (params: {
  equipmentName: string;
  assetTag: string;
  operatorId: string;
  operatorEmailFallback: string;
  submittedAt: Date;
  blockingDefects: string[];
}): Promise<void> => {
  try {
    const [operator] = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, params.operatorId))
      .limit(1);

    await notifyFailedInspection({
      result: 'FAIL_BLOCKING',
      equipmentName: params.equipmentName,
      assetTag: params.assetTag,
      operatorDisplayName: operator?.displayName ?? params.operatorEmailFallback,
      submittedAt: params.submittedAt,
      blockingDefects: params.blockingDefects,
      supervisorEmails: config().supervisorAlertEmails,
    });
  } catch (err) {
    logger.warn({ err, assetTag: params.assetTag }, 'failed-inspection email dispatch errored');
  }
};

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
      // Captured from inside the transaction so the post-commit Teams alert can deep-link to the
      // real Defect, not the inspection. Stays null for PASS and FAIL_WARNING (no defect opened).
      let openedDefectId: string | null = null;
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
            // Sealed into the content hash and stored on the immutable row (ADR 0023). Order is
            // the operator's capture order and is preserved through the uuid[] column, so a later
            // verifier reconstructs the same bytes.
            photoIds: response.photoIds,
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

          // Defect lifecycle entry point (DEV-20, ADR 0006). A BLOCKING failure opens exactly
          // one Defect and makes OUT_OF_SERVICE sticky, in the same transaction as the
          // inspection so the record and the lockout either both commit or neither does.
          if (result === 'FAIL_BLOCKING') {
            const blockingDefect = buildBlockingDefect(template.items, body.responses);
            // result === 'FAIL_BLOCKING' already implies a failed BLOCKING item, so this is
            // never null here; the guard narrows the type and stays correct if the two
            // derivations ever drift apart.
            if (blockingDefect) {
              const [defect] = await tx
                .insert(defects)
                .values({
                  inspectionId: inspection!.id,
                  equipmentId: body.equipmentId,
                  itemKey: blockingDefect.itemKey,
                  severity: blockingDefect.severity,
                  description: blockingDefect.description,
                })
                .returning();

              openedDefectId = defect!.id;

              await tx.insert(outbox).values({
                eventType: 'DEFECT_OPENED',
                payload: {
                  defectId: defect!.id,
                  inspectionId: inspection!.id,
                  equipmentId: body.equipmentId,
                  operatorId: req.user.id,
                  itemKey: blockingDefect.itemKey,
                  severity: blockingDefect.severity,
                },
              });

              // Lock the equipment row so concurrent submits serialize on the status write.
              // RETIRED is terminal and OUT_OF_SERVICE is already the target, so neither is
              // re-stamped and no spurious EQUIPMENT_STATUS_CHANGED is emitted for them.
              const [locked] = await tx
                .select({ status: equipment.status })
                .from(equipment)
                .where(eq(equipment.id, body.equipmentId))
                .for('update')
                .limit(1);
              const previousStatus = locked!.status;

              if (previousStatus !== 'OUT_OF_SERVICE' && previousStatus !== 'RETIRED') {
                // currentStatusSince marks the start of this lockout. Written from Postgres now()
                // (the transaction timestamp), the same clock and value as the Defect's opened_at
                // default above, so return-to-service can scope "defects from the current lockout"
                // as opened_at >= current_status_since without a cross-clock off-by-one.
                await tx
                  .update(equipment)
                  .set({
                    status: 'OUT_OF_SERVICE',
                    currentStatusSince: sql`now()`,
                    updatedAt: sql`now()`,
                  })
                  .where(eq(equipment.id, body.equipmentId));

                await tx.insert(outbox).values({
                  eventType: 'EQUIPMENT_STATUS_CHANGED',
                  payload: {
                    equipmentId: body.equipmentId,
                    from: previousStatus,
                    to: 'OUT_OF_SERVICE',
                    reason: 'BLOCKING_INSPECTION_FAILURE',
                    defectId: defect!.id,
                    inspectionId: inspection!.id,
                    operatorId: req.user.id,
                  },
                });
              }
            }
          }

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
      // defectId is the real opened Defect.id: DEV-20 built the Defect Path (ARCHITECTURE.md 7.2
      // step 2), so the card's dashboard deep link resolves to /defects/:id. openedDefectId is set
      // whenever result is FAIL_BLOCKING; the responseBody.id fallback only guards the unreachable
      // FAIL_BLOCKING-with-no-defect case and is never posted (the notifier no-ops on non-blocking).
      void notifyFailedInspectionTeams({
        result,
        assetTag: equipmentRow.assetTag,
        defectId: openedDefectId ?? responseBody.id,
        severity: 'BLOCKING',
      });

      // Fire-and-forget email alert to supervisors on a blocking failure (DEV-21 lib, wired in
      // DEV-81). Email is the minimum guaranteed channel (ADR 0013). Gated on the result here so a
      // PASS or FAIL_WARNING does not run the operator lookup or defect collection; the notifier
      // also guards on result internally. Not awaited (`void`) and never rejects, so a mail failure
      // cannot affect this 201. Placed after the idempotency replay returns above, so a retried
      // submit replays the cached 201 without sending a second email.
      if (result === 'FAIL_BLOCKING') {
        void dispatchFailedInspectionEmail({
          equipmentName: equipmentRow.name,
          assetTag: equipmentRow.assetTag,
          operatorId: req.user.id,
          operatorEmailFallback: req.user.email,
          // serializeInspection rendered submittedAt as an ISO string; parse it back to the Date
          // the email formatter expects. Same instant, no precision loss for a second-granular ts.
          submittedAt: new Date(responseBody.submittedAt),
          blockingDefects: collectBlockingDefectDescriptions(template.items, body.responses),
        });
      }

      return reply.code(201).send(responseBody);
    },
  );
};
