import { eq } from 'drizzle-orm';
import type { ReportExportRequest } from '@mat-inspect/shared-schemas';
import { db, reportJobs } from '../db/index.js';
import { fetchReportData } from './core-api-client.js';
import { buildChainSegmentForInspections } from './chain-segment.js';
import { buildInspectionsPdf } from './report-pdf.js';
import { buildInspectionsCsv } from './report-csv.js';
import { storeReportFile } from './blob-storage.js';
import { signReportFile } from './report-signing.js';
import { logger } from './logger.js';

// Runs off the request path (DEV-38): export.ts inserts the report_jobs row and responds 202
// immediately, then calls this without awaiting it. No queue - the outbox poller (ADR 0008) set
// the precedent that a simple in-process loop is enough at capstone scale, and a fire-and-forget
// promise is simpler still. A process restart mid-generation leaves the job stuck PROCESSING; the
// same accepted limitation as the outbox's eventual-consistency window, not a new one.
export const generateReport = async (
  jobId: string,
  request: ReportExportRequest,
  generatedBy: string,
): Promise<void> => {
  try {
    const data = await fetchReportData(request.filters);
    const chainSegment = await buildChainSegmentForInspections(data.inspections);

    let fileBuffer: Buffer;
    let contentType: 'application/pdf' | 'text/csv';
    if (request.format === 'PDF') {
      fileBuffer = await buildInspectionsPdf({
        equipment: data.equipment,
        inspections: data.inspections,
        filters: request.filters,
        chainSegment,
        options: request.options,
        generatedBy,
      });
      contentType = 'application/pdf';
    } else {
      fileBuffer = Buffer.from(
        buildInspectionsCsv(data.equipment, data.inspections, chainSegment),
        'utf-8',
      );
      contentType = 'text/csv';
    }

    const { sha256, signature, signingKeyFingerprint } = signReportFile(fileBuffer);
    const { blobName } = await storeReportFile(fileBuffer, contentType);

    await db
      .update(reportJobs)
      .set({
        status: 'READY',
        inspectionCount: data.inspections.length,
        fileBytes: fileBuffer.length,
        sha256,
        signature,
        signingKeyFingerprint,
        blobName,
        readyAt: new Date(),
      })
      .where(eq(reportJobs.id, jobId));

    logger.info(
      {
        jobId,
        format: request.format,
        inspectionCount: data.inspections.length,
        fileBytes: fileBuffer.length,
      },
      'report export ready',
    );
  } catch (err) {
    // The real error is logged here, server-side, in full. errorDetail on the row stays generic:
    // it is read back over the API, and CLAUDE.md's logging rules say do not reflect internals to
    // the client.
    logger.error({ jobId, err }, 'report export failed');
    await db
      .update(reportJobs)
      .set({ status: 'FAILED', errorDetail: 'Report generation failed; see server logs' })
      .where(eq(reportJobs.id, jobId));
  }
};
