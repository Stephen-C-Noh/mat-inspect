import { z } from 'zod';

// Central environment validation for the Media Service. Mirrors core-api and audit lib/config.ts
// (ADR 0015): parsed once at boot, fail-fast with a clear, var-named message before any module
// reads a half-configured value (a placeholder connection string reaching the Azure Blob client
// is the failure mode this prevents).

// A value copied from .env.example but never filled in. These strings are truthy, so a naive
// `if (process.env.X)` guard passes and the downstream client fails later with a confusing error.
// REPLACE_ME and xxxx are the fake-value sentinels CLAUDE.md mandates.
const PLACEHOLDER = /^(replace_me|x{4,}|changeme|your[-_].*)$/i;
const isPlaceholder = (v: string): boolean => PLACEHOLDER.test(v.trim());

// Azure Monitor connection strings always contain this token; guard on shape, not truthiness.
const APPINSIGHTS_MARKER = 'InstrumentationKey=';

// An Azure Storage connection string always identifies the endpoint one of these ways: a named
// account (AccountName=), an explicit blob endpoint (BlobEndpoint=, used by the Azurite dev
// string and SAS-based strings), or the emulator shortcut. Checking the shape at boot turns a
// malformed value into a clear message here instead of an opaque throw on the first upload.
const STORAGE_MARKERS = ['AccountName=', 'BlobEndpoint=', 'UseDevelopmentStorage=true'];

// 10 MB. Fits a modern phone photo; large enough that a legitimate JPEG/PNG/WebP is never
// rejected for size, small enough to bound memory since the file is buffered to hash and sniff
// it. Overridable via MEDIA_MAX_UPLOAD_BYTES for tighter or looser deployments.
const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Photo container per ADR 0004 (voice clips and PDF reports use their own containers). The blob
// name inside it is the returned photoId, so the container plus the id fully locate an object.
const DEFAULT_BLOB_CONTAINER = 'mat-inspect-media';

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().trim().optional(),
  AZURE_STORAGE_CONNECTION_STRING: z.string().trim().optional(),
  MEDIA_BLOB_CONTAINER: z.string().trim().default(DEFAULT_BLOB_CONTAINER),
  MEDIA_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(DEFAULT_MAX_UPLOAD_BYTES),
  // Entra auth config used by verifyToken (ADR 0002, ADR 0012). Same treatment as core-api: a
  // present tenant id selects the real Entra JWKS; a blank one selects the dev-JWKS fallback.
  ENTRA_TENANT_ID: z.string().trim().optional(),
  ENTRA_CLIENT_ID: z.string().trim().optional(),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  applicationInsightsConnectionString: string | undefined;
  telemetryEnabled: boolean;
  azureStorageConnectionString: string;
  blobContainer: string;
  maxUploadBytes: number;
  entraTenantId: string | undefined;
  entraClientId: string | undefined;
};

export class EnvValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

const orUndefined = (v: string | undefined): string | undefined =>
  v === undefined || v === '' ? undefined : v;

