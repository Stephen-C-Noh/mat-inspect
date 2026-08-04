import { createEntraAuth } from '@mat-inspect/shared-auth-server';
import { httpError } from '../lib/http-error.js';
import { logger } from '../lib/logger.js';

// Entra token verification lives in @mat-inspect/shared-auth-server (DEV-98), same as core-api
// and media. Added for DEV-38: the report routes are the first human-facing (as opposed to
// service-to-service) endpoints on the Audit Service, so this file did not exist before this
// ticket. requireIngestToken (ingest-auth.ts) stays separate and unrelated: that guards the
// core-api outbox poller, a machine caller with no user identity, not a person.
//
// The Audit Service mints no dev tokens of its own, so the JWKS fallback resolves against
// core-api's, same as media's auth.ts.
const auth = createEntraAuth({ httpError, logger });

export const { verifyToken, requireRole, setJwksForTest, resetJwksForTest } = auth;
