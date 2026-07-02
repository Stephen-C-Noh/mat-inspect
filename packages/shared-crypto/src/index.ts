import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';

// RFC 8785 (JSON Canonicalization Scheme): fixed key order, fixed number formatting, no
// whitespace. The same logical record always produces the same byte sequence, which is what
// lets two different processes (core-api sealing a content digest, the audit service writing
// and later re-verifying a chain link) hash the same data to the same value (ADR 0008,
// ARCHITECTURE.md 8.4 rule 2). `canonicalize` returns undefined for values that are not valid
// JSON (e.g. containing `undefined` or a function); that case is a caller bug, not a recoverable
// situation, so it throws rather than silently hashing the string "undefined".
export const canonicalJson = (value: unknown): string => {
  const result = canonicalize(value);
  if (result === undefined) {
    throw new Error('canonicalJson: value is not representable as JSON');
  }
  return result;
};

export const sha256Hex = (input: string): string =>
  createHash('sha256').update(input).digest('hex');

// ARCHITECTURE.md 8.4 rule 4: all timestamps in the hash input are UTC, ISO 8601, with
// microsecond precision, generated once on the writer side and never recomputed differently.
// Date only carries millisecond resolution; this pads to 6 fractional digits so the format is
// fixed regardless of resolution, which is what determinism actually requires here.
export const toCanonicalTimestamp = (date: Date): string =>
  `${date.toISOString().slice(0, -1)}000Z`;
