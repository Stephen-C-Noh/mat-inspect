import { beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPairSync, createHash, verify as cryptoVerify } from 'node:crypto';

describe('report signing (ADR 0022)', () => {
  let privateKeyPem: string;
  let publicKeyPem: string;

  beforeAll(() => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    publicKeyPem = publicKey.export({ type: 'pkcs1', format: 'pem' }).toString();

    process.env['NODE_ENV'] = 'test';
    // config.ts requires a syntactically valid DATABASE_URL regardless of NODE_ENV; nothing in
    // this file ever connects to it, since signReportFile never touches the db.
    process.env['DATABASE_URL'] = 'postgres://test:test@localhost:5432/test';
    process.env['REPORT_SIGNING_PRIVATE_KEY'] = privateKeyPem;
  });

  it('produces a signature that verifies against the matching public key', async () => {
    const { resetConfigForTest } = await import('./config.js');
    resetConfigForTest();
    const { signReportFile, resetSigningKeyForTest } = await import('./report-signing.js');
    resetSigningKeyForTest();

    const file = Buffer.from('a report file, not a real PDF');
    const { sha256, signature, signingKeyFingerprint } = signReportFile(file);

    expect(sha256).toBe(createHash('sha256').update(file).digest('hex'));
    expect(signingKeyFingerprint).toHaveLength(64);

    const verified = cryptoVerify(
      'RSA-SHA256',
      file,
      publicKeyPem,
      Buffer.from(signature, 'base64'),
    );
    expect(verified).toBe(true);
  });

  it('produces a signature that fails to verify against tampered bytes', async () => {
    const { resetConfigForTest } = await import('./config.js');
    resetConfigForTest();
    const { signReportFile, resetSigningKeyForTest } = await import('./report-signing.js');
    resetSigningKeyForTest();

    const file = Buffer.from('the real file');
    const { signature } = signReportFile(file);

    const tampered = Buffer.from('a different file entirely');
    const verified = cryptoVerify(
      'RSA-SHA256',
      tampered,
      publicKeyPem,
      Buffer.from(signature, 'base64'),
    );
    expect(verified).toBe(false);
  });

  it('is deterministic on the fingerprint for the same key', async () => {
    const { resetConfigForTest } = await import('./config.js');
    resetConfigForTest();
    const { signReportFile, resetSigningKeyForTest } = await import('./report-signing.js');
    resetSigningKeyForTest();

    const a = signReportFile(Buffer.from('file one'));
    const b = signReportFile(Buffer.from('file two'));
    expect(a.signingKeyFingerprint).toBe(b.signingKeyFingerprint);
  });
});
