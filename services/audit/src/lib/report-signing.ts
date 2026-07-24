import {
  createPrivateKey,
  createPublicKey,
  createSign,
  createHash,
  type KeyObject,
} from 'node:crypto';
import { config } from './config.js';

// Detached signature over a report file's bytes (ADR 0022). Deliberately not an embedded PAdES
// PDF signature: see the ADR for why a self-signed certificate would render worse than no
// signature at all in a PDF viewer. Verification is: recompute sha256(file), verify the
// signature against the recorded public key, both of which are handed back by signReportFile
// below and returned in the GET /reports/:jobId response.

let cachedPrivateKey: KeyObject | undefined;

const loadPrivateKey = (): KeyObject => {
  if (cachedPrivateKey) return cachedPrivateKey;
  const pem = config().reportSigningPrivateKey;
  if (!pem) {
    throw new Error('REPORT_SIGNING_PRIVATE_KEY is not configured');
  }
  cachedPrivateKey = createPrivateKey(pem);
  return cachedPrivateKey;
};

// sha256 of the DER-encoded public key. Not a secret - it is published alongside the signature
// so a verifier knows which key to check against without exposing the private key itself.
const fingerprintOf = (privateKey: KeyObject): string => {
  const publicKey = createPublicKey(privateKey);
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex');
};

export type ReportSignature = {
  sha256: string;
  signature: string;
  signingKeyFingerprint: string;
};

// Hashes and signs the finished file in one step, so a caller cannot accidentally sign a
// different buffer than the one it hashed.
export const signReportFile = (data: Buffer): ReportSignature => {
  const privateKey = loadPrivateKey();
  const sha256 = createHash('sha256').update(data).digest('hex');
  const signature = createSign('RSA-SHA256').update(data).sign(privateKey).toString('base64');
  return { sha256, signature, signingKeyFingerprint: fingerprintOf(privateKey) };
};

// Test-only: clears the cached key so a test can swap REPORT_SIGNING_PRIVATE_KEY and re-load.
export const resetSigningKeyForTest = (): void => {
  cachedPrivateKey = undefined;
};
