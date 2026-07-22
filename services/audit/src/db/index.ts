import { drizzle } from 'drizzle-orm/node-postgres';
import { auditEvents } from '../../db/schema/audit-events.js';
import { chainVerifications } from '../../db/schema/chain-verifications.js';
import { config } from '../lib/config.js';

// Connects as audit_writer (INSERT + SELECT only; see infra/docker/postgres-init.sh). Migrations
// run separately as audit_migrator (db/migrate.ts) and never share this connection.
export const db = drizzle(config().databaseUrl);
export { auditEvents, chainVerifications };
