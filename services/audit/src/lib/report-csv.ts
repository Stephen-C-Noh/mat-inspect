import type { ReportEquipmentSummary, ReportInspectionDetail } from '@mat-inspect/shared-schemas';
import type { InspectionDigestCheck } from './chain-segment.js';

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
];

export const buildInspectionsCsv = (
  equipment: ReportEquipmentSummary[],
  inspections: ReportInspectionDetail[],
  digestChecks: InspectionDigestCheck[],
): string => {
  const equipmentById = new Map(equipment.map((row) => [row.id, row]));
  const digestByInspectionId = new Map(digestChecks.map((check) => [check.inspectionId, check]));

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
    ]);
  });

  return [toRow(HEADER), ...rows].join('\r\n') + '\r\n';
};
