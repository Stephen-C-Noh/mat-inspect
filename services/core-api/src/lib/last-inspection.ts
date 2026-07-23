import { and, eq, inArray, sql } from 'drizzle-orm';
import type { InspectionResult } from '@mat-inspect/shared-types';
import { db, inspections, users } from '../db/index.js';

export type LastInspectionSummary = {
  lastInspectionAt: string | null;
  lastInspectionResult: InspectionResult | null;
  lastInspectionOperatorDisplayName: string | null;
};

const EMPTY_SUMMARY: LastInspectionSummary = {
  lastInspectionAt: null,
  lastInspectionResult: null,
  lastInspectionOperatorDisplayName: null,
};

// One query for every candidate equipment, not one per row (same batching approach as
// computeReadiness in equipment-readiness.ts). Backs the fleet grid's "last inspection / who
// performed it / result" columns (DEV-37).
export const loadLastInspections = async (
  equipmentIds: string[],
): Promise<Map<string, LastInspectionSummary>> => {
  const result = new Map<string, LastInspectionSummary>();
  if (equipmentIds.length === 0) return result;

  const latestPerEquipment = db
    .select({
      equipmentId: inspections.equipmentId,
      maxSubmittedAt: sql<Date>`max(${inspections.submittedAt})`.as('max_submitted_at'),
    })
    .from(inspections)
    .where(inArray(inspections.equipmentId, equipmentIds))
    .groupBy(inspections.equipmentId)
    .as('latest');

  const rows = await db
    .select({
      equipmentId: inspections.equipmentId,
      submittedAt: inspections.submittedAt,
      result: inspections.result,
      operatorDisplayName: users.displayName,
    })
    .from(inspections)
    .innerJoin(
      latestPerEquipment,
      and(
        eq(inspections.equipmentId, latestPerEquipment.equipmentId),
        eq(inspections.submittedAt, latestPerEquipment.maxSubmittedAt),
      ),
    )
    .innerJoin(users, eq(users.id, inspections.operatorId));

  for (const row of rows) {
    // Two inspections on the same equipment at the identical microsecond timestamp would both
    // match here; last-write-wins into the map. Not something a real submittedAt (Postgres
    // timestamptz) produces in practice, and harmless if it ever did.
    result.set(row.equipmentId, {
      lastInspectionAt: row.submittedAt.toISOString(),
      lastInspectionResult: row.result,
      lastInspectionOperatorDisplayName: row.operatorDisplayName,
    });
  }

  for (const id of equipmentIds) {
    if (!result.has(id)) result.set(id, EMPTY_SUMMARY);
  }

  return result;
};
