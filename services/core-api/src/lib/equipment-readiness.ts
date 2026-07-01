import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { EquipmentStatus } from '@mat-inspect/shared-types';
import { db, equipment, inspections, defects } from '../db/index.js';

// Lab-local calendar day for the "submitted today" check (ADR 0006). The MAT lab runs in
// Edmonton; a fixed IANA zone keeps the day boundary correct across DST without a job.
const LAB_TIMEZONE = 'America/Edmonton';

type EquipmentRow = typeof equipment.$inferSelect;

// Positive list avoids notInArray on a pgEnum column, which Drizzle does not cast reliably.
const BLOCKING_DEFECT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'IN_REPAIR'] as const;

// Computes the read-time status for each row per ADR 0006: OUT_OF_SERVICE and RETIRED are
// stored, sticky overrides; everything else is READY only if a passing Inspection exists for
// the lab-local calendar day at or after readiness_baseline_at, and no open blocking Defect
// exists, otherwise AWAITING_INSPECTION. Batches both checks across all candidate rows so a
// list of N equipment costs two queries, not N.
export const computeReadiness = async (
  rows: EquipmentRow[],
): Promise<Map<string, EquipmentStatus>> => {
  const result = new Map<string, EquipmentStatus>();

  const candidateIds: string[] = [];
  for (const row of rows) {
    if (row.status === 'OUT_OF_SERVICE' || row.status === 'RETIRED') {
      result.set(row.id, row.status);
    } else {
      candidateIds.push(row.id);
    }
  }

  if (candidateIds.length === 0) return result;

  const passingTodayRows = await db
    .select({ equipmentId: inspections.equipmentId })
    .from(inspections)
    .innerJoin(equipment, eq(equipment.id, inspections.equipmentId))
    .where(
      and(
        inArray(inspections.equipmentId, candidateIds),
        eq(inspections.result, 'PASS'),
        gte(inspections.submittedAt, equipment.readinessBaselineAt),
        sql`(${inspections.submittedAt} AT TIME ZONE ${LAB_TIMEZONE})::date
            = (now() AT TIME ZONE ${LAB_TIMEZONE})::date`,
      ),
    )
    .groupBy(inspections.equipmentId);
  const passingTodayIds = new Set(passingTodayRows.map((row) => row.equipmentId));

  const blockedRows = await db
    .select({ equipmentId: defects.equipmentId })
    .from(defects)
    .where(
      and(
        inArray(defects.equipmentId, candidateIds),
        eq(defects.severity, 'BLOCKING'),
        inArray(defects.status, [...BLOCKING_DEFECT_STATUSES]),
      ),
    )
    .groupBy(defects.equipmentId);
  const blockedIds = new Set(blockedRows.map((row) => row.equipmentId));

  for (const id of candidateIds) {
    result.set(
      id,
      passingTodayIds.has(id) && !blockedIds.has(id) ? 'READY' : 'AWAITING_INSPECTION',
    );
  }

  return result;
};
