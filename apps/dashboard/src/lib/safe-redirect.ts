// An arbitrary placeholder origin, not window.location.origin: this runs in both the browser
// and Node (Vitest's default node environment for this project has no window). The WHATWG URL
// parser strips ASCII tab/newline/CR and treats backslash as slash for special schemes before
// resolving, so comparing the parsed origin against the placeholder (instead of pattern-matching
// the raw string) catches every way a same-origin-looking path can smuggle a different host.
const PLACEHOLDER_ORIGIN = 'http://sanitize.invalid';

export const sanitizeRedirectPath = (raw: string | null): string | null => {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return null;
  return `${url.pathname}${url.search}${url.hash}`;
};
