import type { FailSeverity, InspectionResult } from '@mat-inspect/shared-types';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { buildFailedInspectionCard, type TeamsWebhookPayload } from './teams-card.js';
import { getTeamsSender, type TeamsSender } from './teams-webhook.js';

export type FailedInspectionTeamsAlert = {
  // Server-derived inspection result. Only FAIL_BLOCKING triggers the card (ADR 0013: no card on
  // PASS or FAIL_WARNING).
  result: InspectionResult;
  // Equipment asset tag and the opened Defect id. Both are identifiers, not PII. Operator name,
  // transcript text, and photos are deliberately absent from this type so the card cannot carry
  // them (ADR 0013 PII rule).
  assetTag: string;
  defectId: string;
  severity: FailSeverity;
};

// Minimal structured-logger surface. The real logger (Pino) satisfies it; tests pass a spy.
type LogFn = (obj: object, msg: string) => void;
type NotifyLogger = { warn: LogFn; info: LogFn };

export type TeamsNotifyDeps = {
  // Inject to test without a live webhook. undefined means "use the configured sender"; null
  // means "no sender available" (TEAMS_WEBHOOK_URL not configured).
  sender?: TeamsSender | null;
  // Dashboard origin used to build the card deep link. undefined means "read from config"; an
  // empty string or unset config posts the card without a deep-link button.
  dashboardBaseUrl?: string;
  // Injected so tests run without real timers.
  sleep?: (ms: number) => Promise<void>;
  log?: NotifyLogger;
};

// Mirrors the email channel's transient-failure handling: one initial attempt plus three retries
// with exponential backoff. Total backoff (1+2+4 = 7s) stays well inside the 60s alert budget
// (ADR 0013 acceptance criterion).
const RETRY_DELAYS_MS = [1000, 2000, 4000];

// Dashboard path for a single defect. Matches the /defects/:id resource shape (API_REFERENCE).
const DEFECT_DASHBOARD_PATH = '/defects';

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// A missing DASHBOARD_BASE_URL is a persistent config state, not a per-inspection event, so warn
// once per process rather than on every blocking failure.
let warnedMissingDashboardUrl = false;

// Test-only: re-arms the once-per-process "DASHBOARD_BASE_URL not set" warning.
export const resetDashboardUrlWarningForTest = (): void => {
  warnedMissingDashboardUrl = false;
};

// Composes the absolute deep link, or undefined when no dashboard base URL is configured.
const buildDeepLink = (baseUrl: string | undefined, defectId: string): string | undefined => {
  if (!baseUrl) return undefined;
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}${DEFECT_DASHBOARD_PATH}/${encodeURIComponent(defectId)}`;
};

const sendWithRetry = async (
  sender: TeamsSender,
  payload: TeamsWebhookPayload,
  sleep: (ms: number) => Promise<void>,
  log: NotifyLogger,
  assetTag: string,
): Promise<void> => {
  const maxAttempts = RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sender(payload);
      if (attempt > 1) {
        log.info({ assetTag, attempt }, 'failed-inspection Teams card posted after retry');
      }
      return;
    } catch (err) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      if (delay === undefined) {
        // Retries exhausted. One warn, then give up: the Teams post is fire-and-forget, so a
        // persistent webhook failure must not surface as a 5xx. The dashboard queue is the
        // not-missed backstop (ADR 0013).
        log.warn({ err, assetTag, attempts: maxAttempts }, 'failed-inspection Teams post failed');
        return;
      }
      await sleep(delay);
    }
  }
};

// Posts the failed-inspection Adaptive Card to the Supervisors channel, but only for a
// FAIL_BLOCKING result. The contract is fire-and-forget: the returned promise never rejects, so
// a route can call it without await (or with `void`) and its HTTP response is never affected by
// the Teams outcome. Any failure (no webhook, webhook error) is logged at warn and swallowed.
export const notifyFailedInspectionTeams = async (
  alert: FailedInspectionTeamsAlert,
  deps: TeamsNotifyDeps = {},
): Promise<void> => {
  const log = deps.log ?? logger;
  try {
    // PASS and FAIL_WARNING do not notify (AC: no card on PASS or FAIL_WARNING).
    if (alert.result !== 'FAIL_BLOCKING') return;

    const sender = deps.sender !== undefined ? deps.sender : getTeamsSender();
    if (!sender) {
      log.warn(
        { assetTag: alert.assetTag },
        'Teams webhook not configured; failed-inspection card skipped',
      );
      return;
    }

    const baseUrl =
      deps.dashboardBaseUrl !== undefined ? deps.dashboardBaseUrl : config().dashboardBaseUrl;
    const deepLink = buildDeepLink(baseUrl, alert.defectId);
    if (!deepLink && !warnedMissingDashboardUrl) {
      // A card with no deep link is still useful (asset tag and Defect ID), so post it anyway and
      // record the missing config once per process (not once per blocking failure).
      warnedMissingDashboardUrl = true;
      log.warn(
        { assetTag: alert.assetTag },
        'DASHBOARD_BASE_URL not set; Teams cards posted without a deep link',
      );
    }

    const payload = buildFailedInspectionCard({
      assetTag: alert.assetTag,
      defectId: alert.defectId,
      severity: alert.severity,
      deepLink,
    });

    await sendWithRetry(sender, payload, deps.sleep ?? realSleep, log, alert.assetTag);
  } catch (err) {
    // Belt-and-braces: nothing above is expected to throw (sender errors are caught in the retry
    // loop), but the fire-and-forget contract requires this never rejects.
    log.warn({ err, assetTag: alert.assetTag }, 'failed-inspection Teams notification errored');
  }
};
