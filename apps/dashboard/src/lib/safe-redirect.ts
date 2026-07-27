export const sanitizeRedirectPath = (raw: string | null): string | null => {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (raw.includes('\\')) return null;
  return raw;
};
