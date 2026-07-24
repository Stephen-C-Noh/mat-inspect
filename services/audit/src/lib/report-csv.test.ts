import { describe, expect, it } from 'vitest';
import { buildInspectionsCsv } from './report-csv.js';
import type { ReportEquipmentSummary, ReportInspectionDetail } from '@mat-inspect/shared-schemas';
import type { InspectionDigestCheck } from './chain-segment.js';

const EQUIPMENT: ReportEquipmentSummary[] = [
  {
    id: 'eq-1',
    assetTag: 'MAT-FL-001',
    name: 'Forklift 1',
    type: 'FORKLIFT',
    location: 'MAT Warehouse',
    status: 'READY',
  },
];

const makeInspection = (
  overrides: Partial<ReportInspectionDetail> = {},
): ReportInspectionDetail => ({
  id: 'insp-1',
  equipmentId: 'eq-1',
  operatorId: 'op-1',
  operatorDisplayName: 'Jane Doe',
  templateId: 'tmpl-1',
  templateVersion: 1,
  result: 'PASS',
  submittedAt: '2026-05-19T18:31:42.123000Z',
  responses: [],
  defects: [],
  ...overrides,
});

describe('buildInspectionsCsv', () => {
  it('writes a header row and one row per inspection', () => {
    const csv = buildInspectionsCsv(EQUIPMENT, [makeInspection()], []);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      'equipmentAssetTag,equipmentName,inspectionId,operatorDisplayName,submittedAt,result,' +
        'blockingDefectCount,warningDefectCount,contentDigestVerified',
    );
    expect(lines[1]).toContain('MAT-FL-001');
    expect(lines[1]).toContain('insp-1');
  });

  it('escapes a field containing a comma', () => {
    const csv = buildInspectionsCsv(
      [{ ...EQUIPMENT[0]!, name: 'Forklift, Warehouse Unit' }],
      [makeInspection()],
      [],
    );
    expect(csv).toContain('"Forklift, Warehouse Unit"');
  });

  it('counts blocking and warning defects separately', () => {
    const inspection = makeInspection({
      defects: [
        {
          id: 'd1',
          itemKey: 'brakes',
          severity: 'BLOCKING',
          description: 'x',
          photoIds: [],
          status: 'OPEN',
          resolvedAt: null,
          resolutionNotes: null,
        },
        {
          id: 'd2',
          itemKey: 'horn',
          severity: 'WARNING',
          description: 'y',
          photoIds: [],
          status: 'OPEN',
          resolvedAt: null,
          resolutionNotes: null,
        },
      ],
    });
    const csv = buildInspectionsCsv(EQUIPMENT, [inspection], []);
    const dataLine = csv.trim().split('\r\n')[1]!;
    const fields = dataLine.split(',');
    expect(fields[6]).toBe('1'); // blockingDefectCount
    expect(fields[7]).toBe('1'); // warningDefectCount
  });

  it('reports VERIFIED, MISMATCH, and NO_AUDIT_EVENT digest states', () => {
    const digestChecks: InspectionDigestCheck[] = [
      { inspectionId: 'insp-1', auditEventFound: true, digestMatches: true },
    ];
    const verified = buildInspectionsCsv(EQUIPMENT, [makeInspection()], digestChecks);
    expect(verified).toContain('VERIFIED');

    const mismatched = buildInspectionsCsv(
      EQUIPMENT,
      [makeInspection()],
      [{ inspectionId: 'insp-1', auditEventFound: true, digestMatches: false }],
    );
    expect(mismatched).toContain('MISMATCH');

    const missing = buildInspectionsCsv(
      EQUIPMENT,
      [makeInspection()],
      [{ inspectionId: 'insp-1', auditEventFound: false, digestMatches: null }],
    );
    expect(missing).toContain('NO_AUDIT_EVENT');
  });
});
