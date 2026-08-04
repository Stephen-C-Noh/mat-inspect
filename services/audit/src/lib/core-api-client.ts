import type { ReportFilters, ReportsInternalData } from '@mat-inspect/shared-schemas';
import { reportsInternalDataSchema } from '@mat-inspect/shared-schemas';
import { config } from './config.js';

// The Audit Service cannot query core_db directly (ADR 0001: services own their data). This is
// the DEV-38 counterpart to core-api's own cross-service call in
// services/core-api/src/routes/ai/transcribe.ts: a plain fetch with a timeout, guarded on the
// receiving end by a shared bearer secret rather than a JWT, because the caller is a machine
// (services/core-api/src/middleware/internal-auth.ts).

const UPSTREAM_TIMEOUT_MS = 15_000;

export class ReportsDataFetchError extends Error {}

export const fetchReportData = async (filters: ReportFilters): Promise<ReportsInternalData> => {
  const cfg = config();

  let upstream: Response;
  try {
    upstream = await fetch(`${cfg.coreApiInternalUrl}/internal/reports-data`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.coreApiInternalToken}`,
      },
      body: JSON.stringify(filters),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ReportsDataFetchError(`core-api is unreachable: ${String(err)}`);
  }

  if (!upstream.ok) {
    // Drains the body so the connection is not held open (same reasoning as transcribe.ts).
    await upstream.body?.cancel();
    throw new ReportsDataFetchError(`core-api answered ${upstream.status}`);
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    throw new ReportsDataFetchError('core-api response was not valid JSON');
  }

  const parsed = reportsInternalDataSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ReportsDataFetchError('core-api response did not match the expected shape');
  }

  return parsed.data;
};
