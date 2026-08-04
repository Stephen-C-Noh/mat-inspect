import { z } from 'zod';

// Central environment validation for core-api. Parsed once at boot (see instrumentation.ts),
// before any module reads a half-configured value. The goal is fail-fast with a clear,
// var-named message: a missing or placeholder secret aborts the boot instead of throwing an
// opaque error far from the cause (the Azure Monitor "No instrumentation key" crash is the
// case that motivated this). See ADR 0015.

// A value copied from .env.example but never filled in. These strings are truthy, so a naive
// `if (process.env.X)` guard passes and the downstream client fails later with a confusing
// message. REPLACE_ME and xxxx are the fake-value sentinels CLAUDE.md mandates.
const PLACEHOLDER = /^(replace_me|x{4,}|changeme|your[-_].*)$/i;
const isPlaceholder = (v: string): boolean => PLACEHOLDER.test(v.trim());

// Azure Monitor connection strings always contain this token. Guard on shape, not just
// truthiness, so a placeholder cannot reach useAzureMonitor().
const CONNECTION_STRING_MARKER = 'InstrumentationKey=';

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DB_HOST_LOCAL: z.string().trim().default('localhost'),
  DATABASE_URL: z.string().trim().optional(),
  CORE_API_DB_URL: z.string().trim().optional(),
  ENTRA_TENANT_ID: z.string().trim().optional(),
  ENTRA_CLIENT_ID: z.string().trim().optional(),
  APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().trim().optional(),
  TEAMS_WEBHOOK_URL: z.string().trim().optional(),
  DASHBOARD_BASE_URL: z.string().trim().optional(),
  AUDIT_SERVICE_URL: z.string().trim().optional(),
  AUDIT_INGEST_TOKEN: z.string().trim().optional(),
  AI_SERVICE_URL: z.string().trim().optional(),
  CORE_API_INTERNAL_TOKEN: z.string().trim().optional(),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  // Outbox lag monitoring (ARCHITECTURE.md 8.4 rule 7, DEV-40 AC3): the poller logs at warn
  // instead of info once the oldest unprocessed row is older than this, so a stalled poller
  // surfaces in Azure Monitor without a separate alerting pipeline.
  OUTBOX_LAG_WARN_MS: z.coerce.number().int().positive().default(300_000),
  SMTP_HOST: z.string().trim().optional(),
  // Treat a blank SMTP_PORT the same as unset, matching how orUndefined handles the other SMTP
  // vars. Without the preprocess, z.coerce turns '' into 0, which fails .positive() with a raw
  // Zod message when someone blanks the whole SMTP block uniformly.
  SMTP_PORT: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().positive().optional(),
  ),
  SMTP_USER: z.string().trim().optional(),
  SMTP_PASS: z.string().trim().optional(),
  SUPERVISOR_ALERT_EMAILS: z.string().trim().optional(),
});

