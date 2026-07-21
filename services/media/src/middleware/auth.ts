import { createEntraAuth } from '@mat-inspect/shared-auth-server';
import { httpError } from '../lib/http-error.js';
import { logger } from '../lib/logger.js';

// Entra token verification lives in @mat-inspect/shared-auth-server (DEV-98). The photo upload is
// called by the operator PWA with an Entra access token; identity comes from the validated token,
// never the request body. The verifier resolves the real Entra JWKS from ENTRA_TENANT_ID, which
// the boot validator requires outside tests (ADR 0015); tests inject keys with setJwksForTest.
const auth = createEntraAuth({ httpError, logger });

export const { verifyToken, requireRole, setJwksForTest, resetJwksForTest } = auth;
