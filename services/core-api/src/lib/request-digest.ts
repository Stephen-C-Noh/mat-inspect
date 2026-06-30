import { createHash } from 'node:crypto';

// Sorts object keys recursively so two requests with the same fields in a different order
// hash identically. This is deliberately simpler than the chain's RFC 8785 canonicalization
// (ADR 0008): that one needs byte-for-byte interop with a later recompute for tamper
// detection, this one only needs to bind a retried request to its own earlier self.
const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
};

// requestDigest from ADR 0009: replaces the per-record HMAC as the idempotency binding.
export const requestDigest = (body: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(body)))
    .digest('hex');