// Validates a value parses as an http(s) URL. Used for the Teams webhook and dashboard base URL,
// where a malformed value would fail late (at first post) rather than at boot.
const isHttpUrl = (value: string, requireHttps: boolean): boolean => {
  try {
    const url = new URL(value);
    return requireHttps
      ? url.protocol === 'https:'
      : url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

// SMTP relay used for the failed-inspection email alert (ADR 0013: email is the minimum
// guaranteed notification channel). Resolved as a unit: present only when SMTP_HOST is set.
// secure is derived from the port (465 is implicit TLS; 587/25 upgrade via STARTTLS).
export type SmtpConfig = {
  host: string;
  port: number;
  user: string | undefined;
  pass: string | undefined;
  secure: boolean;
};

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  databaseUrl: string;
  entraTenantId: string | undefined;
  entraClientId: string | undefined;
  applicationInsightsConnectionString: string | undefined;
  telemetryEnabled: boolean;
  // undefined when the Teams webhook is not configured. The notifier treats this as "skip and
  // warn", not a boot failure: Teams is a best-effort fast nudge with no delivery guarantee, and
  // the post is fire-and-forget off the request path (ADR 0013, DEV-39).
  teamsWebhookUrl: string | undefined;
  // Dashboard origin used to build the Teams card deep link. undefined when unset; the card then
  // posts without a deep-link button.
  dashboardBaseUrl: string | undefined;
  auditServiceUrl: string | undefined;
  auditIngestToken: string | undefined;
  // Internal address of the AI Service. The PWA reaches transcription through core-api, so this is
  // the only route to it; the AI Service is not published to the browser (ADR 0019). undefined only
  // under NODE_ENV=test.
  aiServiceUrl: string | undefined;
  // Shared secret the Audit Service's report generator presents to POST /internal/reports-data
  // (DEV-38). Mirrors auditIngestToken's role for the reverse direction: this endpoint answers
  // with inspection/defect/operator data, so it is not left to network isolation alone.
  coreApiInternalToken: string | undefined;
  outboxPollIntervalMs: number;
  outboxLagWarnMs: number;
  // undefined when SMTP is not configured. The notifier treats this as "skip and warn",
  // not a boot failure: a missing relay must not block the service from starting, and the
  // email channel is fire-and-forget off the request path (DEV-21).
  smtp: SmtpConfig | undefined;
  // Recipients for the failed-inspection email alert (DEV-81). Empty when unset; the notifier then
  // logs and skips. Supervisor roles live in the Entra token, not core_db, so this is a configured
  // distribution list rather than a database query. See the recipient-resolution note in ADR 0013.
  supervisorAlertEmails: string[];
};

// Implicit-TLS SMTP submission port. Any other port (587 submission, 25 relay) negotiates
// TLS via STARTTLS, which nodemailer does when secure is false.
const SMTP_IMPLICIT_TLS_PORT = 465;
const SMTP_DEFAULT_PORT = 587;

export class EnvValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

// Empty string means "not set" for an optional var (the var is present in .env but blank).
const orUndefined = (v: string | undefined): string | undefined =>
  v === undefined || v === '' ? undefined : v;

// Validates the environment and returns a typed, resolved config. Pure: it reads from the
// supplied object (process.env by default) and never exits, so tests can drive it directly.
// Collects every problem before throwing, so a misconfigured .env reports all issues at once.
export const loadConfig = (raw: NodeJS.ProcessEnv = process.env): AppConfig => {
  const shape = rawSchema.safeParse(raw);
  if (!shape.success) {
    throw new EnvValidationError(
      shape.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }

  const env = shape.data;
  // Real Azure connectivity (Entra auth, Application Insights) is required for development and
  // production. Dev runs against the personal Entra tenant and a real Application Insights
  // workspace, so a blank value is a setup mistake, not a valid "off" mode. The env is set once
  // per developer and does not change until production. Tests run without external Azure
  // dependencies, so the required-value checks are skipped under NODE_ENV=test.
  const requireAzure = env.NODE_ENV !== 'test';
  const problems: string[] = [];

  const entraTenantId = orUndefined(env.ENTRA_TENANT_ID);
  const entraClientId = orUndefined(env.ENTRA_CLIENT_ID);
  const appInsights = orUndefined(env.APPLICATIONINSIGHTS_CONNECTION_STRING);
  const auditServiceUrl = orUndefined(env.AUDIT_SERVICE_URL);
  const auditIngestToken = orUndefined(env.AUDIT_INGEST_TOKEN);
  const aiServiceUrl = orUndefined(env.AI_SERVICE_URL);
  const coreApiInternalToken = orUndefined(env.CORE_API_INTERNAL_TOKEN);

  // Reject placeholders for every secret. A half-filled .env (the value copied from
  // .env.example) fails at boot with a clear message, not later with an opaque client error.
  for (const [name, value] of [
    ['ENTRA_TENANT_ID', entraTenantId],
    ['ENTRA_CLIENT_ID', entraClientId],
    ['APPLICATIONINSIGHTS_CONNECTION_STRING', appInsights],
    ['AUDIT_INGEST_TOKEN', auditIngestToken],
    ['CORE_API_INTERNAL_TOKEN', coreApiInternalToken],
  ] as const) {
    if (value && isPlaceholder(value)) {
      problems.push(`${name} is an unfilled placeholder; replace it with the real value`);
    }
  }

  // Database connection. Resolve CORE_API_DB_URL's docker host to the local host for runs
  // outside compose, matching the prior db/index.ts behavior.
  const databaseUrl =
    orUndefined(env.DATABASE_URL) ??
    orUndefined(env.CORE_API_DB_URL)?.replace('@postgres:', `@${env.DB_HOST_LOCAL}:`);
  if (!databaseUrl) {
    problems.push('DATABASE_URL or CORE_API_DB_URL must be set');
  } else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    problems.push('DATABASE_URL must be a postgres:// connection string');
  }

  // A non-blank Application Insights value must be a real connection string. Outside tests it is
  // required: dev and prod both emit to a real Azure Monitor workspace (ADR 0003), so a blank
  // value is a setup mistake.
  if (
    appInsights &&
    !isPlaceholder(appInsights) &&
    !appInsights.includes(CONNECTION_STRING_MARKER)
  ) {
    problems.push(
      `APPLICATIONINSIGHTS_CONNECTION_STRING is set but is not a valid connection string (must contain "${CONNECTION_STRING_MARKER}")`,
    );
  }
  if (requireAzure && !appInsights) {
    problems.push(
      'APPLICATIONINSIGHTS_CONNECTION_STRING is required (set the Application Insights connection string; only NODE_ENV=test may omit it)',
    );
  }

  // Entra auth config is required outside tests. Dev runs against the personal Entra tenant; a
  // blank value would leave auth unconfigured, and the shared verifier cannot resolve a JWKS
  // without ENTRA_TENANT_ID (it throws). The dev-token fallback that once covered a blank value
  // was removed with the /dev/token endpoint (DEV-61, ADR 0021).
  if (requireAzure && !entraTenantId) {
    problems.push('ENTRA_TENANT_ID is required (only NODE_ENV=test may omit it)');
  }
  if (requireAzure && !entraClientId) {
    problems.push('ENTRA_CLIENT_ID is required (only NODE_ENV=test may omit it)');
  }

  // Microsoft Teams alert channel (ADR 0013). Optional: a missing webhook does not abort boot,
  // because Teams is a best-effort fast nudge, not a request-path dependency, and the dashboard
  // queue is the not-missed backstop. When set, reject placeholders and require a valid https
  // URL so a half-filled .env surfaces here rather than failing on the first post.
  const teamsWebhookUrl = orUndefined(env.TEAMS_WEBHOOK_URL);
  const dashboardBaseUrl = orUndefined(env.DASHBOARD_BASE_URL);

  // The outbox poller delivers to the Audit Service over HTTP (DEV-23 / ADR 0008); without it,
  // Inspections commit with no path to ever reach the audit chain. Required outside tests for the
  // same reason Entra and Application Insights are: a blank value is a setup mistake, not a valid
  // "off" mode.
  if (requireAzure && !auditServiceUrl) {
    problems.push('AUDIT_SERVICE_URL is required (only NODE_ENV=test may omit it)');
  } else if (auditServiceUrl && !/^https?:\/\//.test(auditServiceUrl)) {
    problems.push('AUDIT_SERVICE_URL must be an http(s):// URL');
  }
  if (requireAzure && !auditIngestToken) {
    problems.push('AUDIT_INGEST_TOKEN is required (only NODE_ENV=test may omit it)');
  }

  // Guards POST /internal/reports-data (DEV-38), the Audit Service's only path to
  // inspection/defect/operator data. Required outside tests for the same reason
  // AUDIT_INGEST_TOKEN is: a blank value is a setup mistake, not a valid "off" mode.
  if (requireAzure && !coreApiInternalToken) {
    problems.push('CORE_API_INTERNAL_TOKEN is required (only NODE_ENV=test may omit it)');
  }

  // core-api is the only way the PWA can reach transcription (ADR 0019). Without this, the voice
  // note path is dead and the operator gets a soft failure on every clip with nothing in the logs
  // pointing at the cause. Required outside tests, like the audit and Azure config above.
  if (requireAzure && !aiServiceUrl) {
    problems.push('AI_SERVICE_URL is required (only NODE_ENV=test may omit it)');
  } else if (aiServiceUrl && !/^https?:\/\//.test(aiServiceUrl)) {
    problems.push('AI_SERVICE_URL must be an http(s):// URL');
  }

  // SMTP for the failed-inspection email alert. Optional: a missing relay does not abort boot
  // (unlike Azure config), because email is a fire-and-forget side channel, not a request-path
  // dependency. When SMTP_HOST is set, reject placeholder credentials so a half-filled .env
  // surfaces here rather than failing on the first send. Email is the minimum guaranteed alert
  // channel in production (ADR 0013); deployment must set these, but the service still starts
  // without them so unrelated dev work is not blocked.
  const smtpHost = orUndefined(env.SMTP_HOST);
  const smtpUser = orUndefined(env.SMTP_USER);
  const smtpPass = orUndefined(env.SMTP_PASS);
  for (const [name, value] of [
    ['TEAMS_WEBHOOK_URL', teamsWebhookUrl],
    ['DASHBOARD_BASE_URL', dashboardBaseUrl],
    ['SMTP_HOST', smtpHost],
    ['SMTP_USER', smtpUser],
    ['SMTP_PASS', smtpPass],
  ] as const) {
    if (value && isPlaceholder(value)) {
      problems.push(`${name} is an unfilled placeholder; replace it with the real value`);
    }
  }
  if (teamsWebhookUrl && !isPlaceholder(teamsWebhookUrl) && !isHttpUrl(teamsWebhookUrl, true)) {
    problems.push('TEAMS_WEBHOOK_URL is set but is not a valid https URL');
  }
  if (dashboardBaseUrl && !isPlaceholder(dashboardBaseUrl) && !isHttpUrl(dashboardBaseUrl, false)) {
    problems.push('DASHBOARD_BASE_URL is set but is not a valid http(s) URL');
  }

  // SMTP auth is all-or-nothing: a relay needs both a username and a password, or neither (an
  // unauthenticated relay that accepts submission from the app host). Exactly one is always a
  // misconfiguration. Catch it at boot for the same reason the rest of this file exists: a
  // half-filled auth lets boot succeed, then every send fails authentication, retries, and is
  // swallowed into a single warn, so supervisors silently receive no failed-inspection alerts.
  if (smtpHost && Boolean(smtpUser) !== Boolean(smtpPass)) {
    problems.push(
      'SMTP_USER and SMTP_PASS must be set together (or both left blank for an unauthenticated relay)',
    );
  }

  // Recipients for the failed-inspection email alert (DEV-81). Supervisor roles live in the Entra
  // token, not core_db, so "all active supervisors" cannot be queried from the database. A
  // configured distribution list is used instead, mirroring how the Teams alert targets a
  // designated Supervisors channel (ADR 0013 recipient-resolution note). Comma-separated; a blank
  // or unset value means no email recipients (the notifier logs and skips, and the dashboard queue
  // stays the not-missed backstop).
  const supervisorAlertEmails = (orUndefined(env.SUPERVISOR_ALERT_EMAILS) ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter((address) => address.length > 0);
  for (const address of supervisorAlertEmails) {
    if (!address.includes('@')) {
      problems.push(
        `SUPERVISOR_ALERT_EMAILS contains an entry that is not an email address: "${address}"`,
      );
    }
  }

  if (problems.length > 0) {
    throw new EnvValidationError(problems);
  }

  // A placeholder SMTP_HOST already pushed a problem in the loop above and threw, so here smtpHost
  // is either unset or a real value. Compute the port once so port and secure cannot drift.
  const smtpPort = env.SMTP_PORT ?? SMTP_DEFAULT_PORT;
  const smtp: SmtpConfig | undefined = smtpHost
    ? {
        host: smtpHost,
        port: smtpPort,
        user: smtpUser,
        pass: smtpPass,
        secure: smtpPort === SMTP_IMPLICIT_TLS_PORT,
      }
    : undefined;

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: databaseUrl as string,
    entraTenantId,
    entraClientId,
    applicationInsightsConnectionString: appInsights,
    telemetryEnabled: appInsights !== undefined,
    teamsWebhookUrl,
    dashboardBaseUrl,
    auditServiceUrl,
    auditIngestToken,
    aiServiceUrl,
    coreApiInternalToken,
    outboxPollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
    outboxLagWarnMs: env.OUTBOX_LAG_WARN_MS,
    smtp,
    supervisorAlertEmails,
  };
};

let cached: AppConfig | undefined;

// Lazily validated, cached config for use inside modules (db, server). At boot the entrypoint
// has already called loadConfigOrExit, so this returns the cached value; in tests that import a
// module directly it validates from process.env on first call.
export const config = (): AppConfig => (cached ??= loadConfig());

// Boot entrypoint helper. Validates the environment and, on failure, writes a clear message to
// stderr and exits. This is the one place a direct stderr write is correct: it runs before the
// logger (which itself depends on validated config) and a structured log line here would be
// lost in the crash. See ADR 0015.
export const loadConfigOrExit = (): AppConfig => {
  try {
    cached = loadConfig();
    return cached;
  } catch (err) {
    if (err instanceof EnvValidationError) {
      process.stderr.write(`\n[core-api] boot aborted: ${err.message}\n\n`);
      process.exit(1);
    }
    throw err;
  }
};

// Test-only: clears the cached config so a test can re-drive loadConfig with a fresh env.
export const resetConfigForTest = (): void => {
  cached = undefined;
};
