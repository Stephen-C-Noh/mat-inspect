import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadConfig } from './config.js';

// A connection string shaped like the Azurite dev value (well-known, not a secret). Enough to
// pass the AZURE_STORAGE_CONNECTION_STRING shape check.
const AZURITE = 'AccountName=devstoreaccount1;BlobEndpoint=http://azurite:10000/devstoreaccount1;';

// A minimal env that passes validation in production mode. Individual tests remove or corrupt one
// value to assert the matching problem is reported.
const prodEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  APPLICATIONINSIGHTS_CONNECTION_STRING: 'InstrumentationKey=00000000-0000-0000-0000-000000000000',
  AZURE_STORAGE_CONNECTION_STRING: AZURITE,
  ENTRA_TENANT_ID: '22222222-2222-2222-2222-222222222222',
  ENTRA_CLIENT_ID: '11111111-1111-1111-1111-111111111111',
});

describe('loadConfig', () => {
  it('applies defaults for port, container, and max upload size', () => {
    const cfg = loadConfig({ NODE_ENV: 'test' });
    expect(cfg.port).toBe(3000);
    expect(cfg.blobContainer).toBe('mat-inspect-media');
    expect(cfg.maxUploadBytes).toBe(10 * 1024 * 1024);
    expect(cfg.telemetryEnabled).toBe(false);
  });

  it('omits required external vars under NODE_ENV=test', () => {
    // Tests run against a throwaway Azurite container and mock the JWKS fetch, so none of the
    // external vars are required. This must not throw.
    expect(() => loadConfig({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('accepts a complete production environment', () => {
    const cfg = loadConfig(prodEnv());
    expect(cfg.nodeEnv).toBe('production');
    expect(cfg.azureStorageConnectionString).toBe(AZURITE);
    expect(cfg.telemetryEnabled).toBe(true);
  });

  it('rejects a placeholder storage connection string', () => {
    expect(() =>
      loadConfig({ ...prodEnv(), AZURE_STORAGE_CONNECTION_STRING: 'REPLACE_ME' }),
    ).toThrow(EnvValidationError);
  });

  it('rejects a storage connection string with no recognizable endpoint marker', () => {
    expect(() =>
      loadConfig({ ...prodEnv(), AZURE_STORAGE_CONNECTION_STRING: 'not-a-connection-string' }),
    ).toThrow(EnvValidationError);
  });

  it('requires AZURE_STORAGE_CONNECTION_STRING outside tests', () => {
    const env = prodEnv();
    delete env.AZURE_STORAGE_CONNECTION_STRING;
    expect(() => loadConfig(env)).toThrow(/AZURE_STORAGE_CONNECTION_STRING is required/);
  });

  it('requires the Entra vars outside tests', () => {
    const env = prodEnv();
    delete env.ENTRA_TENANT_ID;
    expect(() => loadConfig(env)).toThrow(/ENTRA_TENANT_ID is required/);
  });

  it('rejects a non-positive MEDIA_MAX_UPLOAD_BYTES', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', MEDIA_MAX_UPLOAD_BYTES: '0' })).toThrow(
      EnvValidationError,
    );
  });
});
