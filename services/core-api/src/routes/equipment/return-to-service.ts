import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { equipmentSchema, uuidSchema } from '@mat-inspect/shared-schemas';
import { db, equipment, defects, outbox } from '../../db/index.js';
import { computeReadiness } from '../../lib/equipment-readiness.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { requireRole } from '../../middleware/auth.js';
import { serializeEquipment } from './serialize.js';

const paramsSchema = z.object({ id: uuidSchema });

// A blocking defect that has not reached a terminal state still locks the equipment out.
const NON_TERMINAL_STATUSES = new Set(['OPEN', 'ACKNOWLEDGED', 'IN_REPAIR']);

// Return-to-service is the explicit, separate action ADR 0006 requires: resolution alone does
// not restore the equipment. It bumps readiness_baseline_at to now(), so any pass from earlier
// the same day (before the repair) predates the watermark and no longer counts. The equipment
// therefore reads as AWAITING_INSPECTION until a fresh passing inspection is submitted after
// the approval, which is the "fresh passing inspection" the acceptance criteria describe. Only
// Supervisor/Manager may approve (supervisor approval).
export const returnToServiceRoute: FastifyPluginAsync = async (app) => {
  app.post(
    '/equipment/:id/return-to-service',
    {
      preHandler: [requireRole('supervisor', 'manager')],
      schema: { params: paramsSchema, response: { 200: equipmentSchema } },
    },
    async (req, reply) => {
      const { id } = paramsSchema.parse(req.params);

      const row = await db.transaction(async (tx) => {
        // Lock the equipment row so two approvals cannot both bump the watermark.
        const [locked] = await tx
          .select()
          .from(equipment)
          .where(eq(equipment.id, id))
          .for('update')
          .limit(1);

        if (!locked) {
          throw httpError(404, 'EQUIPMENT_NOT_FOUND', `Equipment ${id} not found`);
        }
        if (locked.status !== 'OUT_OF_SERVICE') {
          throw httpError(
            409,
            'EQUIPMENT_NOT_OUT_OF_SERVICE',
            `Return-to-service applies only to OUT_OF_SERVICE equipment, not ${locked.status}`,
          );
        }

        // Scope to the current lockout only: a defect from a prior repair cycle (resolved and
        // already returned to service) must not authorize this approval. currentStatusSince marks
        // when this OUT_OF_SERVICE period began, and submit.ts writes it from the same Postgres
        // now() as the Defect's opened_at, so opened_at >= currentStatusSince selects exactly the
        // current cycle's defects (ADR 0006; review finding on stale RESOLVED defects).
        const blockingDefects = await tx
          .select()
          .from(defects)
          .where(
            and(
              eq(defects.equipmentId, id),
              eq(defects.severity, 'BLOCKING'),
              gte(defects.openedAt, locked.currentStatusSince),
            ),
          );

        const stillOpen = blockingDefects.filter((d) => NON_TERMINAL_STATUSES.has(d.status));
        if (stillOpen.length > 0) {
          throw httpError(
            409,
            'DEFECT_STILL_OPEN',
            'Resolve all open blocking defects before return-to-service',
          );
        }

        const resolved = blockingDefects.filter((d) => d.status === 'RESOLVED');
        if (resolved.length === 0) {
          throw httpError(
            409,
            'NO_RESOLVED_DEFECT',
            'Return-to-service requires a resolved blocking defect',
          );
        }

        // Stamp the approval on every resolved blocking defect in this cycle, not just the most
        // recent: submit.ts opens a new Defect on each FAIL_BLOCKING submission without checking
        // for an existing one, so a lockout can accumulate more than one before it is repaired.
        // Approval closes the whole cycle, so every resolved defect in it must clear together
        // (DEV-101); otherwise the others sit in the queue forever with returnToServiceApprovedBy
        // still null even though the equipment is already back in service.
        const resolvedIds = resolved.map((d) => d.id);
        await tx
          .update(defects)
          .set({ returnToServiceApprovedBy: req.user.id })
          .where(inArray(defects.id, resolvedIds));

        // Set the watermark from Postgres now() (the transaction timestamp), not a JS Date.
        // readiness_baseline_at is compared against inspection submitted_at, which is also a
        // Postgres timestamp, so both must come from the same clock. Mixing a JS millisecond
        // value with a Postgres microsecond value can order two near-simultaneous events wrong.
        const [updated] = await tx
          .update(equipment)
          .set({
            status: 'AWAITING_INSPECTION',
            readinessBaselineAt: sql`now()`,
            currentStatusSince: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(eq(equipment.id, id))
          .returning();

        // Outbox row only; the poller, hash chain, and content digest are DEV-23.
        // defectIds is comma-joined, not an array: payloadSummary (auditEventIngestSchema in
        // packages/shared-schemas) is a flat string/boolean/null record, since it is part of the
        // hash chain input and must round-trip byte-identically through the jsonb column on
        // verify (ADR 0008). An array value fails that schema and the Audit Service rejects the
        // ingest with 400, same failure mode DEV-142 fixed for the missing actor/resource fields.
        await tx.insert(outbox).values({
          eventType: 'EQUIPMENT_STATUS_CHANGED',
          payload: {
            equipmentId: id,
            from: 'OUT_OF_SERVICE',
            to: 'AWAITING_INSPECTION',
            reason: 'RETURN_TO_SERVICE',
            approvedBy: req.user.id,
            defectIds: resolvedIds.join(','),
          },
        });

        return updated!;
      });

      const readiness = await computeReadiness([row]);

      logger.info(
        { reqId: req.id, userId: req.user.id, equipmentId: id },
        'equipment returned to service',
      );

      return reply.code(200).send(serializeEquipment(row, readiness.get(row.id)!));
    },
  );
};
