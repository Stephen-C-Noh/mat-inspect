import { createEntraAuth } from '@mat-inspect/shared-auth-server';
import { httpError } from '../lib/http-error.js';
import { logger } from '../lib/logger.js';

// Entra token verification lives in @mat-inspect/shared-auth-server, so core-api and media
// cannot drift apart on the issuer check, the audience check or the key cache (DEV-98). This
// file only binds the service's error factory and logger to it.
const auth = createEntraAuth({
  httpError,
  logger,
  // Dev-token fallback (ADR 0015): core-api mints the dev token and serves the matching key set
  // itself, so it verifies against its own port rather than the package default.
  devJwksUri: () => `http://localhost:${process.env['PORT'] ?? '3000'}/dev/jwks`,
});

export const { verifyToken, requireRole, setJwksForTest, resetJwksForTest } = auth;