// Validates the environment and returns a typed, resolved config. Pure: reads from the supplied
// object (process.env by default) and never exits, so tests can drive it directly. Collects every
// problem before throwing so a misconfigured .env reports all issues at once.
export const loadConfig = (raw: NodeJS.ProcessEnv = process.env): AppConfig => {
  const shape = rawSchema.safeParse(raw);
  if (!shape.success) {
    throw new EnvValidationError(
      shape.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }

  const env = shape.data;
  // Real Azure connectivity (Blob Storage, Entra, Application Insights) is required for dev and
  // prod but not tests, which run against a throwaway Azurite container and mint local tokens.
  // Mirrors the requireAzure / requireExternal convention in core-api and audit.
  const requireExternal = env.NODE_ENV !== 'test';
  const problems: string[] = [];

  const appInsights = orUndefined(env.APPLICATIONINSIGHTS_CONNECTION_STRING);
  const storage = orUndefined(env.AZURE_STORAGE_CONNECTION_STRING);
  const entraTenantId = orUndefined(env.ENTRA_TENANT_ID);
  const entraClientId = orUndefined(env.ENTRA_CLIENT_ID);

  for (const [name, value] of [
    ['APPLICATIONINSIGHTS_CONNECTION_STRING', appInsights],
    ['AZURE_STORAGE_CONNECTION_STRING', storage],
    ['ENTRA_TENANT_ID', entraTenantId],
    ['ENTRA_CLIENT_ID', entraClientId],
  ] as const) {
    if (value && isPlaceholder(value)) {
      problems.push(`${name} is an unfilled placeholder; replace it with the real value`);
    }
  }

  if (appInsights && !isPlaceholder(appInsights) && !appInsights.includes(APPINSIGHTS_MARKER)) {
    problems.push(
      `APPLICATIONINSIGHTS_CONNECTION_STRING is set but is not a valid connection string (must contain "${APPINSIGHTS_MARKER}")`,
    );
  }
  if (requireExternal && !appInsights) {
    problems.push(
      'APPLICATIONINSIGHTS_CONNECTION_STRING is required (only NODE_ENV=test may omit it)',
    );
  }

  // Storage is the Media Service's core dependency: without a valid connection string there is
  // nowhere to put an uploaded photo, so a blank or malformed value must fail the boot.
  if (storage && !isPlaceholder(storage) && !STORAGE_MARKERS.some((m) => storage.includes(m))) {
    problems.push(
      'AZURE_STORAGE_CONNECTION_STRING is set but does not look like a storage connection string ' +
        '(expected AccountName=, BlobEndpoint=, or UseDevelopmentStorage=true)',
    );
  }
  if (requireExternal && !storage) {
    problems.push('AZURE_STORAGE_CONNECTION_STRING is required (only NODE_ENV=test may omit it)');
  }

  // Entra auth is required outside tests for the same reason as core-api: a blank value leaves
  // JWT verification unconfigured, and in production the dev-JWKS fallback points at a host that
  // does not exist. Tests mock the JWKS fetch, so they omit these.
  if (requireExternal && !entraTenantId) {
    problems.push('ENTRA_TENANT_ID is required (only NODE_ENV=test may omit it)');
  }
  if (requireExternal && !entraClientId) {
    problems.push('ENTRA_CLIENT_ID is required (only NODE_ENV=test may omit it)');
  }

  if (problems.length > 0) {
    throw new EnvValidationError(problems);
  }

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    applicationInsightsConnectionString: appInsights,
    telemetryEnabled: appInsights !== undefined,
    // Non-null asserted: outside tests the required-value check above guarantees a value, and in
    // tests the caller sets it before building the app (there is nothing to store without it).
    azureStorageConnectionString: storage ?? '',
    blobContainer: env.MEDIA_BLOB_CONTAINER,
    maxUploadBytes: env.MEDIA_MAX_UPLOAD_BYTES,
    entraTenantId,
    entraClientId,
  };
};

let cached: AppConfig | undefined;

// Lazily validated, cached config for use inside modules. At boot the entrypoint has already
// called loadConfigOrExit, so this returns the cached value; in tests that import a module
// directly it validates from process.env on first call.
export const config = (): AppConfig => (cached ??= loadConfig());

// Boot entrypoint helper. Validates the environment and, on failure, writes a clear message to
// stderr and exits. This is the one place a direct stderr write is correct: it runs before the
// logger is used in anger and a structured log line here would be lost in the crash (ADR 0015).
export const loadConfigOrExit = (): AppConfig => {
  try {
    cached = loadConfig();
    return cached;
  } catch (err) {
    if (err instanceof EnvValidationError) {
      process.stderr.write(`\n[media] boot aborted: ${err.message}\n\n`);
      process.exit(1);
    }
    throw err;
  }
};

// Test-only: clears the cached config so a test can re-drive loadConfig with a fresh env.
export const resetConfigForTest = (): void => {
  cached = undefined;
};
