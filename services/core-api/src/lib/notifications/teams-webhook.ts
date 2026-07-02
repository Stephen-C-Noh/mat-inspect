import { config } from '../config.js';
import type { TeamsWebhookPayload } from './teams-card.js';

// Posts the Adaptive Card payload to the Power Automate Workflows webhook (ADR 0013). Resolves
// when the webhook accepts the post (a 2xx response), rejects otherwise. Kept narrow so the
// notifier and tests do not depend on the global fetch type.
export type TeamsSender = (payload: TeamsWebhookPayload) => Promise<void>;

// Minimal subset of the global fetch used here, injectable so tests run without a network call.
// Node 22 provides fetch globally, so no HTTP client dependency is added.
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number }>;

// Per-request timeout for the webhook POST. Without it a hung Power Automate endpoint would hold
// the request open to undici's ~5 minute default, keeping the fire-and-forget promise and its
// socket alive long past the alert budget. Four attempts at 5s plus 7s backoff stays inside the
// 60s budget (ADR 0013). A timed-out request rejects, which the notifier retries then drops.
const WEBHOOK_TIMEOUT_MS = 5000;

let cachedSender: TeamsSender | null | undefined;

// Builds a sender bound to one webhook URL. The webhook expects a JSON body; a non-2xx response
// means the Workflows flow rejected the post, which the notifier treats as a transient failure
// and retries, then logs and drops (the post is fire-and-forget, ADR 0013).
export const buildTeamsSender = (url: string, fetchImpl: FetchLike = fetch): TeamsSender => {
  return async (payload) => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Teams webhook returned HTTP ${res.status}`);
    }
  };
};

// Returns a sender bound to the configured webhook URL, or null when TEAMS_WEBHOOK_URL is not
// set. A null result means "Teams is disabled"; the notifier logs and skips rather than failing
// the inspection submit. Cached because the URL does not change after boot.
export const getTeamsSender = (): TeamsSender | null => {
  if (cachedSender !== undefined) return cachedSender;

  const url = config().teamsWebhookUrl;
  cachedSender = url ? buildTeamsSender(url) : null;
  return cachedSender;
};

// Test-only: drops the cached sender so a test can re-drive getTeamsSender with a fresh config.
export const resetTeamsSenderForTest = (): void => {
  cachedSender = undefined;
};
