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
  AUDIT_SERVICE_URL: 'http://audit:3000',
  AUDIT_INGEST_TOKEN: 'a-real-shared-secret',
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
      AUDIT_SERVICE_URL: 'http://audit:3000',
      AUDIT_INGEST_TOKEN: 'a-real-shared-secret',
    });
    expect(cfg.nodeEnv).toBe('production');
    expect(cfg.telemetryEnabled).toBe(true);
    expect(cfg.auditServiceUrl).toBe('http://audit:3000');
  });

  it('requires AUDIT_SERVICE_URL and AUDIT_INGEST_TOKEN in development', () => {
    const env = fullDev();
    delete env['AUDIT_SERVICE_URL'];
    delete env['AUDIT_INGEST_TOKEN'];
    try {
      loadConfig(env);
      throw new Error('expected loadConfig to throw');
    } catch (err) {
      const problems = (err as EnvValidationError).problems.join('\n');
      expect(problems).toMatch(/AUDIT_SERVICE_URL is required/);
      expect(problems).toMatch(/AUDIT_INGEST_TOKEN is required/);
    }
  });

  it('rejects a non-http(s) AUDIT_SERVICE_URL', () => {
    expectProblem(fullDev({ AUDIT_SERVICE_URL: 'audit:3000' }), /must be an http\(s\):\/\/ URL/);
  });

  it('rejects a placeholder AUDIT_INGEST_TOKEN', () => {
    expectProblem(
      fullDev({ AUDIT_INGEST_TOKEN: 'REPLACE_ME' }),
      /AUDIT_INGEST_TOKEN is an unfilled placeholder/,
    );
  });

  it('defaults OUTBOX_POLL_INTERVAL_MS to 2000', () => {
    expect(loadConfig(fullDev()).outboxPollIntervalMs).toBe(2000);
  });

  it('exempts NODE_ENV=test from requiring audit delivery config', () => {
    const cfg = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://app:secret@localhost:5432/mat',
    });
    expect(cfg.auditServiceUrl).toBeUndefined();
    expect(cfg.auditIngestToken).toBeUndefined();
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

  it('rejects SMTP_USER without SMTP_PASS (half-filled auth would silently fail every send)', () => {
    expectProblem(
      fullDev({ SMTP_HOST: 'smtp.example.test', SMTP_USER: 'test-user' }),
      /SMTP_USER and SMTP_PASS must be set together/,
    );
  });

  it('rejects SMTP_PASS without SMTP_USER', () => {
    expectProblem(
      fullDev({ SMTP_HOST: 'smtp.example.test', SMTP_PASS: 'test-password' }),
      /SMTP_USER and SMTP_PASS must be set together/,
    );
  });

  it('allows an unauthenticated relay (host set, neither user nor pass)', () => {
    const cfg = loadConfig(fullDev({ SMTP_HOST: 'smtp.example.test' }));
    expect(cfg.smtp).toMatchObject({
      host: 'smtp.example.test',
      user: undefined,
      pass: undefined,
    });
  });

  it('treats a blank SMTP_PORT as unset and applies the default port', () => {
    const cfg = loadConfig(fullDev({ SMTP_HOST: 'smtp.example.test', SMTP_PORT: '' }));
    expect(cfg.smtp?.port).toBe(587);
  });

  it('treats a uniformly blank SMTP block as disabled', () => {
    const cfg = loadConfig(fullDev({ SMTP_HOST: '', SMTP_PORT: '', SMTP_USER: '', SMTP_PASS: '' }));
    expect(cfg.smtp).toBeUndefined();
  });

  it('leaves the Teams webhook and dashboard base url undefined when unset', () => {
    const cfg = loadConfig(fullDev());
    expect(cfg.teamsWebhookUrl).toBeUndefined();
    expect(cfg.dashboardBaseUrl).toBeUndefined();
  });

  it('accepts a valid https Teams webhook url and dashboard base url', () => {
    const cfg = loadConfig(
      fullDev({
        TEAMS_WEBHOOK_URL: 'https://prod-00.westus.logic.azure.com/workflows/abc/triggers/manual',
        DASHBOARD_BASE_URL: 'https://dashboard.mat-inspect.sait.ca',
      }),
    );
    expect(cfg.teamsWebhookUrl).toContain('logic.azure.com');
    expect(cfg.dashboardBaseUrl).toBe('https://dashboard.mat-inspect.sait.ca');
  });

  it('rejects a REPLACE_ME placeholder Teams webhook url', () => {
    expectProblem(
      fullDev({ TEAMS_WEBHOOK_URL: 'REPLACE_ME' }),
      /TEAMS_WEBHOOK_URL is an unfilled placeholder/,
    );
  });

  it('rejects a Teams webhook url that is not https', () => {
    expectProblem(
      fullDev({ TEAMS_WEBHOOK_URL: 'http://flow.example/webhook' }),
      /TEAMS_WEBHOOK_URL is set but is not a valid https URL/,
    );
  });

  it('rejects a malformed dashboard base url', () => {
    expectProblem(
      fullDev({ DASHBOARD_BASE_URL: 'not-a-url' }),
      /DASHBOARD_BASE_URL is set but is not a valid http\(s\) URL/,
    );
  });

  it('leaves supervisorAlertEmails empty when unset', () => {
    expect(loadConfig(fullDev()).supervisorAlertEmails).toEqual([]);
  });

  it('parses a comma-separated SUPERVISOR_ALERT_EMAILS list and trims entries', () => {
    const cfg = loadConfig(fullDev({ SUPERVISOR_ALERT_EMAILS: 'a@sait.ca, b@sait.ca ,c@sait.ca' }));
    expect(cfg.supervisorAlertEmails).toEqual(['a@sait.ca', 'b@sait.ca', 'c@sait.ca']);
  });

  it('rejects a SUPERVISOR_ALERT_EMAILS entry that is not an email address', () => {
    expectProblem(
      fullDev({ SUPERVISOR_ALERT_EMAILS: 'a@sait.ca, not-an-email' }),
      /SUPERVISOR_ALERT_EMAILS contains an entry that is not an email address/,
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
