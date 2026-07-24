import { drizzle } from 'drizzle-orm/node-postgres';
import { auditEvents } from '../../db/schema/audit-events.js';
import { reportJobs } from '../../db/schema/report-jobs.js';
import { config } from '../lib/config.js';

// Connects as audit_writer (INSERT + SELECT on audit_events; INSERT + SELECT + UPDATE on
// report_jobs, see infra/docker/postgres-init.sh and the report_jobs migration). Migrations run
// separately as audit_migrator (db/migrate.ts) and never share this connection.
export const db = drizzle(config().databaseUrl);
export { auditEvents, reportJobs };
