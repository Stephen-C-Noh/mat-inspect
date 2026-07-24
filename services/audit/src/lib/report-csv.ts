import type { ReportEquipmentSummary, ReportInspectionDetail } from '@mat-inspect/shared-schemas';
import type { ChainSegmentForReport } from './chain-segment.js';

// Hand-rolled RFC 4180 writer rather than a dependency: a filtered-inspections CSV is a handful
// of flat columns, and pulling in a library for that is more than the task needs.

const escapeField = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const toRow = (fields: string[]): string => fields.map(escapeField).join(',');

const HEADER = [
  'equipmentAssetTag',
  'equipmentName',
  'inspectionId',
  'operatorDisplayName',
  'submittedAt',
  'result',
  'blockingDefectCount',
  'warningDefectCount',
  'contentDigestVerified',
  // Chain-structure verification is report-wide (genesis through the newest relevant event), not
  // per-inspection, so these two columns carry the same value on every row. They are still
  // included per row so a CSV reader who filters or sorts rows never loses the tamper signal: a
  // broken chain must never read as a clean export just because CSV omitted the column. The PDF
  // prints this as a dedicated "Audit chain segment" section; the CSV cannot, hence the repeat.
  'chainStructureVerified',
  'chainBrokenAtSeq',
];

export const buildInspectionsCsv = (
  equipment: ReportEquipmentSummary[],
  inspections: ReportInspectionDetail[],
  chainSegment: ChainSegmentForReport,
): string => {
  const equipmentById = new Map(equipment.map((row) => [row.id, row]));
  const digestByInspectionId = new Map(
    chainSegment.digestChecks.map((check) => [check.inspectionId, check]),
  );

  const chainVerified = chainSegment.chainOk ? 'VERIFIED' : 'BROKEN';
  const chainBrokenAtSeq =
    chainSegment.chainBrokenAtSeq === null ? '' : String(chainSegment.chainBrokenAtSeq);

  const rows = inspections.map((inspection) => {
    const equipmentRow = equipmentById.get(inspection.equipmentId);
    const digest = digestByInspectionId.get(inspection.id);
    const blockingCount = inspection.defects.filter((d) => d.severity === 'BLOCKING').length;
    const warningCount = inspection.defects.filter((d) => d.severity === 'WARNING').length;

    return toRow([
      equipmentRow?.assetTag ?? inspection.equipmentId,
      equipmentRow?.name ?? '',
      inspection.id,
      inspection.operatorDisplayName,
      inspection.submittedAt,
      inspection.result,
      String(blockingCount),
      String(warningCount),
      digest === undefined
        ? 'NOT_CHECKED'
        : digest.digestMatches === null
          ? 'NO_AUDIT_EVENT'
          : digest.digestMatches
            ? 'VERIFIED'
            : 'MISMATCH',
      chainVerified,
      chainBrokenAtSeq,
    ]);
  });

  return [toRow(HEADER), ...rows].join('\r\n') + '\r\n';
};
