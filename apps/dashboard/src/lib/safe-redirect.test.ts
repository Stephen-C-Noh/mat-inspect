import { describe, expect, it } from 'vitest';
import { sanitizeRedirectPath } from './safe-redirect';

describe('sanitizeRedirectPath', () => {
  it('returns null when there is no requested path', () => {
    expect(sanitizeRedirectPath(null)).toBeNull();
  });

  it('returns a same-origin relative path unchanged', () => {
    expect(sanitizeRedirectPath('/fleet')).toBe('/fleet');
  });

  it('rejects a protocol-relative path (open-redirect to another host)', () => {
    expect(sanitizeRedirectPath('//evil.com')).toBeNull();
  });

  it('rejects an absolute URL to another host', () => {
    expect(sanitizeRedirectPath('https://evil.com')).toBeNull();
  });

  it('rejects a backslash path (browsers treat \\ as / in a URL)', () => {
    expect(sanitizeRedirectPath('/\\evil.com')).toBeNull();
  });
});
