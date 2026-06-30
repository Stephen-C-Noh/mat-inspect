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
  AUDIT_SERVICE_URL: z.string().trim().optional(),
  AUDIT_INGEST_TOKEN: z.string().trim().optional(),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  databaseUrl: string;
  entraTenantId: string | undefined;
  entraClientId: string | undefined;
  applicationInsightsConnectionString: string | undefined;
  telemetryEnabled: boolean;
  auditServiceUrl: string | undefined;
  auditIngestToken: string | undefined;
  outboxPollIntervalMs: number;
};

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

  // Reject placeholders for every secret. A half-filled .env (the value copied from
  // .env.example) fails at boot with a clear message, not later with an opaque client error.
  for (const [name, value] of [
    ['ENTRA_TENANT_ID', entraTenantId],
    ['ENTRA_CLIENT_ID', entraClientId],
    ['APPLICATIONINSIGHTS_CONNECTION_STRING', appInsights],
    ['AUDIT_INGEST_TOKEN', auditIngestToken],
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
  // blank value would leave auth unconfigured, and in production the dev-token routes are not
  // registered and the JWKS falls back to a localhost URL that does not exist.
  if (requireAzure && !entraTenantId) {
    problems.push('ENTRA_TENANT_ID is required (only NODE_ENV=test may omit it)');
  }
  if (requireAzure && !entraClientId) {
    problems.push('ENTRA_CLIENT_ID is required (only NODE_ENV=test may omit it)');
  }

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

  if (problems.length > 0) {
    throw new EnvValidationError(problems);
  }

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: databaseUrl as string,
    entraTenantId,
    entraClientId,
    applicationInsightsConnectionString: appInsights,
    telemetryEnabled: appInsights !== undefined,
    auditServiceUrl,
    auditIngestToken,
    outboxPollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
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
