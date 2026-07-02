import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'path';
import { fileURLToPath } from 'url';

// Runs as audit_migrator (DDL only, never INSERT/UPDATE/DELETE on audit_events; see
// infra/docker/postgres-init.sh), a deliberately separate role from the audit_writer connection
// the running service uses (ARCHITECTURE.md 8.4 rule 8: schema changes and operational writes
// never share a role).
//
// Passes the connection string directly to drizzle() rather than constructing a pg.Pool, which
// avoids a @types/pg version conflict between drizzle-orm's own nested @types/pg and the
// workspace root's @types/pg when building inside Docker.
const localHost = process.env['DB_HOST_LOCAL'] ?? 'localhost';
const rawUrl = process.env['AUDIT_MIGRATOR_DB_URL']?.replace('@postgres:', `@${localHost}:`);

if (!rawUrl) {
  process.stderr.write('AUDIT_MIGRATOR_DB_URL must be set\n');
  process.exit(1);
}

const db = drizzle(rawUrl);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  // migrationsSchema: 'public' keeps drizzle's journal table in the public schema so
  // audit_migrator doesn't need database-level CREATE privilege to make a new schema.
  await migrate(db, {
    migrationsFolder: path.join(__dirname, 'migrations'),
    migrationsSchema: 'public',
  });
  process.stdout.write('Migrations applied\n');
} catch (err) {
  process.stderr.write(`Migration failed: ${String(err)}\n`);
  process.exitCode = 1;
} finally {
  process.exit(process.exitCode ?? 0);
}
