import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'path';
import { fileURLToPath } from 'url';

// Runs as audit_migrator (DDL only, never INSERT/UPDATE/DELETE on audit_events; see
// infra/docker/postgres-init.sh), a deliberately separate role from the audit_writer connection
// the running service uses (ARCHITECTURE.md 8.4 rule 8: schema changes and operational writes
// never share a role).
const localHost = process.env['DB_HOST_LOCAL'] ?? 'localhost';
const rawUrl = process.env['AUDIT_MIGRATOR_DB_URL']?.replace('@postgres:', `@${localHost}:`);

if (!rawUrl) {
  process.stderr.write('AUDIT_MIGRATOR_DB_URL must be set\n');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: rawUrl });
const db = drizzle(pool);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  await migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
  process.stdout.write('Migrations applied\n');
} catch (err) {
  process.stderr.write(`Migration failed: ${String(err)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
