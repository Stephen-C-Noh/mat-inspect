import { describe, expect, it } from 'vitest';
import { buildInspectionsCsv } from './report-csv.js';
import type { ReportEquipmentSummary, ReportInspectionDetail } from '@mat-inspect/shared-schemas';
import type { ChainSegmentForReport, InspectionDigestCheck } from './chain-segment.js';

const makeChainSegment = (
  overrides: Partial<ChainSegmentForReport> = {},
): ChainSegmentForReport => ({
  chainOk: true,
  chainBrokenAtSeq: null,
  chainCheckedCount: 0,
  segment: [],
  digestChecks: [],
  ...overrides,
});

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
    const csv = buildInspectionsCsv(EQUIPMENT, [makeInspection()], makeChainSegment());
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      'equipmentAssetTag,equipmentName,inspectionId,operatorDisplayName,submittedAt,result,' +
        'blockingDefectCount,warningDefectCount,contentDigestVerified,chainStructureVerified,' +
        'chainBrokenAtSeq',
    );
    expect(lines[1]).toContain('MAT-FL-001');
    expect(lines[1]).toContain('insp-1');
  });

  it('escapes a field containing a comma', () => {
    const csv = buildInspectionsCsv(
      [{ ...EQUIPMENT[0]!, name: 'Forklift, Warehouse Unit' }],
      [makeInspection()],
      makeChainSegment(),
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
    const csv = buildInspectionsCsv(EQUIPMENT, [inspection], makeChainSegment());
    const dataLine = csv.trim().split('\r\n')[1]!;
    const fields = dataLine.split(',');
    expect(fields[6]).toBe('1'); // blockingDefectCount
    expect(fields[7]).toBe('1'); // warningDefectCount
  });

  it('reports VERIFIED, MISMATCH, and NO_AUDIT_EVENT digest states', () => {
    const digestChecks: InspectionDigestCheck[] = [
      { inspectionId: 'insp-1', auditEventFound: true, digestMatches: true },
    ];
    const verified = buildInspectionsCsv(
      EQUIPMENT,
      [makeInspection()],
      makeChainSegment({ digestChecks }),
    );
    expect(verified).toContain('VERIFIED');

    const mismatched = buildInspectionsCsv(
      EQUIPMENT,
      [makeInspection()],
      makeChainSegment({
        digestChecks: [{ inspectionId: 'insp-1', auditEventFound: true, digestMatches: false }],
      }),
    );
    expect(mismatched).toContain('MISMATCH');

    const missing = buildInspectionsCsv(
      EQUIPMENT,
      [makeInspection()],
      makeChainSegment({
        digestChecks: [{ inspectionId: 'insp-1', auditEventFound: false, digestMatches: null }],
      }),
    );
    expect(missing).toContain('NO_AUDIT_EVENT');
  });

  it('carries a broken-chain signal on every data row even when each digest matches', () => {
    const digestChecks: InspectionDigestCheck[] = [
      { inspectionId: 'insp-1', auditEventFound: true, digestMatches: true },
      { inspectionId: 'insp-2', auditEventFound: true, digestMatches: true },
    ];
    const csv = buildInspectionsCsv(
      EQUIPMENT,
      [makeInspection(), makeInspection({ id: 'insp-2' })],
      makeChainSegment({ chainOk: false, chainBrokenAtSeq: 42, digestChecks }),
    );
    const dataLines = csv.trim().split('\r\n').slice(1);
    expect(dataLines).toHaveLength(2);
    for (const line of dataLines) {
      const fields = line.split(',');
      expect(fields[8]).toBe('VERIFIED'); // contentDigestVerified per row
      expect(fields[9]).toBe('BROKEN'); // chainStructureVerified
      expect(fields[10]).toBe('42'); // chainBrokenAtSeq
    }
  });
});
