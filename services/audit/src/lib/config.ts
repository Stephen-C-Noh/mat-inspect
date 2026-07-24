import { z } from 'zod';

// Central environment validation for the Audit Service. Mirrors core-api's lib/config.ts (ADR
// 0015): parsed once at boot, fail-fast with a clear, var-named message before anything reads a
// half-configured value.

const PLACEHOLDER = /^(replace_me|x{4,}|changeme|your[-_].*)$/i;
const isPlaceholder = (v: string): boolean => PLACEHOLDER.test(v.trim());

// Validated against ICU's tz database (bundled in the Node binary), so this works on the alpine
// runtime image without an OS tzdata package.
const isValidTimeZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const CONNECTION_STRING_MARKER = 'InstrumentationKey=';

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DB_HOST_LOCAL: z.string().trim().default('localhost'),
  DATABASE_URL: z.string().trim().optional(),
  AUDIT_API_DB_URL: z.string().trim().optional(),
  AUDIT_INGEST_TOKEN: z.string().trim().optional(),
  APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().trim().optional(),
  // HH:MM, 24h, lab-local time. Nightly full-chain verification job (ARCHITECTURE.md 8.4 rule 7,
  // DEV-40); distinct from the db-backup service's default 02:00 so the two don't compete for I/O.
  // "Lab-local" is resolved against LAB_TIMEZONE, not the container's ambient TZ (which is UTC on
  // the alpine image), so the job actually fires overnight and keeps its spacing from the backup.
  CHAIN_VERIFY_TIME: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM in 24h format')
    .default('02:30'),
  // IANA zone the nightly verification time is interpreted in. Default is SAIT Main Campus's zone;
  // overridable so a future multi-campus deployment can set its own (CLAUDE.md scalability note).
  LAB_TIMEZONE: z
    .string()
    .trim()
    .default('America/Edmonton')
    .refine(isValidTimeZone, 'must be a valid IANA time zone (e.g. America/Edmonton)'),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  databaseUrl: string;
  auditIngestToken: string | undefined;
  applicationInsightsConnectionString: string | undefined;
  telemetryEnabled: boolean;
  chainVerifyTime: string;
  labTimeZone: string;
};

export class EnvValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

const orUndefined = (v: string | undefined): string | undefined =>
  v === undefined || v === '' ? undefined : v;

export const loadConfig = (raw: NodeJS.ProcessEnv = process.env): AppConfig => {
  const shape = rawSchema.safeParse(raw);
  if (!shape.success) {
    throw new EnvValidationError(
      shape.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }

  const env = shape.data;
  // Tests run without external Azure dependencies and without a real shared secret, so the
  // required-value checks are skipped under NODE_ENV=test (same convention as core-api).
  const requireExternal = env.NODE_ENV !== 'test';
  const problems: string[] = [];

  const appInsights = orUndefined(env.APPLICATIONINSIGHTS_CONNECTION_STRING);
  const auditIngestToken = orUndefined(env.AUDIT_INGEST_TOKEN);

  for (const [name, value] of [
    ['APPLICATIONINSIGHTS_CONNECTION_STRING', appInsights],
    ['AUDIT_INGEST_TOKEN', auditIngestToken],
  ] as const) {
    if (value && isPlaceholder(value)) {
      problems.push(`${name} is an unfilled placeholder; replace it with the real value`);
    }
  }

  const databaseUrl =
    orUndefined(env.DATABASE_URL) ??
    orUndefined(env.AUDIT_API_DB_URL)?.replace('@postgres:', `@${env.DB_HOST_LOCAL}:`);
  if (!databaseUrl) {
    problems.push('DATABASE_URL or AUDIT_API_DB_URL must be set');
  } else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    problems.push('DATABASE_URL must be a postgres:// connection string');
  }

  if (
    appInsights &&
    !isPlaceholder(appInsights) &&
    !appInsights.includes(CONNECTION_STRING_MARKER)
  ) {
    problems.push(
      `APPLICATIONINSIGHTS_CONNECTION_STRING is set but is not a valid connection string (must contain "${CONNECTION_STRING_MARKER}")`,
    );
  }
  if (requireExternal && !appInsights) {
    problems.push(
      'APPLICATIONINSIGHTS_CONNECTION_STRING is required (set the Application Insights connection string; only NODE_ENV=test may omit it)',
    );
  }

  // The ingest endpoint authenticates core-api's outbox poller with a shared secret (DEV-23):
  // this is a legally-relevant write path, not just an internal-network convenience.
  if (requireExternal && !auditIngestToken) {
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
    auditIngestToken,
    applicationInsightsConnectionString: appInsights,
    telemetryEnabled: appInsights !== undefined,
    chainVerifyTime: env.CHAIN_VERIFY_TIME,
    labTimeZone: env.LAB_TIMEZONE,
  };
};

let cached: AppConfig | undefined;

export const config = (): AppConfig => (cached ??= loadConfig());

export const loadConfigOrExit = (): AppConfig => {
  try {
    cached = loadConfig();
    return cached;
  } catch (err) {
    if (err instanceof EnvValidationError) {
      process.stderr.write(`\n[audit] boot aborted: ${err.message}\n\n`);
      process.exit(1);
    }
    throw err;
  }
};

export const resetConfigForTest = (): void => {
  cached = undefined;
};
