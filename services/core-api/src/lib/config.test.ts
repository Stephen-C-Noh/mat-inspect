import { describe, it, expect } from 'vitest';
import { loadConfig, EnvValidationError } from './config.js';

const VALID_CONN =
  'InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://example.in.applicationinsights.azure.com/';

// A complete dev environment: outside NODE_ENV=test, Entra and Application Insights are
// required, so a valid dev env carries real-shaped values for all of them. Individual tests
// override or delete one field to assert a specific failure.
const fullDev = (overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://app:secret@localhost:5432/mat',
  ENTRA_TENANT_ID: '22222222-2222-2222-2222-222222222222',
  ENTRA_CLIENT_ID: '11111111-1111-1111-1111-111111111111',
  APPLICATIONINSIGHTS_CONNECTION_STRING: VALID_CONN,
  ...overrides,
});

const expectProblem = (env: NodeJS.ProcessEnv, match: RegExp): void => {
  try {
    loadConfig(env);
    throw new Error('expected loadConfig to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(EnvValidationError);
    expect((err as EnvValidationError).problems.join('\n')).toMatch(match);
  }
};

describe('loadConfig', () => {
  it('accepts a complete dev environment and applies defaults', () => {
    const cfg = loadConfig(fullDev());
    expect(cfg.nodeEnv).toBe('development');
    expect(cfg.port).toBe(3000);
    expect(cfg.logLevel).toBe('info');
    expect(cfg.telemetryEnabled).toBe(true);
    expect(cfg.entraTenantId).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('requires Entra and Application Insights in development', () => {
    const env = fullDev();
    delete env['ENTRA_TENANT_ID'];
    delete env['ENTRA_CLIENT_ID'];
    delete env['APPLICATIONINSIGHTS_CONNECTION_STRING'];
    try {
      loadConfig(env);
      throw new Error('expected loadConfig to throw');
    } catch (err) {
      const problems = (err as EnvValidationError).problems.join('\n');
      expect(problems).toMatch(/ENTRA_TENANT_ID is required/);
      expect(problems).toMatch(/ENTRA_CLIENT_ID is required/);
      expect(problems).toMatch(/APPLICATIONINSIGHTS_CONNECTION_STRING is required/);
    }
  });

  it('exempts NODE_ENV=test from the required Azure values (CI runs without Azure)', () => {
    const cfg = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://app:secret@localhost:5432/mat',
    });
    expect(cfg.nodeEnv).toBe('test');
    expect(cfg.telemetryEnabled).toBe(false);
    expect(cfg.entraTenantId).toBeUndefined();
  });

  it('rejects a REPLACE_ME placeholder connection string (the boot-crash case)', () => {
    expectProblem(
      fullDev({ APPLICATIONINSIGHTS_CONNECTION_STRING: 'REPLACE_ME' }),
      /APPLICATIONINSIGHTS_CONNECTION_STRING is an unfilled placeholder/,
    );
  });

  it('rejects a non-blank connection string without InstrumentationKey=', () => {
    expectProblem(
      fullDev({ APPLICATIONINSIGHTS_CONNECTION_STRING: 'IngestionEndpoint=https://x/' }),
      /must contain "InstrumentationKey="/,
    );
  });

  it('rejects a placeholder ENTRA_TENANT_ID instead of silently breaking auth', () => {
    expectProblem(
      fullDev({ ENTRA_TENANT_ID: 'REPLACE_ME' }),
      /ENTRA_TENANT_ID is an unfilled placeholder/,
    );
  });

  it('names the missing database url', () => {
    const env = fullDev();
    delete env['DATABASE_URL'];
    expectProblem(env, /DATABASE_URL or CORE_API_DB_URL must be set/);
  });

  it('rejects a non-postgres database url', () => {
    expectProblem(fullDev({ DATABASE_URL: 'mysql://localhost/x' }), /must be a postgres:\/\//);
  });

  it('resolves CORE_API_DB_URL docker host to the local host', () => {
    const env = fullDev();
    delete env['DATABASE_URL'];
    env['CORE_API_DB_URL'] = 'postgres://app:secret@postgres:5432/mat';
    env['DB_HOST_LOCAL'] = '127.0.0.1';
    const cfg = loadConfig(env);
    expect(cfg.databaseUrl).toBe('postgres://app:secret@127.0.0.1:5432/mat');
  });

  it('accepts a complete production environment', () => {
    const cfg = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://app:secret@db:5432/mat',
      ENTRA_TENANT_ID: '22222222-2222-2222-2222-222222222222',
      ENTRA_CLIENT_ID: '11111111-1111-1111-1111-111111111111',
      APPLICATIONINSIGHTS_CONNECTION_STRING: VALID_CONN,
    });
    expect(cfg.nodeEnv).toBe('production');
    expect(cfg.telemetryEnabled).toBe(true);
  });

  it('leaves smtp undefined when SMTP_HOST is not set', () => {
    expect(loadConfig(fullDev()).smtp).toBeUndefined();
  });

  it('resolves smtp config with a default port and STARTTLS when SMTP_HOST is set', () => {
    const cfg = loadConfig(
      fullDev({
        SMTP_HOST: 'smtp.example.test',
        SMTP_USER: 'test-user',
        SMTP_PASS: 'test-password',
      }),
    );
    expect(cfg.smtp).toEqual({
      host: 'smtp.example.test',
      port: 587,
      user: 'test-user',
      pass: 'test-password',
      secure: false,
    });
  });

  it('marks smtp secure on the implicit-TLS port 465', () => {
    const cfg = loadConfig(fullDev({ SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465' }));
    expect(cfg.smtp?.port).toBe(465);
    expect(cfg.smtp?.secure).toBe(true);
  });

  it('rejects a placeholder SMTP_PASS instead of failing on the first send', () => {
    expectProblem(
      fullDev({ SMTP_HOST: 'smtp.example.test', SMTP_PASS: 'REPLACE_ME' }),
      /SMTP_PASS is an unfilled placeholder/,
    );
  });

  it('reports every problem at once', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      ENTRA_TENANT_ID: 'REPLACE_ME',
    };
    try {
      loadConfig(env);
      throw new Error('expected loadConfig to throw');
    } catch (err) {
      expect((err as EnvValidationError).problems.length).toBeGreaterThan(1);
    }
  });
});
