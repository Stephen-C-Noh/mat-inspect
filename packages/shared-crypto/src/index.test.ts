import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex, toCanonicalTimestamp } from './index';

describe('canonicalJson', () => {
  it('produces the same output regardless of key order', () => {
    const a = canonicalJson({ b: 1, a: 2 });
    const b = canonicalJson({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1}');
  });

  it('sorts nested object keys too', () => {
    expect(canonicalJson({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
  });

  it('preserves array order (arrays are not sorted)', () => {
    expect(canonicalJson({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}');
  });

  it('throws on a value that is not representable as JSON', () => {
    expect(() => canonicalJson(undefined)).toThrow();
  });
});

describe('sha256Hex', () => {
  it('matches a known SHA-256 vector', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('is deterministic for the same input', () => {
    expect(sha256Hex('hello')).toBe(sha256Hex('hello'));
  });

  it('differs for different input', () => {
    expect(sha256Hex('hello')).not.toBe(sha256Hex('hellp'));
  });
});

describe('toCanonicalTimestamp', () => {
  it('formats as UTC ISO 8601 with 6 fractional digits', () => {
    const date = new Date('2026-05-19T18:31:42.123Z');
    expect(toCanonicalTimestamp(date)).toBe('2026-05-19T18:31:42.123000Z');
  });

  it('is stable across repeated calls for the same Date', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    expect(toCanonicalTimestamp(date)).toBe(toCanonicalTimestamp(date));
  });
});
