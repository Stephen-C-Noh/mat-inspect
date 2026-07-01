import type { InspectionResult } from '@mat-inspect/shared-types';
import { logger } from '../logger.js';
import {
  buildFailedInspectionEmail,
  type FailedInspectionEmailInput,
} from './failed-inspection-email.js';
import { defaultFromAddress, getMailSender, type MailMessage, type MailSender } from './mailer.js';

export type FailedInspectionAlert = FailedInspectionEmailInput & {
  // Server-derived inspection result. Only FAIL_BLOCKING triggers the email (PRD Section 9).
  result: InspectionResult;
  // Email addresses of the active supervisors to notify. The caller (the inspection-submit
  // route) resolves these; recipient policy is "all active supervisors" (ADR 0013). Roles live
  // in the Entra token, not core_db, so this list is supplied rather than queried here.
  supervisorEmails: string[];
};

// Minimal structured-logger surface. The real logger (Pino) satisfies it; tests pass a spy.
type LogFn = (obj: object, msg: string) => void;
type NotifyLogger = { warn: LogFn; info: LogFn };

export type NotifyDeps = {
  // Inject to test without a live relay. undefined means "use the configured SMTP sender";
  // null means "no sender available" (SMTP not configured).
  sender?: MailSender | null;
  from?: string;
  // Injected so tests run without real timers.
  sleep?: (ms: number) => Promise<void>;
  log?: NotifyLogger;
};

// FRS 8.1: a send is retried up to three times with exponential backoff. One delay per retry,
// so three entries means one initial attempt plus three retries.
const RETRY_DELAYS_MS = [1000, 2000, 4000];

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const sendWithRetry = async (
  sender: MailSender,
  message: MailMessage,
  sleep: (ms: number) => Promise<void>,
  log: NotifyLogger,
  assetTag: string,
): Promise<void> => {
  const maxAttempts = RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sender(message);
      if (attempt > 1) {
        log.info({ assetTag, attempt }, 'failed-inspection email sent after retry');
      }
      return;
    } catch (err) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      if (delay === undefined) {
        // Retries exhausted. One warn, then give up: email is fire-and-forget, so a persistent
        // relay failure must not surface as a 5xx (the dashboard queue is the not-missed
        // backstop, ADR 0013).
        log.warn({ err, assetTag, attempts: maxAttempts }, 'failed-inspection email send failed');
        return;
      }
      await sleep(delay);
    }
  }
};

// Sends the failed-inspection alert email to all supervisors, but only for a FAIL_BLOCKING
// result. The contract is fire-and-forget: the returned promise never rejects, so a route can
// call it without await (or with `void`) and its HTTP response is never affected by mail
// outcome. Any failure (no recipients, no SMTP, relay error) is logged at warn and swallowed.
export const notifyFailedInspection = async (
  alert: FailedInspectionAlert,
  deps: NotifyDeps = {},
): Promise<void> => {
  const log = deps.log ?? logger;
  try {
    // PASS and FAIL_WARNING do not notify (AC: email not sent on PASS or FAIL_WARNING).
    if (alert.result !== 'FAIL_BLOCKING') return;

    if (alert.supervisorEmails.length === 0) {
      log.warn(
        { assetTag: alert.assetTag },
        'failed-inspection alert has no supervisor recipients',
      );
      return;
    }

    const sender = deps.sender !== undefined ? deps.sender : getMailSender();
    if (!sender) {
      log.warn(
        { assetTag: alert.assetTag },
        'SMTP not configured; failed-inspection email skipped',
      );
      return;
    }

    const message: MailMessage = {
      from: deps.from ?? defaultFromAddress(),
      to: alert.supervisorEmails,
      ...buildFailedInspectionEmail(alert),
    };

    await sendWithRetry(sender, message, deps.sleep ?? realSleep, log, alert.assetTag);
  } catch (err) {
    // Belt-and-braces: nothing above is expected to throw (sender errors are caught in the
    // retry loop), but the fire-and-forget contract requires this never rejects.
    log.warn({ err, assetTag: alert.assetTag }, 'failed-inspection email notification errored');
  }
};
