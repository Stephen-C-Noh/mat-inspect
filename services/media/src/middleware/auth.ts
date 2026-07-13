import { createEntraAuth } from '@mat-inspect/shared-auth-server';
import { httpError } from '../lib/http-error.js';
import { logger } from '../lib/logger.js';

// Entra token verification lives in @mat-inspect/shared-auth-server (DEV-98). The photo upload is
// called by the operator PWA with an Entra access token; identity comes from the validated token,
// never the request body.
//
// The dev-token fallback is the package default: the Media Service does not mint tokens, so it
// verifies dev tokens against core-api's dev JWKS over the internal network (DEV_JWKS_URL
// overrides the address).
const auth = createEntraAuth({ httpError, logger });

export const { verifyToken, requireRole, setJwksForTest, resetJwksForTest } = auth;
