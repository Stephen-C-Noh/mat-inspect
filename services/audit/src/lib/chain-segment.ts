import { and, eq, inArray } from 'drizzle-orm';
import { computeInspectionContentHash } from '@mat-inspect/shared-crypto';
import type { ReportInspectionDetail } from '@mat-inspect/shared-schemas';
import { db, auditEvents } from '../db/index.js';
import { verifyChainSegment, type AuditEventRow } from './chain.js';

// "Chain verification runs on export" (DEV-38 acceptance criteria) means two distinct things,
// both handled here:
//
// 1. Content-digest check: recompute each inspection's content_hash from the data core-api
//    handed over and compare it to the value sealed in that inspection's INSPECTION_SUBMITTED
//    audit event (ADR 0008). A mismatch means core_db was altered after the event was sealed -
//    exactly the tampering the digest exists to catch. An inspection with no matching event at
//    all is flagged too (either the outbox hasn't delivered it yet, ADR 0008's accepted eventual-
//    consistency window, or something worse); either way it is surfaced, never silently dropped.
// 2. Chain-structure check: the hash chain itself is intact from genesis through the newest
//    relevant event. Reuses verifyChainSegment (chain.ts) so this is the exact same
//    recompute-and-compare logic verifyChain runs at startup, not a second hand-written copy.

export type InspectionDigestCheck = {
  inspectionId: string;
  auditEventFound: boolean;
  // null only when auditEventFound is false - there is nothing to compare against.
  digestMatches: boolean | null;
};

export type ChainSegmentForReport = {
  chainOk: boolean;
  chainBrokenAtSeq: number | null;
  chainCheckedCount: number;
  // Genesis through the newest relevant event, contiguous (see chain.ts's verifyChainSegment
  // doc comment for why a resourceId-filtered subset would not be independently verifiable).
  segment: AuditEventRow[];
  digestChecks: InspectionDigestCheck[];
};

export const buildChainSegmentForInspections = async (
  inspections: ReportInspectionDetail[],
): Promise<ChainSegmentForReport> => {
  if (inspections.length === 0) {
    return {
      chainOk: true,
      chainBrokenAtSeq: null,
      chainCheckedCount: 0,
      segment: [],
      digestChecks: [],
    };
  }

  const inspectionIds = inspections.map((inspection) => inspection.id);
  const events = await db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.resourceType, 'INSPECTION'),
        eq(auditEvents.action, 'INSPECTION_SUBMITTED'),
        inArray(auditEvents.resourceId, inspectionIds),
      ),
    );

  const eventByInspectionId = new Map(events.map((event) => [event.resourceId, event]));

  const digestChecks: InspectionDigestCheck[] = inspections.map((inspection) => {
    const event = eventByInspectionId.get(inspection.id);
    if (!event) {
      return { inspectionId: inspection.id, auditEventFound: false, digestMatches: null };
    }

    const recomputed = computeInspectionContentHash({
      inspectionId: inspection.id,
      equipmentId: inspection.equipmentId,
      operatorId: inspection.operatorId,
      templateId: inspection.templateId,
      templateVersion: inspection.templateVersion,
      result: inspection.result,
      submittedAt: inspection.submittedAt,
      responses: inspection.responses.map((response) => ({
        itemKey: response.itemKey,
        value: response.value,
        passed: response.passed,
        notes: response.notes,
        notesSource: response.notesSource,
        // Part of the sealed digest since ADR 0023; core-api seals it, so omitting it here would
        // make every inspection that carries photos (and every one that carries none, since []
        // is still in the hashed shape) report a false mismatch.
        photoIds: response.photoIds,
        // Part of the sealed digest since ADR 0028, same reason as photoIds above.
        defectCategory: response.defectCategory,
      })),
    });

    const sealed = (event.payloadSummary as Record<string, unknown>)['contentHash'];
    return {
      inspectionId: inspection.id,
      auditEventFound: true,
      digestMatches: recomputed === sealed,
    };
  });

  const relevantSeqs = events.map((event) => event.seq);
  const verification =
    relevantSeqs.length > 0
      ? await verifyChainSegment(Math.max(...relevantSeqs))
      : { ok: true as const, checked: 0, rows: [] };

  return {
    chainOk: verification.ok,
    chainBrokenAtSeq: verification.ok ? null : verification.brokenAtSeq,
    chainCheckedCount: verification.checked,
    segment: verification.rows,
    digestChecks,
  };
};
